import { BookingRulesService } from '../booking-rules/booking-rules.service';
import { LoggerService } from '../logger/logger.service';
import { CoexistenceHeartbeatService } from './coexistence-heartbeat.service';
import { NotificationsService } from './notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeNotifications = (): NotificationsService =>
  ({
    notifyOwner: jest.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationsService;

type BookingRulesStub = {
  getLastOwnerEchoAt: jest.Mock;
  getHeartbeatWarningSentAt: jest.Mock;
  markHeartbeatWarningSent: jest.Mock;
};

const makeBookingRules = (overrides: Partial<BookingRulesStub> = {}): BookingRulesStub =>
  ({
    getLastOwnerEchoAt: overrides.getLastOwnerEchoAt ?? jest.fn().mockResolvedValue(null),
    getHeartbeatWarningSentAt:
      overrides.getHeartbeatWarningSentAt ?? jest.fn().mockResolvedValue(null),
    markHeartbeatWarningSent:
      overrides.markHeartbeatWarningSent ?? jest.fn().mockResolvedValue(undefined),
  });

const NOW = new Date('2026-06-01T09:00:00Z');

describe('CoexistenceHeartbeatService', () => {
  it('skips silently when no owner echo has ever been recorded', async () => {
    const notifications = makeNotifications();
    const bookingRules = makeBookingRules();
    const service = new CoexistenceHeartbeatService(
      bookingRules as unknown as BookingRulesService,
      notifications,
      makeLogger(),
    );

    await service.runDailyCheck(NOW);

    expect(notifications.notifyOwner).not.toHaveBeenCalled();
    expect(bookingRules.markHeartbeatWarningSent).not.toHaveBeenCalled();
  });

  it('skips when the last echo was within the warn threshold', async () => {
    const notifications = makeNotifications();
    const bookingRules = makeBookingRules({
      getLastOwnerEchoAt: jest
        .fn()
        .mockResolvedValue(new Date(NOW.getTime() - 5 * DAY_MS)),
    });
    const service = new CoexistenceHeartbeatService(
      bookingRules as unknown as BookingRulesService,
      notifications,
      makeLogger(),
    );

    await service.runDailyCheck(NOW);

    expect(notifications.notifyOwner).not.toHaveBeenCalled();
    expect(bookingRules.markHeartbeatWarningSent).not.toHaveBeenCalled();
  });

  it('sends a warning when the last echo is at least 10 days old', async () => {
    const notifications = makeNotifications();
    const bookingRules = makeBookingRules({
      getLastOwnerEchoAt: jest
        .fn()
        .mockResolvedValue(new Date(NOW.getTime() - 11 * DAY_MS)),
    });
    const service = new CoexistenceHeartbeatService(
      bookingRules as unknown as BookingRulesService,
      notifications,
      makeLogger(),
    );

    await service.runDailyCheck(NOW);

    expect(notifications.notifyOwner).toHaveBeenCalledTimes(1);
    const [text, ctx] = (notifications.notifyOwner as jest.Mock).mock.calls[0];
    expect(text).toContain('11 days');
    expect(text).toContain('13 days');
    expect(ctx).toEqual({ reason: 'coexistence_heartbeat' });
    expect(bookingRules.markHeartbeatWarningSent).toHaveBeenCalledWith(NOW);
  });

  it('does not re-warn on subsequent days within the same staleness episode', async () => {
    // Warning was sent yesterday; the echo is still old; cron runs again.
    const lastEcho = new Date(NOW.getTime() - 12 * DAY_MS);
    const warningSentAt = new Date(NOW.getTime() - 1 * DAY_MS);
    const notifications = makeNotifications();
    const bookingRules = makeBookingRules({
      getLastOwnerEchoAt: jest.fn().mockResolvedValue(lastEcho),
      getHeartbeatWarningSentAt: jest.fn().mockResolvedValue(warningSentAt),
    });
    const service = new CoexistenceHeartbeatService(
      bookingRules as unknown as BookingRulesService,
      notifications,
      makeLogger(),
    );

    await service.runDailyCheck(NOW);

    expect(notifications.notifyOwner).not.toHaveBeenCalled();
    expect(bookingRules.markHeartbeatWarningSent).not.toHaveBeenCalled();
  });

  it('re-warns when a fresh echo arrived after the prior warning and went stale again', async () => {
    // Old warning from 30 days ago; a newer echo happened 15 days ago; now
    // we are stale again (15d > 10d) and warningSentAt < lastEcho, so it
    // should fire.
    const lastEcho = new Date(NOW.getTime() - 15 * DAY_MS);
    const warningSentAt = new Date(NOW.getTime() - 30 * DAY_MS);
    const notifications = makeNotifications();
    const bookingRules = makeBookingRules({
      getLastOwnerEchoAt: jest.fn().mockResolvedValue(lastEcho),
      getHeartbeatWarningSentAt: jest.fn().mockResolvedValue(warningSentAt),
    });
    const service = new CoexistenceHeartbeatService(
      bookingRules as unknown as BookingRulesService,
      notifications,
      makeLogger(),
    );

    await service.runDailyCheck(NOW);

    expect(notifications.notifyOwner).toHaveBeenCalledTimes(1);
    expect(bookingRules.markHeartbeatWarningSent).toHaveBeenCalledWith(NOW);
  });
});
