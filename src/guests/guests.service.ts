import { Injectable } from '@nestjs/common';
import { AirtableRecord, AirtableService } from '../airtable/airtable.service';
import { parseIsoDate, startOfUtcDay } from '../common/dates';
import { normalizePhone } from '../common/phone';
import { Hold, HoldsService } from '../holds/holds.service';
import { LoggerService } from '../logger/logger.service';
import { ParsedBooking } from '../email-integration/booking-email.parser';

const TABLE = 'Guests';

export type GuestMode =
  | 'prospect'
  | 'hold'
  | 'future_guest'
  | 'current_guest'
  | 'past_guest';

export type GuestSource = 'supercontrol_email' | 'backfill' | 'manual';

export type GuestFields = {
  booking_ref?: string;
  phone?: string;
  phone_raw?: string;
  guest_name?: string;
  email?: string;
  check_in?: string;
  check_out?: string;
  adults?: number;
  children?: number;
  infants?: number;
  /** Not in the booking email — Jim fills these in by hand. */
  dogs?: number;
  cot_or_highchair?: boolean;
  preferences?: string;
  operational_notes?: string;
  property?: string;
  source?: GuestSource;
  created_at?: string;
};

export type Guest = AirtableRecord<GuestFields>;

export type GuestContext = {
  mode: GuestMode;
  /** The booking that decided the mode, if any. */
  guest: Guest | null;
  previousStays: number;
  lastStay: { checkIn: string; checkOut: string } | null;
  hold: Hold | null;
};

const PROSPECT: GuestContext = {
  mode: 'prospect',
  guest: null,
  previousStays: 0,
  lastStay: null,
  hold: null,
};

type DatedGuest = { row: Guest; checkIn: Date; checkOut: Date };

@Injectable()
export class GuestsService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly holds: HoldsService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Resolves which stage of the guest journey a phone number is at.
   *
   * Stay status is derived here against today's date rather than stored, so a
   * guest moves future → current → past with no edit in Airtable.
   *
   * **Never throws.** A lookup failure logs and degrades to `prospect`, which
   * is exactly today's behaviour — a message must never be dropped because the
   * recognition layer was unavailable.
   */
  async resolveContext(phone: string): Promise<GuestContext> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      this.logger.debug('guests', 'unusable phone; treating as prospect', {
        phone,
      });
      return PROSPECT;
    }

    let bookings: DatedGuest[];
    try {
      bookings = this.withDates(await this.findByPhone(normalized));
    } catch (err) {
      this.logger.warn('guests', 'lookup failed; treating as prospect', {
        phone: normalized,
        error: (err as Error).message,
      });
      return PROSPECT;
    }

    const today = startOfUtcDay(new Date());
    const t = today.getTime();

    // Arrival and departure day both count as in-stay: a departure-morning
    // question is still an in-stay question.
    const current = bookings.find(
      (b) => b.checkIn.getTime() <= t && t <= b.checkOut.getTime(),
    );
    const future = bookings
      .filter((b) => b.checkIn.getTime() > t)
      .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())[0];
    const past = bookings
      .filter((b) => b.checkOut.getTime() < t)
      .sort((a, b) => b.checkOut.getTime() - a.checkOut.getTime());

    const hold = await this.activeHold(normalized);

    const decided = current ?? future ?? past[0] ?? null;
    const mode: GuestMode = current
      ? 'current_guest'
      : future
        ? 'future_guest'
        : hold
          ? 'hold'
          : past.length > 0
            ? 'past_guest'
            : 'prospect';

    const ctx: GuestContext = {
      mode,
      // On a bare hold there is no booking to describe.
      guest:
        mode === 'hold' || mode === 'prospect' ? null : (decided?.row ?? null),
      previousStays: past.length,
      lastStay: past[0]
        ? {
            checkIn: past[0].row.fields.check_in as string,
            checkOut: past[0].row.fields.check_out as string,
          }
        : null,
      hold,
    };

    if (ctx.mode !== 'prospect') {
      this.logger.info('guests', 'recognised guest', {
        phone: normalized,
        mode: ctx.mode,
        bookingRef: ctx.guest?.fields.booking_ref,
        previousStays: ctx.previousStays,
      });
    }
    return ctx;
  }

  async findByPhone(phone: string): Promise<Guest[]> {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    return this.airtable.list<GuestFields>(TABLE, {
      filterByFormula: `{phone}='${normalized}'`,
      sort: [{ field: 'check_in', direction: 'asc' }],
    });
  }

  async findByEmail(email: string): Promise<Guest[]> {
    const safe = email.trim().toLowerCase().replace(/'/g, "\\'");
    if (!safe) return [];
    return this.airtable.list<GuestFields>(TABLE, {
      filterByFormula: `LOWER({email})='${safe}'`,
      sort: [{ field: 'check_in', direction: 'desc' }],
    });
  }

  /**
   * Creates or updates the row for a booking. Keyed on `booking_ref` so
   * re-parsing the same email — a redelivery, or a backfill run over mail that
   * was already ingested — is idempotent.
   *
   * Only the fields SuperControl owns are written. `dogs`, `cot_or_highchair`,
   * `preferences` and `operational_notes` are Jim's, and a replay must never
   * wipe them.
   */
  async upsertByBookingRef(
    booking: ParsedBooking,
    source: GuestSource,
  ): Promise<Guest> {
    const fields: GuestFields = {
      booking_ref: booking.bookingRef,
      phone: booking.phone ?? '',
      phone_raw: booking.phoneRaw ?? '',
      guest_name: booking.guestName,
      email: booking.email ?? '',
      check_in: booking.checkIn,
      check_out: booking.checkOut,
      adults: booking.adults,
      children: booking.children,
      infants: booking.infants,
      source,
    };

    const existing = await this.findByBookingRef(booking.bookingRef);
    if (existing) {
      const updated = await this.airtable.update<GuestFields>(
        TABLE,
        existing.id,
        fields,
      );
      this.logger.info('guests', 'booking updated', {
        bookingRef: booking.bookingRef,
        phone: booking.phone,
      });
      return updated;
    }

    const created = await this.airtable.create<GuestFields>(TABLE, {
      ...fields,
      property: 'Bonté Maison',
      created_at: new Date().toISOString(),
    });
    this.logger.info('guests', 'booking created', {
      bookingRef: booking.bookingRef,
      phone: booking.phone,
      checkIn: booking.checkIn,
    });
    return created;
  }

  private async findByBookingRef(bookingRef: string): Promise<Guest | null> {
    const rows = await this.airtable.list<GuestFields>(TABLE, {
      filterByFormula: `{booking_ref}='${bookingRef}'`,
      maxRecords: 1,
    });
    return rows[0] ?? null;
  }

  /** A holds failure must not cost us a booking we already resolved. */
  private async activeHold(phone: string): Promise<Hold | null> {
    try {
      return await this.holds.getActiveHoldForPhone(phone);
    } catch (err) {
      this.logger.warn('guests', 'hold lookup failed', {
        phone,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /** Drops rows we cannot place on the calendar instead of failing the lookup. */
  private withDates(rows: Guest[]): DatedGuest[] {
    const out: DatedGuest[] = [];
    for (const row of rows) {
      const { check_in, check_out, booking_ref } = row.fields;
      if (!check_in || !check_out) continue;
      try {
        out.push({
          row,
          checkIn: parseIsoDate(check_in),
          checkOut: parseIsoDate(check_out),
        });
      } catch {
        this.logger.warn('guests', 'skipping guest row with unusable dates', {
          bookingRef: booking_ref,
          check_in,
          check_out,
        });
      }
    }
    return out;
  }
}
