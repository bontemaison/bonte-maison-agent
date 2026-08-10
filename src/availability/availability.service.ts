import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ical from 'node-ical';
import { LoggerService } from '../logger/logger.service';
import { DAY_MS, floatingDateToUtc, nextSunday } from '../common/dates';

type VEvent = { type: 'VEVENT'; start: Date; end: Date; summary?: string };

@Injectable()
export class AvailabilityService {
  private readonly icalUrl: string;

  constructor(
    config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const url = config.get<string>('ICAL_URL');
    if (!url) throw new Error('ICAL_URL must be set');
    this.icalUrl = url;
  }

  async isRangeAvailable(checkIn: Date, checkOut: Date): Promise<boolean> {
    if (checkOut.getTime() <= checkIn.getTime()) {
      throw new Error('checkOut must be after checkIn');
    }

    const events = await this.fetchEvents();

    return !this.eventsOverlapRange(events, checkIn, checkOut);
  }

  /**
   * Returns Sunday-to-Sunday week ranges within [rangeStart, rangeEnd) that
   * have no overlap with any iCal event. Single iCal fetch.
   */
  async findAvailableSundayWeeks(
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<Array<{ checkIn: Date; checkOut: Date }>> {
    if (rangeEnd.getTime() <= rangeStart.getTime()) {
      throw new Error('rangeEnd must be after rangeStart');
    }
    const events = await this.fetchEvents();
    const out: Array<{ checkIn: Date; checkOut: Date }> = [];
    const cursor = nextSunday(rangeStart);
    while (cursor.getTime() < rangeEnd.getTime()) {
      const checkIn = new Date(cursor.getTime());
      const checkOut = new Date(cursor.getTime() + 7 * DAY_MS);
      if (!this.eventsOverlapRange(events, checkIn, checkOut)) {
        out.push({ checkIn, checkOut });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return out;
  }

  /**
   * The SuperControl feed emits floating datetimes (`20270509T000000` — no `Z`,
   * no `TZID`), which node-ical resolves in the server's local zone. Left alone,
   * a UTC+7 server reads 9 May as 2027-05-08T17:00Z and the preceding week looks
   * booked. Re-anchor to UTC midnight so range checks are timezone-independent.
   */
  private normaliseEvent(e: VEvent): VEvent {
    const tz = (e.start as unknown as { tz?: string }).tz;
    if (tz) {
      this.logger.warn(
        'availability',
        'iCal event carries a timezone; left as parsed',
        { summary: e.summary, tz },
      );
      return e;
    }
    return {
      ...e,
      start: floatingDateToUtc(e.start),
      end: floatingDateToUtc(e.end),
    };
  }

  private eventsOverlapRange(
    events: VEvent[],
    checkIn: Date,
    checkOut: Date,
  ): boolean {
    return events.some(
      (e) =>
        e.start.getTime() < checkOut.getTime() &&
        e.end.getTime() > checkIn.getTime(),
    );
  }

  private async fetchEvents(): Promise<VEvent[]> {
    try {
      const parsed = await ical.async.fromURL(this.icalUrl);
      const events = Object.values(parsed).filter(
        (entry) => (entry as { type?: string }).type === 'VEVENT',
      ) as unknown as VEvent[];
      return events.map((e) => this.normaliseEvent(e));
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error('availability', 'iCal fetch failed', {
        url: this.icalUrl,
        error: message,
      });
      throw err;
    }
  }
}
