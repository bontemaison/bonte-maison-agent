import { AirtableService } from '../airtable/airtable.service';
import { HoldsService } from '../holds/holds.service';
import { LoggerService } from '../logger/logger.service';
import { GuestsService } from './guests.service';

const makeLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeAirtable = (rows: Array<{ id: string; fields: unknown }> = []) =>
  ({
    list: jest.fn().mockResolvedValue(rows),
    create: jest.fn().mockResolvedValue({ id: 'rec_new', fields: {} }),
    update: jest.fn().mockResolvedValue({ id: 'rec_upd', fields: {} }),
  }) as unknown as AirtableService;

const makeHolds = (hold: unknown = null) =>
  ({
    getActiveHoldForPhone: jest.fn().mockResolvedValue(hold),
  }) as unknown as HoldsService;

const guestRow = (
  bookingRef: string,
  checkIn: string,
  checkOut: string,
  extra: Record<string, unknown> = {},
) => ({
  id: `rec_${bookingRef}`,
  fields: {
    booking_ref: bookingRef,
    phone: '447877023353',
    guest_name: 'Abigail Johns',
    email: 'asjohns95@gmail.com',
    check_in: checkIn,
    check_out: checkOut,
    adults: 4,
    children: 2,
    infants: 2,
    ...extra,
  },
});

// Every case is pinned to a fixed "today" so the suite is stable and does not
// drift with the calendar. Stay status is derived at lookup, never stored.
const TODAY = new Date('2027-05-25T09:30:00Z');

const build = (
  rows: Array<{ id: string; fields: unknown }>,
  hold: unknown = null,
) => new GuestsService(makeAirtable(rows), makeHolds(hold), makeLogger());

describe('GuestsService.resolveContext', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(TODAY);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns prospect when no booking and no hold exists', async () => {
    const ctx = await build([]).resolveContext('447877023353');
    expect(ctx.mode).toBe('prospect');
    expect(ctx.guest).toBeNull();
    expect(ctx.previousStays).toBe(0);
  });

  it('recognises a guest mid-stay', async () => {
    const ctx = await build([
      guestRow('33', '2027-05-23', '2027-05-30'),
    ]).resolveContext('447877023353');
    expect(ctx.mode).toBe('current_guest');
    expect(ctx.guest?.fields.booking_ref).toBe('33');
  });

  it('treats arrival day and departure day as in-stay', async () => {
    // Departure-morning questions ("what time do we need to be out?") are
    // in-stay questions, so the last day counts as current.
    jest.setSystemTime(new Date('2027-05-23T06:00:00Z'));
    expect(
      (
        await build([
          guestRow('33', '2027-05-23', '2027-05-30'),
        ]).resolveContext('447877023353')
      ).mode,
    ).toBe('current_guest');

    jest.setSystemTime(new Date('2027-05-30T06:00:00Z'));
    expect(
      (
        await build([
          guestRow('33', '2027-05-23', '2027-05-30'),
        ]).resolveContext('447877023353')
      ).mode,
    ).toBe('current_guest');

    jest.setSystemTime(new Date('2027-05-31T06:00:00Z'));
    expect(
      (
        await build([
          guestRow('33', '2027-05-23', '2027-05-30'),
        ]).resolveContext('447877023353')
      ).mode,
    ).toBe('past_guest');

    jest.setSystemTime(TODAY);
  });

  it('picks the soonest upcoming booking for a future guest', async () => {
    const ctx = await build([
      guestRow('40', '2028-08-06', '2028-08-13'),
      guestRow('39', '2027-07-04', '2027-07-11'),
    ]).resolveContext('447877023353');
    expect(ctx.mode).toBe('future_guest');
    expect(ctx.guest?.fields.booking_ref).toBe('39');
  });

  // A paid booking outranks a speculative hold, whichever way round they fall.
  it('prefers a confirmed future booking over an active hold', async () => {
    const ctx = await build([guestRow('39', '2027-07-04', '2027-07-11')], {
      id: 'hold1',
      fields: { phone: '447877023353' },
    }).resolveContext('447877023353');
    expect(ctx.mode).toBe('future_guest');
    expect(ctx.hold).not.toBeNull();
  });

  it('falls back to hold when there is no booking', async () => {
    const ctx = await build([], {
      id: 'hold1',
      fields: { phone: '447877023353' },
    }).resolveContext('447877023353');
    expect(ctx.mode).toBe('hold');
  });

  it('counts previous stays and reports the most recent one', async () => {
    const ctx = await build([
      guestRow('20', '2025-06-01', '2025-06-08'),
      guestRow('27', '2026-06-07', '2026-06-14'),
    ]).resolveContext('447877023353');
    expect(ctx.mode).toBe('past_guest');
    expect(ctx.previousStays).toBe(2);
    expect(ctx.lastStay).toEqual({
      checkIn: '2026-06-07',
      checkOut: '2026-06-14',
    });
    expect(ctx.guest?.fields.booking_ref).toBe('27');
  });

  it('still counts past stays for a returning guest with an upcoming booking', async () => {
    const ctx = await build([
      guestRow('27', '2026-06-07', '2026-06-14'),
      guestRow('39', '2027-07-04', '2027-07-11'),
    ]).resolveContext('447877023353');
    expect(ctx.mode).toBe('future_guest');
    expect(ctx.previousStays).toBe(1);
  });

  it('normalises the lookup phone so wa_id and email formats agree', async () => {
    const airtable = makeAirtable([guestRow('33', '2027-05-23', '2027-05-30')]);
    const svc = new GuestsService(airtable, makeHolds(), makeLogger());
    await svc.resolveContext('+44 7877 023353');
    expect(airtable.list).toHaveBeenCalledWith(
      'Guests',
      expect.objectContaining({
        filterByFormula: "{phone}='447877023353'",
      }),
    );
  });

  it('ignores rows with unusable dates rather than failing the lookup', async () => {
    const ctx = await build([
      guestRow('99', 'not-a-date', ''),
      guestRow('33', '2027-05-23', '2027-05-30'),
    ]).resolveContext('447877023353');
    expect(ctx.mode).toBe('current_guest');
  });

  // A lookup failure must degrade to today's prospect behaviour, never drop
  // the guest's message.
  it('falls back to prospect when Airtable throws', async () => {
    const airtable = {
      list: jest.fn().mockRejectedValue(new Error('airtable down')),
    } as unknown as AirtableService;
    const logger = makeLogger();
    const ctx = await new GuestsService(
      airtable,
      makeHolds(),
      logger,
    ).resolveContext('447877023353');
    expect(ctx.mode).toBe('prospect');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('still resolves a booking when the holds lookup throws', async () => {
    const holds = {
      getActiveHoldForPhone: jest.fn().mockRejectedValue(new Error('nope')),
    } as unknown as HoldsService;
    const svc = new GuestsService(
      makeAirtable([guestRow('33', '2027-05-23', '2027-05-30')]),
      holds,
      makeLogger(),
    );
    expect((await svc.resolveContext('447877023353')).mode).toBe(
      'current_guest',
    );
  });

  it('returns prospect for an unusable phone without hitting Airtable', async () => {
    const airtable = makeAirtable([]);
    const svc = new GuestsService(airtable, makeHolds(), makeLogger());
    expect((await svc.resolveContext('')).mode).toBe('prospect');
    expect(airtable.list).not.toHaveBeenCalled();
  });
});

describe('GuestsService.upsertByBookingRef', () => {
  const input = {
    bookingRef: '33',
    guestName: 'Abigail Johns',
    firstName: 'Abigail',
    email: 'asjohns95@gmail.com',
    phone: '447877023353',
    phoneRaw: '+447877023353',
    checkIn: '2027-05-23',
    checkOut: '2027-05-30',
    adults: 4,
    children: 2,
    infants: 2,
  };

  it('creates a new row keyed on the booking reference', async () => {
    const airtable = makeAirtable([]);
    const svc = new GuestsService(airtable, makeHolds(), makeLogger());
    await svc.upsertByBookingRef(input, 'supercontrol_email');

    expect(airtable.create).toHaveBeenCalledWith(
      'Guests',
      expect.objectContaining({
        booking_ref: '33',
        phone: '447877023353',
        check_in: '2027-05-23',
        check_out: '2027-05-30',
        adults: 4,
        source: 'supercontrol_email',
      }),
    );
  });

  it('updates in place when the booking already exists, so replays are safe', async () => {
    const airtable = makeAirtable([guestRow('33', '2027-05-23', '2027-05-30')]);
    const svc = new GuestsService(airtable, makeHolds(), makeLogger());
    await svc.upsertByBookingRef(input, 'supercontrol_email');

    expect(airtable.create).not.toHaveBeenCalled();
    expect(airtable.update).toHaveBeenCalledWith(
      'Guests',
      'rec_33',
      expect.objectContaining({ booking_ref: '33' }),
    );
  });

  // Jim's manual columns must survive a re-parse of the same email.
  it('never overwrites the fields Jim maintains by hand', async () => {
    const airtable = makeAirtable([guestRow('33', '2027-05-23', '2027-05-30')]);
    const svc = new GuestsService(airtable, makeHolds(), makeLogger());
    await svc.upsertByBookingRef(input, 'supercontrol_email');

    const patch = (airtable.update as jest.Mock).mock.calls[0][2];
    expect(patch).not.toHaveProperty('dogs');
    expect(patch).not.toHaveProperty('operational_notes');
    expect(patch).not.toHaveProperty('preferences');
    expect(patch).not.toHaveProperty('cot_or_highchair');
    expect(patch).not.toHaveProperty('created_at');
  });

  it('writes an empty phone rather than dropping a booking without one', async () => {
    const airtable = makeAirtable([]);
    const svc = new GuestsService(airtable, makeHolds(), makeLogger());
    await svc.upsertByBookingRef(
      { ...input, phone: null, phoneRaw: null },
      'backfill',
    );

    expect(airtable.create).toHaveBeenCalledWith(
      'Guests',
      expect.objectContaining({ booking_ref: '33', phone: '' }),
    );
  });
});
