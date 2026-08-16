import { AvailabilityService } from '../availability/availability.service';
import { HoldsService } from '../holds/holds.service';
import { LoggerService } from '../logger/logger.service';
import { PricingService } from '../pricing/pricing.service';
import { HelpersService } from './helpers.service';

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeAvailability = (
  weeks: Array<{ checkIn: string; checkOut: string }>,
): AvailabilityService =>
  ({
    findAvailableSundayWeeks: jest.fn().mockResolvedValue(
      weeks.map((w) => ({
        checkIn: new Date(w.checkIn),
        checkOut: new Date(w.checkOut),
      })),
    ),
  }) as unknown as AvailabilityService;

const makePricing = (
  byCheckIn: Record<string, { total: number; weeklyRate: number; label?: string }>,
): PricingService =>
  ({
    calculate: jest.fn().mockImplementation((ci: Date) => {
      const k = ci.toISOString().slice(0, 10);
      const q = byCheckIn[k];
      if (!q) throw new Error('no rule');
      return Promise.resolve({
        weeks: 1,
        nights: 7,
        weeklyRate: q.weeklyRate,
        label: q.label,
        subtotal: q.total,
        total: q.total,
        minWeeks: 0,
        meetsMinWeeks: true,
      });
    }),
  }) as unknown as PricingService;

const makeHolds = (active: { id: string } | null = null): HoldsService =>
  ({
    getActiveHoldForPhone: jest.fn().mockResolvedValue(active),
  }) as unknown as HoldsService;

describe('HelpersService.findClosestAvailableWeek', () => {
  it('returns the available week nearest to target', async () => {
    const target = new Date('2027-09-12'); // Sunday
    const availability = makeAvailability([
      { checkIn: '2027-09-19', checkOut: '2027-09-26' },
      { checkIn: '2027-10-03', checkOut: '2027-10-10' },
    ]);
    const svc = new HelpersService(
      availability,
      makePricing({}),
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.findClosestAvailableWeek(target);

    expect(result?.checkIn.toISOString().slice(0, 10)).toBe('2027-09-19');
    expect(result?.weeksOffsetFromTarget).toBe(1);
  });

  it('returns null when no weeks are available in the window', async () => {
    const svc = new HelpersService(
      makeAvailability([]),
      makePricing({}),
      makeHolds(),
      makeLogger(),
    );
    const result = await svc.findClosestAvailableWeek(new Date('2027-08-01'));
    expect(result).toBeNull();
  });
});

describe('HelpersService.monthAvailabilitySummary', () => {
  it('returns priced available weeks for a month', async () => {
    const availability = makeAvailability([
      { checkIn: '2027-09-05', checkOut: '2027-09-12' },
      { checkIn: '2027-09-19', checkOut: '2027-09-26' },
    ]);
    const pricing = makePricing({
      '2027-09-05': { total: 4500, weeklyRate: 4500, label: 'September 2027' },
      '2027-09-19': { total: 4500, weeklyRate: 4500, label: 'September 2027' },
    });
    const svc = new HelpersService(
      availability,
      pricing,
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.monthAvailabilitySummary(2027, 9);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      checkIn: new Date('2027-09-05'),
      checkOut: new Date('2027-09-12'),
      total: 4500,
      weeklyRate: 4500,
      label: 'September 2027',
    });
  });

  it('skips weeks with no pricing rule', async () => {
    const availability = makeAvailability([
      { checkIn: '2027-09-05', checkOut: '2027-09-12' },
      { checkIn: '2027-09-19', checkOut: '2027-09-26' },
    ]);
    const pricing = makePricing({
      '2027-09-19': { total: 4500, weeklyRate: 4500 },
    });
    const svc = new HelpersService(
      availability,
      pricing,
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.monthAvailabilitySummary(2027, 9);

    expect(result).toHaveLength(1);
    expect(result[0].checkIn.toISOString().slice(0, 10)).toBe('2027-09-19');
  });
});

describe('HelpersService.nearbyAvailabilitySummary', () => {
  it('queries a window spanning monthsBefore/monthsAfter around the target', async () => {
    const availability = makeAvailability([]);
    const svc = new HelpersService(
      availability,
      makePricing({}),
      makeHolds(),
      makeLogger(),
    );

    await svc.nearbyAvailabilitySummary(new Date('2026-09-15'));

    expect(availability.findAvailableSundayWeeks).toHaveBeenCalledWith(
      new Date(Date.UTC(2026, 6, 1)), // 2 months before September = July
      new Date(Date.UTC(2026, 11, 1)), // 2 months after September, exclusive = December
    );
  });

  it('returns priced weeks from the wider window', async () => {
    const availability = makeAvailability([
      { checkIn: '2026-10-04', checkOut: '2026-10-11' },
    ]);
    const pricing = makePricing({
      '2026-10-04': { total: 2495, weeklyRate: 2495, label: 'Low season' },
    });
    const svc = new HelpersService(
      availability,
      pricing,
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.nearbyAvailabilitySummary(new Date('2026-09-06'));

    expect(result).toEqual([
      {
        checkIn: new Date('2026-10-04'),
        checkOut: new Date('2026-10-11'),
        total: 2495,
        weeklyRate: 2495,
        label: 'Low season',
      },
    ]);
  });
});

describe('HelpersService.nearestAvailableWeeks', () => {
  it('returns the closest `count` weeks within the wide window, priced', async () => {
    const availability = makeAvailability([
      { checkIn: '2026-11-08', checkOut: '2026-11-15' }, // 3 weeks before
      { checkIn: '2026-11-29', checkOut: '2026-12-06' }, // exactly 1 week before
      { checkIn: '2026-12-13', checkOut: '2026-12-20' }, // 1 week after
      { checkIn: '2027-01-03', checkOut: '2027-01-10' }, // far after
    ]);
    const pricing = makePricing({
      '2026-11-29': { total: 2000, weeklyRate: 2000 },
      '2026-12-13': { total: 2200, weeklyRate: 2200 },
    });
    const svc = new HelpersService(
      availability,
      pricing,
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.nearestAvailableWeeks(
      new Date('2026-12-06'),
      2,
    );

    // Nov 29 and Dec 13 are equidistant (7 days); future wins the tie,
    // matching findClosestAvailableWeek's convention.
    expect(result.map((w) => w.checkIn.toISOString().slice(0, 10))).toEqual([
      '2026-12-13',
      '2026-11-29',
    ]);
  });

  it('only prices the selected weeks, not the whole window', async () => {
    const availability = makeAvailability([
      { checkIn: '2026-11-29', checkOut: '2026-12-06' },
      { checkIn: '2027-01-03', checkOut: '2027-01-10' },
    ]);
    const pricing = makePricing({
      '2026-11-29': { total: 2000, weeklyRate: 2000 },
    });
    const svc = new HelpersService(
      availability,
      pricing,
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.nearestAvailableWeeks(
      new Date('2026-12-06'),
      1,
    );

    expect(result).toHaveLength(1);
    expect((pricing.calculate as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('returns an empty array when nothing is open in the window', async () => {
    const svc = new HelpersService(
      makeAvailability([]),
      makePricing({}),
      makeHolds(),
      makeLogger(),
    );

    const result = await svc.nearestAvailableWeeks(new Date('2026-12-06'));

    expect(result).toEqual([]);
  });
});

describe('HelpersService.checkExistingHold', () => {
  it('proxies to holds service', async () => {
    const hold = {
      id: 'rec1',
      fields: {
        phone: '628',
        check_in: '2027-09-05',
        check_out: '2027-09-12',
        hold_created_at: '2027-09-01T00:00:00Z',
        hold_expires_at: '2027-09-06T00:00:00Z',
        reminder_sent: false,
        status: 'active' as const,
      },
    };
    const svc = new HelpersService(
      makeAvailability([]),
      makePricing({}),
      makeHolds(hold),
      makeLogger(),
    );
    expect(await svc.checkExistingHold('628')).toEqual(hold);
  });
});
