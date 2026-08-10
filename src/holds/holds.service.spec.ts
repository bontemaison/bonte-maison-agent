import { HoldsService } from './holds.service';
import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';

const makeLogger = () =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeAirtable = (rows: Array<{ id: string; fields: unknown }> = []) =>
  ({
    list: jest.fn().mockResolvedValue(rows),
    create: jest.fn().mockResolvedValue({ id: 'rec_new', fields: {} }),
    update: jest.fn().mockResolvedValue({}),
  }) as unknown as AirtableService;

const activeHoldRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec1',
  fields: {
    phone: '+441234567890',
    check_in: '2026-07-06',
    check_out: '2026-07-13',
    hold_expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    reminder_sent: false,
    status: 'active',
    ...overrides,
  },
});

describe('HoldsService', () => {
  describe('createHold', () => {
    it('writes a hold record with correct fields', async () => {
      const airtable = makeAirtable();
      const svc = new HoldsService(airtable, makeLogger());
      const checkIn = new Date('2026-07-06');
      const checkOut = new Date('2026-07-13');

      await svc.createHold('+441234567890', checkIn, checkOut);

      expect(airtable.create).toHaveBeenCalledWith(
        'Holds',
        expect.objectContaining({
          phone: '+441234567890',
          check_in: '2026-07-06',
          check_out: '2026-07-13',
          status: 'active',
          reminder_sent: false,
        }),
      );
    });

    it('sets hold_expires_at to 5 days after creation', async () => {
      const airtable = makeAirtable();
      const svc = new HoldsService(airtable, makeLogger());
      const now = new Date('2026-07-01T10:00:00Z');
      jest.useFakeTimers({ now });

      await svc.createHold('+44111', new Date('2026-07-06'), new Date('2026-07-13'));

      const fields = (airtable.create as jest.Mock).mock.calls[0][1];
      expect(fields.hold_expires_at).toBe('2026-07-06T10:00:00.000Z');

      jest.useRealTimers();
    });
  });

  describe('hasOverlap', () => {
    it('returns true when an active hold overlaps the requested range', async () => {
      const airtable = makeAirtable([activeHoldRow()]);
      const svc = new HoldsService(airtable, makeLogger());

      const result = await svc.hasOverlap(
        new Date('2026-07-06'),
        new Date('2026-07-13'),
      );

      expect(result).toBe(true);
    });

    it('returns false when no active holds exist', async () => {
      const airtable = makeAirtable([]);
      const svc = new HoldsService(airtable, makeLogger());

      const result = await svc.hasOverlap(
        new Date('2026-07-06'),
        new Date('2026-07-13'),
      );

      expect(result).toBe(false);
    });

    it('returns false when active hold is for non-overlapping dates', async () => {
      const airtable = makeAirtable([
        activeHoldRow({ check_in: '2026-07-20', check_out: '2026-07-27' }),
      ]);
      const svc = new HoldsService(airtable, makeLogger());

      const result = await svc.hasOverlap(
        new Date('2026-07-06'),
        new Date('2026-07-13'),
      );

      expect(result).toBe(false);
    });

    it('ignores expired holds when checking overlap', async () => {
      const airtable = makeAirtable([
        activeHoldRow({ status: 'expired' }),
      ]);
      const svc = new HoldsService(airtable, makeLogger());

      const result = await svc.hasOverlap(
        new Date('2026-07-06'),
        new Date('2026-07-13'),
      );

      expect(result).toBe(false);
    });

    // Regression: a hold whose expiry has passed but whose status column the
    // cron has not yet reconciled must not block a booking. This blocked
    // 2027-05-02 for ~24h because status was the only thing checked.
    it('ignores a lapsed hold still marked active', async () => {
      const airtable = makeAirtable([
        activeHoldRow({
          status: 'active',
          hold_expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
        }),
      ]);
      const svc = new HoldsService(airtable, makeLogger());

      const result = await svc.hasOverlap(
        new Date('2026-07-06'),
        new Date('2026-07-13'),
      );

      expect(result).toBe(false);
    });
  });

  describe('getActiveHoldForPhone', () => {
    it('returns the hold while it is still live', async () => {
      const airtable = makeAirtable([activeHoldRow()]);
      const svc = new HoldsService(airtable, makeLogger());

      expect(await svc.getActiveHoldForPhone('+441234567890')).not.toBeNull();
    });

    it('returns null for a lapsed hold still marked active', async () => {
      const airtable = makeAirtable([
        activeHoldRow({
          hold_expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
        }),
      ]);
      const svc = new HoldsService(airtable, makeLogger());

      expect(await svc.getActiveHoldForPhone('+441234567890')).toBeNull();
    });
  });

  describe('getActiveHoldForPhone', () => {
    it('returns the active hold for the given phone', async () => {
      const airtable = makeAirtable([activeHoldRow()]);
      const svc = new HoldsService(airtable, makeLogger());

      const hold = await svc.getActiveHoldForPhone('+441234567890');

      expect(hold).not.toBeNull();
      expect(hold?.id).toBe('rec1');
    });

    it('returns null when no active hold exists for the phone', async () => {
      const airtable = makeAirtable([]);
      const svc = new HoldsService(airtable, makeLogger());

      const hold = await svc.getActiveHoldForPhone('+441234567890');

      expect(hold).toBeNull();
    });
  });

  describe('listActive', () => {
    it('queries Airtable for active holds', async () => {
      const airtable = makeAirtable([activeHoldRow()]);
      const svc = new HoldsService(airtable, makeLogger());

      const holds = await svc.listActive();

      expect(airtable.list).toHaveBeenCalledWith(
        'Holds',
        expect.objectContaining({ filterByFormula: "{status}='active'" }),
      );
      expect(holds).toHaveLength(1);
    });
  });

  describe('setStatus', () => {
    it('calls airtable.update with the new status', async () => {
      const airtable = makeAirtable();
      const svc = new HoldsService(airtable, makeLogger());

      await svc.setStatus('rec1', 'expired');

      expect(airtable.update).toHaveBeenCalledWith('Holds', 'rec1', {
        status: 'expired',
      });
    });
  });

  describe('setReminderSent', () => {
    it('calls airtable.update with reminder_sent true', async () => {
      const airtable = makeAirtable();
      const svc = new HoldsService(airtable, makeLogger());

      await svc.setReminderSent('rec1');

      expect(airtable.update).toHaveBeenCalledWith('Holds', 'rec1', {
        reminder_sent: true,
      });
    });
  });
});
