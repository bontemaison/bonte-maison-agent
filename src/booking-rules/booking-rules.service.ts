import { Injectable } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_NIGHTS = 7;
const MAX_STANDARD_NIGHTS = 21;
// Months that trigger manual pricing for long stays: Oct(9) through May(4)
const LONG_STAY_MONTHS = new Set([9, 10, 11, 0, 1, 2, 3, 4]);

const YEAR_2026_FULLY_BOOKED_KEY = 'year_2026_fully_booked';
const INSTANT_BOOK_ENABLED_KEY = 'instant_book_enabled';
const OWNER_NOTIFY_PHONE_ENABLED_KEY = 'owner_notify_phone_enabled';
const OWNER_NOTIFY_EMAIL_ENABLED_KEY = 'owner_notify_email_enabled';

type BookingRulesFields = {
  key?: string;
  value?: string;
  active?: boolean;
};

export type RulesValidation =
  | { pass: true }
  | { pass: false; reason: 'year_2026_redirect' }
  | {
      pass: false;
      reason: 'not_sunday';
      suggestedCheckIn: string;
      suggestedCheckOut: string;
    }
  | {
      pass: false;
      reason: 'min_stay';
      suggestedCheckIn: string;
      suggestedCheckOut: string;
    }
  | { pass: false; reason: 'long_stay_manual' };

@Injectable()
export class BookingRulesService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly logger: LoggerService,
  ) {}

  async validate(checkIn: Date, checkOut: Date): Promise<RulesValidation> {
    if (
      checkIn.getUTCFullYear() === 2026 &&
      (await this.getBooleanFlag(YEAR_2026_FULLY_BOOKED_KEY))
    ) {
      return { pass: false, reason: 'year_2026_redirect' };
    }

    if (checkIn.getUTCDay() !== 0 || checkOut.getUTCDay() !== 0) {
      const suggestedCheckIn = this.nextSunday(checkIn);
      const suggestedCheckOut = new Date(
        suggestedCheckIn.getTime() + MIN_NIGHTS * DAY_MS,
      );
      return {
        pass: false,
        reason: 'not_sunday',
        suggestedCheckIn: this.isoDate(suggestedCheckIn),
        suggestedCheckOut: this.isoDate(suggestedCheckOut),
      };
    }

    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / DAY_MS,
    );

    if (nights < MIN_NIGHTS) {
      const suggestedCheckOut = new Date(
        checkIn.getTime() + MIN_NIGHTS * DAY_MS,
      );
      return {
        pass: false,
        reason: 'min_stay',
        suggestedCheckIn: this.isoDate(checkIn),
        suggestedCheckOut: this.isoDate(suggestedCheckOut),
      };
    }

    if (
      nights > MAX_STANDARD_NIGHTS &&
      LONG_STAY_MONTHS.has(checkIn.getUTCMonth())
    ) {
      return { pass: false, reason: 'long_stay_manual' };
    }

    return { pass: true };
  }

  /**
   * True when the bot should refuse a month-level query because the year is
   * fully booked. Used by the month-query path which has no concrete dates.
   */
  async isYearFullyBooked(year: number): Promise<boolean> {
    if (year !== 2026) return false;
    return this.getBooleanFlag(YEAR_2026_FULLY_BOOKED_KEY);
  }

  async isInstantBookEnabled(): Promise<boolean> {
    return this.getBooleanFlag(INSTANT_BOOK_ENABLED_KEY);
  }

  /**
   * Whether owner WhatsApp notifications are enabled. Defaults to true when
   * the row is missing so the env-configured OWNER_PHONE keeps receiving
   * notifications without requiring the seed script to have been run.
   */
  async isOwnerPhoneNotifyEnabled(): Promise<boolean> {
    return this.getBooleanFlag(OWNER_NOTIFY_PHONE_ENABLED_KEY, true);
  }

  /**
   * Whether owner email notifications are enabled. Defaults to true when the
   * row is missing.
   */
  async isOwnerEmailNotifyEnabled(): Promise<boolean> {
    return this.getBooleanFlag(OWNER_NOTIFY_EMAIL_ENABLED_KEY, true);
  }

  private async getBooleanFlag(
    key: string,
    defaultValue: boolean = false,
  ): Promise<boolean> {
    try {
      const rows = await this.airtable.list<BookingRulesFields>(
        'BookingRules',
        {
          filterByFormula: `{key}='${key}'`,
          maxRecords: 1,
        },
      );
      const raw = rows[0]?.fields.value;
      if (raw === undefined || raw === null || raw === '') return defaultValue;
      return this.parseBooleanValue(raw);
    } catch (err) {
      this.logger.warn('booking-rules', 'flag read failed; using default', {
        key,
        defaultValue,
        error: (err as Error).message,
      });
      return defaultValue;
    }
  }

  private parseBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes';
    }
    return false;
  }

  private nextSunday(date: Date): Date {
    const daysUntilSunday = (7 - date.getUTCDay()) % 7;
    return new Date(date.getTime() + daysUntilSunday * DAY_MS);
  }

  private isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
