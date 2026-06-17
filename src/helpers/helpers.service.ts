import { Injectable } from '@nestjs/common';
import { AvailabilityService } from '../availability/availability.service';
import { Hold, HoldsService } from '../holds/holds.service';
import { LoggerService } from '../logger/logger.service';
import { PricingService, Quote } from '../pricing/pricing.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AvailableWeek = {
  checkIn: Date;
  checkOut: Date;
};

export type ClosestWeek = AvailableWeek & {
  weeksOffsetFromTarget: number;
};

export type WeekWithPrice = AvailableWeek & {
  total: number;
  weeklyRate: number;
  label?: string;
  /** True when this week's price came from the base/fallback rate, not a
   *  real seasonal band — i.e. the period isn't priced yet. */
  usedBase: boolean;
};

@Injectable()
export class HelpersService {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly pricing: PricingService,
    private readonly holds: HoldsService,
    private readonly logger: LoggerService,
  ) {}

  async findClosestAvailableWeek(
    target: Date,
    windowDays = 30,
  ): Promise<ClosestWeek | null> {
    const start = new Date(target.getTime() - windowDays * DAY_MS);
    const end = new Date(target.getTime() + windowDays * DAY_MS);
    const weeks = await this.availability.findAvailableSundayWeeks(start, end);
    if (weeks.length === 0) return null;

    const targetSunday = this.snapToSundayUtc(target);
    // Score: |distance|. On ties, prefer a future alternative — guests usually
    // plan forward, and the same-season "drift later" feels more natural than
    // proposing a week from earlier in the year.
    const score = (w: AvailableWeek): [number, number] => {
      const delta = w.checkIn.getTime() - targetSunday.getTime();
      const isPast = delta < 0 ? 1 : 0;
      return [Math.abs(delta), isPast];
    };
    const closest = weeks.reduce((best, w) => {
      const [absBest, pastBest] = score(best);
      const [absCur, pastCur] = score(w);
      if (absCur !== absBest) return absCur < absBest ? w : best;
      return pastCur < pastBest ? w : best;
    });
    const offsetDays =
      (closest.checkIn.getTime() - targetSunday.getTime()) / DAY_MS;
    return {
      checkIn: closest.checkIn,
      checkOut: closest.checkOut,
      weeksOffsetFromTarget: Math.round(offsetDays / 7),
    };
  }

  async monthAvailabilitySummary(
    year: number,
    month: number,
  ): Promise<WeekWithPrice[]> {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return this.summarizeRange(start, end);
  }

  async multiMonthAvailabilitySummary(
    startMonth: { year: number; month: number },
    endMonth: { year: number; month: number },
  ): Promise<WeekWithPrice[]> {
    const start = new Date(Date.UTC(startMonth.year, startMonth.month - 1, 1));
    const end = new Date(Date.UTC(endMonth.year, endMonth.month, 1));
    return this.summarizeRange(start, end);
  }

  async getPricingForDateRange(
    checkIn: Date,
    checkOut: Date,
  ): Promise<Quote | null> {
    try {
      return await this.pricing.calculate(checkIn, checkOut);
    } catch (err) {
      this.logger.warn('pricing', 'helper pricing lookup failed', {
        checkIn: checkIn.toISOString().slice(0, 10),
        checkOut: checkOut.toISOString().slice(0, 10),
        error: (err as Error).message,
      });
      return null;
    }
  }

  async checkExistingHold(phone: string): Promise<Hold | null> {
    return this.holds.getActiveHoldForPhone(phone);
  }

  private async summarizeRange(
    start: Date,
    end: Date,
  ): Promise<WeekWithPrice[]> {
    const weeks = await this.availability.findAvailableSundayWeeks(start, end);
    const enriched: WeekWithPrice[] = [];
    for (const w of weeks) {
      const quote = await this.getPricingForDateRange(w.checkIn, w.checkOut);
      if (!quote) continue;
      enriched.push({
        checkIn: w.checkIn,
        checkOut: w.checkOut,
        total: quote.total,
        weeklyRate: quote.weeklyRate,
        label: quote.label,
        usedBase: quote.usedBase,
      });
    }
    return enriched;
  }

  private snapToSundayUtc(d: Date): Date {
    const result = new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const dow = result.getUTCDay();
    if (dow !== 0) {
      const forward = 7 - dow;
      result.setUTCDate(result.getUTCDate() + forward);
    }
    return result;
  }
}
