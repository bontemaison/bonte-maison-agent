import { Injectable } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';

export type PricingRule = {
  startDate: Date;
  endDate: Date;
  weeklyRate: number;
  minWeeks?: number;
  label?: string;
};

/**
 * Fallback weekly rate applied when no seasonal band covers the check-in date.
 * Stored in Airtable as a Pricing row with a `weekly_rate` but no
 * `start_date` / `end_date`.
 */
export type BaseRate = {
  weeklyRate: number;
  minWeeks?: number;
  label?: string;
};

export type Quote = {
  weeks: number;
  nights: number;
  weeklyRate: number;
  label?: string;
  subtotal: number;
  total: number;
  minWeeks: number;
  meetsMinWeeks: boolean;
  /**
   * True when no seasonal band covered the check-in and the base/fallback rate
   * was used. Signals an unpriced period (e.g. a future year Jim hasn't set
   * rates for yet) — callers should NOT present this as a firm quote.
   */
  usedBase: boolean;
};

type PricingFields = {
  start_date?: string;
  end_date?: string;
  weekly_rate?: number;
  min_weeks?: number;
  label?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PricingService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly logger: LoggerService,
  ) {}

  async calculate(checkIn: Date, checkOut: Date): Promise<Quote> {
    const rows = await this.airtable.list<PricingFields>('Pricing');
    const rules: PricingRule[] = [];
    let base: BaseRate | undefined;
    for (const row of rows) {
      const f = row.fields;
      if (typeof f.weekly_rate !== 'number') {
        this.logger.warn('pricing', 'skipping malformed pricing row', {
          id: row.id,
        });
        continue;
      }
      // A row with a rate but no date range is the base/fallback rate, applied
      // to any check-in not covered by a specific seasonal band (e.g. years
      // beyond the seeded bands). Last dateless row wins.
      if (!f.start_date || !f.end_date) {
        base = {
          weeklyRate: f.weekly_rate,
          minWeeks: f.min_weeks,
          label: f.label ?? 'base',
        };
        continue;
      }
      rules.push({
        startDate: new Date(f.start_date),
        endDate: new Date(f.end_date),
        weeklyRate: f.weekly_rate,
        minWeeks: f.min_weeks,
        label: f.label,
      });
    }
    return this.quote(rules, checkIn, checkOut, base);
  }

  quote(
    rules: PricingRule[],
    checkIn: Date,
    checkOut: Date,
    base?: BaseRate,
  ): Quote {
    if (checkOut.getTime() <= checkIn.getTime()) {
      throw new Error('checkOut must be after checkIn');
    }

    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / DAY_MS,
    );
    if (nights % 7 !== 0) {
      throw new Error(
        `stay length must be a multiple of 7 nights (got ${nights})`,
      );
    }
    const weeks = nights / 7;

    let rule = this.pickRule(rules, checkIn);
    let usedBase = false;
    if (!rule) {
      if (!base) {
        throw new Error(
          `no pricing rule covers check-in ${checkIn.toISOString().slice(0, 10)}`,
        );
      }
      this.logger.info('pricing', 'no band matched; using base rate', {
        checkIn: checkIn.toISOString().slice(0, 10),
        weeklyRate: base.weeklyRate,
      });
      usedBase = true;
      rule = {
        startDate: checkIn,
        endDate: checkOut,
        weeklyRate: base.weeklyRate,
        minWeeks: base.minWeeks,
        label: base.label,
      };
    }

    const subtotal = weeks * rule.weeklyRate;
    const minWeeks = rule.minWeeks ?? 0;

    return {
      weeks,
      nights,
      weeklyRate: rule.weeklyRate,
      label: rule.label,
      subtotal,
      total: subtotal,
      minWeeks,
      meetsMinWeeks: weeks >= minWeeks,
      usedBase,
    };
  }

  private pickRule(rules: PricingRule[], checkIn: Date): PricingRule | undefined {
    const t = checkIn.getTime();
    // End dates are exclusive: a check-in on a band's end_date belongs to the
    // next band, not this one. Bands in Airtable are stored as adjacent ranges
    // (each end_date == the next band's start_date), so without this the
    // boundary day matches both and `narrowest` wins arbitrarily — e.g. 11 Jul
    // 2027 was picking Summer (£3,995) instead of High Summer (£4,995).
    const matching = rules.filter(
      (r) => r.startDate.getTime() <= t && r.endDate.getTime() > t,
    );
    if (matching.length === 0) return undefined;
    return matching.reduce((narrowest, r) => {
      const span = (x: PricingRule) =>
        x.endDate.getTime() - x.startDate.getTime();
      return span(r) < span(narrowest) ? r : narrowest;
    });
  }
}
