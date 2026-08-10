import { Injectable } from '@nestjs/common';
import { AirtableRecord, AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';
import { DAY_MS, formatIsoDate, parseIsoDate } from '../common/dates';

export type HoldStatus = 'active' | 'expired' | 'converted' | 'cancelled';

type HoldFields = {
  phone: string;
  check_in: string;
  check_out: string;
  hold_created_at: string;
  hold_expires_at: string;
  reminder_sent: boolean;
  status: HoldStatus;
};

export type Hold = AirtableRecord<HoldFields>;

const HOLD_DAYS = 5;

/**
 * A hold is expired the instant `hold_expires_at` passes. The `status` column is
 * a cache for Jim's CRM view that the cron reconciles afterwards — never the
 * source of truth, or a hold blocks bookings until the next cron tick.
 */
export function isLapsed(hold: Hold, now: Date = new Date()): boolean {
  return new Date(hold.fields.hold_expires_at).getTime() <= now.getTime();
}

@Injectable()
export class HoldsService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly logger: LoggerService,
  ) {}

  async createHold(phone: string, checkIn: Date, checkOut: Date): Promise<Hold> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_DAYS * DAY_MS);

    const fields: HoldFields = {
      phone,
      check_in: formatIsoDate(checkIn),
      check_out: formatIsoDate(checkOut),
      hold_created_at: now.toISOString(),
      hold_expires_at: expiresAt.toISOString(),
      reminder_sent: false,
      status: 'active',
    };

    const record = await this.airtable.create<HoldFields>('Holds', fields);
    this.logger.info('holds', 'hold created', {
      phone,
      checkIn: fields.check_in,
      checkOut: fields.check_out,
      expiresAt: fields.hold_expires_at,
    });
    return record;
  }

  async hasOverlap(checkIn: Date, checkOut: Date): Promise<boolean> {
    const now = new Date();
    const active = await this.listActive();
    return active.some((h) => {
      // Both guards: `listActive` filters on status server-side, but a hold is
      // only really live if its expiry is also still ahead of us.
      if (h.fields.status !== 'active' || isLapsed(h, now)) return false;
      const hIn = parseIsoDate(h.fields.check_in);
      const hOut = parseIsoDate(h.fields.check_out);
      return hIn < checkOut && hOut > checkIn;
    });
  }

  async getActiveHoldForPhone(phone: string): Promise<Hold | null> {
    const rows = await this.airtable.list<HoldFields>('Holds', {
      filterByFormula: `AND({phone}='${phone}', {status}='active')`,
    });
    const now = new Date();
    return (
      rows.find((h) => h.fields.status === 'active' && !isLapsed(h, now)) ?? null
    );
  }

  async listActive(): Promise<Hold[]> {
    return this.airtable.list<HoldFields>('Holds', {
      filterByFormula: "{status}='active'",
    });
  }

  async setStatus(id: string, status: HoldStatus): Promise<void> {
    await this.airtable.update<HoldFields>('Holds', id, { status });
  }

  async setReminderSent(id: string): Promise<void> {
    await this.airtable.update<HoldFields>('Holds', id, { reminder_sent: true });
  }
}
