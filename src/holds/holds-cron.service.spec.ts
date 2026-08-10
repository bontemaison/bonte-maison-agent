import { HoldsCronService } from './holds-cron.service';
import { HoldsService, Hold } from './holds.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MessageLogService } from '../messagelog/messagelog.service';
import { TemplatesService } from '../templates/templates.service';
import { LoggerService } from '../logger/logger.service';

const makeLogger = () =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeResponse = (text = 'rendered') =>
  ({ render: jest.fn().mockResolvedValue(text) }) as unknown as TemplatesService;

const makeWhatsapp = () =>
  ({ sendMessage: jest.fn().mockResolvedValue(undefined) }) as unknown as WhatsappService;

const makeMessageLog = () =>
  ({ log: jest.fn().mockResolvedValue(undefined) }) as unknown as MessageLogService;

const makeHolds = (active: Hold[] = []) =>
  ({
    listActive: jest.fn().mockResolvedValue(active),
    setReminderSent: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
  }) as unknown as HoldsService;

const holdFixture = (overrides: Partial<Hold['fields']> = {}): Hold => {
  const now = new Date();
  return {
    id: 'rec1',
    fields: {
      phone: '+441234567890',
      check_in: '2026-07-06',
      check_out: '2026-07-13',
      hold_created_at: now.toISOString(),
      hold_expires_at: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      reminder_sent: false,
      status: 'active',
      ...overrides,
    },
  };
};

describe('HoldsCronService', () => {
  describe('runDailyCheck', () => {
    it('sends hold_reminder and marks reminder_sent for holds expiring tomorrow (day 4)', async () => {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);

      const hold = holdFixture({ hold_expires_at: tomorrow.toISOString(), reminder_sent: false });
      const holds = makeHolds([hold]);
      const whatsapp = makeWhatsapp();
      const messageLog = makeMessageLog();
      const response = makeResponse('reminder text');
      const svc = new HoldsCronService(holds, whatsapp, messageLog, response, makeLogger());

      await svc.runDailyCheck();

      expect(response.render).toHaveBeenCalledWith('hold_reminder', expect.objectContaining({ phone: '+441234567890' }));
      expect(whatsapp.sendMessage).toHaveBeenCalledWith('+441234567890', 'reminder text');
      expect(holds.setReminderSent).toHaveBeenCalledWith('rec1');
      expect(holds.setStatus).not.toHaveBeenCalled();
    });

    // Regression: at a 15-minute cadence, notifying before claiming would
    // re-send to the guest on every tick if the status write ever failed.
    it('claims the status before notifying an expired hold', async () => {
      const hold = holdFixture({
        hold_expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      const holds = makeHolds([hold]);
      const whatsapp = makeWhatsapp();
      const order: string[] = [];
      (holds.setStatus as jest.Mock).mockImplementation(() => {
        order.push('setStatus');
        return Promise.resolve();
      });
      (whatsapp.sendMessage as jest.Mock).mockImplementation(() => {
        order.push('sendMessage');
        return Promise.resolve();
      });
      const svc = new HoldsCronService(
        holds,
        whatsapp,
        makeMessageLog(),
        makeResponse('expired text'),
        makeLogger(),
      );

      await svc.runDailyCheck();

      expect(order).toEqual(['setStatus', 'sendMessage']);
      expect(holds.setStatus).toHaveBeenCalledWith('rec1', 'expired');
    });

    it('claims reminder_sent before notifying', async () => {
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      const hold = holdFixture({
        hold_expires_at: soon.toISOString(),
        reminder_sent: false,
      });
      const holds = makeHolds([hold]);
      const whatsapp = makeWhatsapp();
      const order: string[] = [];
      (holds.setReminderSent as jest.Mock).mockImplementation(() => {
        order.push('setReminderSent');
        return Promise.resolve();
      });
      (whatsapp.sendMessage as jest.Mock).mockImplementation(() => {
        order.push('sendMessage');
        return Promise.resolve();
      });
      const svc = new HoldsCronService(
        holds,
        whatsapp,
        makeMessageLog(),
        makeResponse('reminder text'),
        makeLogger(),
      );

      await svc.runDailyCheck();

      expect(order).toEqual(['setReminderSent', 'sendMessage']);
    });

    it('does not send reminder if already sent', async () => {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);

      const hold = holdFixture({ hold_expires_at: tomorrow.toISOString(), reminder_sent: true });
      const holds = makeHolds([hold]);
      const svc = new HoldsCronService(holds, makeWhatsapp(), makeMessageLog(), makeResponse(), makeLogger());

      await svc.runDailyCheck();

      expect(holds.setReminderSent).not.toHaveBeenCalled();
    });

    it('sends hold_expired and sets status expired for holds that have passed their expiry', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const hold = holdFixture({ hold_expires_at: yesterday.toISOString() });
      const holds = makeHolds([hold]);
      const whatsapp = makeWhatsapp();
      const messageLog = makeMessageLog();
      const response = makeResponse('expired text');
      const svc = new HoldsCronService(holds, whatsapp, messageLog, response, makeLogger());

      await svc.runDailyCheck();

      expect(response.render).toHaveBeenCalledWith('hold_expired', expect.objectContaining({ phone: '+441234567890' }));
      expect(whatsapp.sendMessage).toHaveBeenCalledWith('+441234567890', 'expired text');
      expect(holds.setStatus).toHaveBeenCalledWith('rec1', 'expired');
    });

    it('does nothing for holds not yet near expiry', async () => {
      const farFuture = new Date();
      farFuture.setUTCDate(farFuture.getUTCDate() + 3);

      const hold = holdFixture({ hold_expires_at: farFuture.toISOString() });
      const holds = makeHolds([hold]);
      const whatsapp = makeWhatsapp();
      const svc = new HoldsCronService(holds, whatsapp, makeMessageLog(), makeResponse(), makeLogger());

      await svc.runDailyCheck();

      expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    });

    it('logs error and continues if processing one hold fails', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const hold = holdFixture({ hold_expires_at: yesterday.toISOString() });
      const holds = makeHolds([hold]);
      const response = {
        render: jest.fn().mockRejectedValue(new Error('template missing')),
      } as unknown as TemplatesService;
      const logger = makeLogger();
      const svc = new HoldsCronService(holds, makeWhatsapp(), makeMessageLog(), response, logger);

      await expect(svc.runDailyCheck()).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
