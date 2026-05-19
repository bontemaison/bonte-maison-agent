import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';
import { BookingRulesService } from './booking-rules.service';

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeAirtable = (
  flags: Record<string, string> = {},
): AirtableService => {
  return {
    list: jest.fn().mockImplementation((_table: string, options: { filterByFormula?: string } = {}) => {
      const match = options.filterByFormula?.match(/^\{key\}='(.+)'$/);
      const key = match?.[1];
      if (key && key in flags) {
        return Promise.resolve([
          { id: `rec-${key}`, fields: { key, value: flags[key], active: true } },
        ]);
      }
      return Promise.resolve([]);
    }),
  } as unknown as AirtableService;
};

const makeService = (flags: Record<string, string> = {}): BookingRulesService =>
  new BookingRulesService(makeAirtable(flags), makeLogger());

// Known Sundays
const SUN_2025_07_06 = new Date('2025-07-06'); // Sunday
const SUN_2025_07_13 = new Date('2025-07-13'); // Sunday
const SUN_2025_07_27 = new Date('2025-07-27'); // Sunday (21 nights from Jul 6)
const SUN_2025_09_07 = new Date('2025-09-07'); // Sunday
const SUN_2025_11_02 = new Date('2025-11-02'); // Sunday
const SUN_2025_11_30 = new Date('2025-11-30'); // Sunday (28 nights from Nov 2)
const MON_2025_07_07 = new Date('2025-07-07'); // Monday
const SAT_2025_07_12 = new Date('2025-07-12'); // Saturday
const SUN_2026_07_05 = new Date('2026-07-05'); // Sunday in 2026
const SUN_2026_07_12 = new Date('2026-07-12'); // Sunday in 2026

describe('BookingRulesService', () => {
  describe('2026 redirect', () => {
    it('blocks 2026 dates when year_2026_fully_booked=true', async () => {
      const svc = makeService({ year_2026_fully_booked: 'true' });
      const result = await svc.validate(SUN_2026_07_05, SUN_2026_07_12);
      expect(result).toEqual({ pass: false, reason: 'year_2026_redirect' });
    });

    it('allows 2026 dates when year_2026_fully_booked=false', async () => {
      const svc = makeService({ year_2026_fully_booked: 'false' });
      const result = await svc.validate(SUN_2026_07_05, SUN_2026_07_12);
      expect(result.pass).toBe(true);
    });

    it('allows 2026 dates when the flag row is missing', async () => {
      const svc = makeService();
      const result = await svc.validate(SUN_2026_07_05, SUN_2026_07_12);
      expect(result.pass).toBe(true);
    });

    it('allows 2025 dates regardless of flag', async () => {
      const svc = makeService({ year_2026_fully_booked: 'true' });
      const result = await svc.validate(SUN_2025_07_06, SUN_2025_07_13);
      expect(result.pass).toBe(true);
    });
  });

  describe('Sunday-to-Sunday validation', () => {
    it('blocks when check-in is not a Sunday and suggests next Sunday pair', async () => {
      const svc = makeService();
      const result = await svc.validate(MON_2025_07_07, SUN_2025_07_13);

      expect(result).toEqual({
        pass: false,
        reason: 'not_sunday',
        suggestedCheckIn: '2025-07-13', // next Sunday >= Jul 7
        suggestedCheckOut: '2025-07-20', // + 7 days
      });
    });

    it('blocks when check-out is not a Sunday and keeps Sunday check-in', async () => {
      const svc = makeService();
      const result = await svc.validate(SUN_2025_07_06, SAT_2025_07_12);

      expect(result).toEqual({
        pass: false,
        reason: 'not_sunday',
        suggestedCheckIn: '2025-07-06', // already Sunday
        suggestedCheckOut: '2025-07-13', // + 7 days
      });
    });

    it('blocks when both are non-Sunday', async () => {
      const svc = makeService();
      const result = await svc.validate(MON_2025_07_07, SAT_2025_07_12);
      expect(result.pass).toBe(false);
      if (!result.pass) expect(result.reason).toBe('not_sunday');
    });

    it('passes when both are Sundays', async () => {
      const svc = makeService();
      expect((await svc.validate(SUN_2025_07_06, SUN_2025_07_13)).pass).toBe(true);
    });
  });

  describe('minimum stay', () => {
    it('blocks when nights < 7 and suggests check-in + 7 days', async () => {
      const checkIn = new Date('2025-07-06'); // Sunday
      const checkOut = new Date('2025-07-06'); // same day — 0 nights
      const svc = makeService();
      const result = await svc.validate(checkIn, checkOut);

      expect(result).toEqual({
        pass: false,
        reason: 'min_stay',
        suggestedCheckIn: '2025-07-06',
        suggestedCheckOut: '2025-07-13',
      });
    });

    it('passes for a 7-night Sunday stay', async () => {
      const svc = makeService();
      expect((await svc.validate(SUN_2025_07_06, SUN_2025_07_13)).pass).toBe(true);
    });

    it('passes for a 14-night Sunday stay', async () => {
      const svc = makeService();
      const checkOut14 = new Date('2025-07-20'); // 14 nights from Jul 6
      expect((await svc.validate(SUN_2025_07_06, checkOut14)).pass).toBe(true);
    });

    it('passes for a 21-night Sunday stay', async () => {
      const svc = makeService();
      expect((await svc.validate(SUN_2025_07_06, SUN_2025_07_27)).pass).toBe(true);
    });
  });

  describe('long stay detection (Oct–May)', () => {
    it('blocks a 28-night stay starting in November', async () => {
      const svc = makeService();
      const result = await svc.validate(SUN_2025_11_02, SUN_2025_11_30);
      expect(result).toEqual({ pass: false, reason: 'long_stay_manual' });
    });

    it('allows a 28-night stay starting in July (summer)', async () => {
      const svc = makeService();
      const checkOut28 = new Date('2025-08-03'); // 28 nights from Jul 6 (Sunday)
      expect((await svc.validate(SUN_2025_07_06, checkOut28)).pass).toBe(true);
    });

    it('blocks a 28-night stay starting in October', async () => {
      const svc = makeService();
      const checkIn = new Date('2025-10-05'); // Sunday
      const checkOut = new Date('2025-11-02'); // Sunday, 28 nights later
      const result = await svc.validate(checkIn, checkOut);
      expect(result.pass).toBe(false);
      if (!result.pass) expect(result.reason).toBe('long_stay_manual');
    });

    it('blocks a 28-night stay starting in May', async () => {
      const svc = makeService();
      const checkIn = new Date('2025-05-04'); // Sunday
      const checkOut = new Date('2025-06-01'); // Sunday, 28 nights later
      const result = await svc.validate(checkIn, checkOut);
      expect(result.pass).toBe(false);
      if (!result.pass) expect(result.reason).toBe('long_stay_manual');
    });

    it('allows a 21-night stay in October (at or under limit)', async () => {
      const svc = makeService();
      const checkIn = new Date('2025-10-05'); // Sunday
      const checkOut = new Date('2025-10-26'); // Sunday, 21 nights later
      expect((await svc.validate(checkIn, checkOut)).pass).toBe(true);
    });
  });

  describe('validation order', () => {
    it('checks year_2026 before Sunday validation', async () => {
      const svc = makeService({ year_2026_fully_booked: 'true' });
      // non-Sunday 2026 dates — should get year_2026 not not_sunday
      const result = await svc.validate(new Date('2026-07-06'), new Date('2026-07-13'));
      if (!result.pass) expect(result.reason).toBe('year_2026_redirect');
    });

    it('checks Sunday before min_stay', async () => {
      const svc = makeService();
      // Monday-to-Tuesday (not Sunday, also < 7 nights) — should get not_sunday
      const result = await svc.validate(new Date('2025-07-07'), new Date('2025-07-08'));
      if (!result.pass) expect(result.reason).toBe('not_sunday');
    });
  });

  describe('isYearFullyBooked', () => {
    it('returns true for 2026 when flag is true', async () => {
      const svc = makeService({ year_2026_fully_booked: 'true' });
      expect(await svc.isYearFullyBooked(2026)).toBe(true);
    });

    it('returns false for 2026 when flag is false', async () => {
      const svc = makeService({ year_2026_fully_booked: 'false' });
      expect(await svc.isYearFullyBooked(2026)).toBe(false);
    });

    it('returns false for other years regardless of flag', async () => {
      const svc = makeService({ year_2026_fully_booked: 'true' });
      expect(await svc.isYearFullyBooked(2027)).toBe(false);
    });
  });

  describe('isInstantBookEnabled', () => {
    it('returns true when flag is "true"', async () => {
      const svc = makeService({ instant_book_enabled: 'true' });
      expect(await svc.isInstantBookEnabled()).toBe(true);
    });

    it('returns false when flag is "false"', async () => {
      const svc = makeService({ instant_book_enabled: 'false' });
      expect(await svc.isInstantBookEnabled()).toBe(false);
    });

    it('returns false when the flag row is missing', async () => {
      const svc = makeService();
      expect(await svc.isInstantBookEnabled()).toBe(false);
    });
  });

  describe('owner notification enable flags', () => {
    it('returns true when owner_notify_phone_enabled=true', async () => {
      const svc = makeService({ owner_notify_phone_enabled: 'true' });
      expect(await svc.isOwnerPhoneNotifyEnabled()).toBe(true);
    });

    it('returns false when owner_notify_phone_enabled=false', async () => {
      const svc = makeService({ owner_notify_phone_enabled: 'false' });
      expect(await svc.isOwnerPhoneNotifyEnabled()).toBe(false);
    });

    it('returns true when owner_notify_email_enabled=true', async () => {
      const svc = makeService({ owner_notify_email_enabled: 'true' });
      expect(await svc.isOwnerEmailNotifyEnabled()).toBe(true);
    });

    it('returns false when owner_notify_email_enabled=false', async () => {
      const svc = makeService({ owner_notify_email_enabled: 'false' });
      expect(await svc.isOwnerEmailNotifyEnabled()).toBe(false);
    });

    it('defaults to true when the flag row is missing (preserves existing behaviour pre-seed)', async () => {
      const svc = makeService();
      expect(await svc.isOwnerPhoneNotifyEnabled()).toBe(true);
      expect(await svc.isOwnerEmailNotifyEnabled()).toBe(true);
    });

    it('defaults to true and warns when the read fails', async () => {
      const logger = makeLogger();
      const airtable = {
        list: jest.fn().mockRejectedValue(new Error('boom')),
      } as unknown as AirtableService;
      const svc = new BookingRulesService(airtable, logger);
      expect(await svc.isOwnerPhoneNotifyEnabled()).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('Airtable failure', () => {
    it('treats flag as false and warns when the read fails', async () => {
      const logger = makeLogger();
      const airtable = {
        list: jest.fn().mockRejectedValue(new Error('boom')),
      } as unknown as AirtableService;
      const svc = new BookingRulesService(airtable, logger);
      expect(await svc.isInstantBookEnabled()).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // Keep references to suppress unused warnings in case linters get strict.
  void SUN_2025_09_07;
});
