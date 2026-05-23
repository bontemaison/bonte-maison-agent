import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { BookingRulesService } from '../booking-rules/booking-rules.service';
import { LoggerService } from '../logger/logger.service';
import { NotificationsService } from './notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Coexistence breaks if Jim doesn't open the WhatsApp Business app for 13
// days. Warn at 10 days so he has a 3-day window before disconnect.
const WARN_THRESHOLD_DAYS = 10;

@Injectable()
export class CoexistenceHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private task: cron.ScheduledTask | null = null;

  constructor(
    private readonly bookingRules: BookingRulesService,
    private readonly notifications: NotificationsService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    // Daily at 09:00 UTC — after the holds cron at 08:00.
    this.task = cron.schedule('0 9 * * *', () => {
      this.runDailyCheck().catch((err: Error) => {
        this.logger.error('notifications', 'heartbeat cron failed', {
          error: err.message,
        });
      });
    });
  }

  onModuleDestroy(): void {
    this.task?.stop();
  }

  async runDailyCheck(now: Date = new Date()): Promise<void> {
    const lastEcho = await this.bookingRules.getLastOwnerEchoAt();
    if (!lastEcho) {
      // No echo recorded yet — happens before Jim's first reply lands. We
      // can't tell if Coexistence is healthy, so skip rather than spam.
      this.logger.debug(
        'notifications',
        'heartbeat: no owner echo on record, skipping',
      );
      return;
    }

    const ageDays = (now.getTime() - lastEcho.getTime()) / DAY_MS;
    if (ageDays < WARN_THRESHOLD_DAYS) {
      this.logger.debug('notifications', 'heartbeat: within threshold', {
        ageDays: Number(ageDays.toFixed(2)),
      });
      return;
    }

    const warningSentAt = await this.bookingRules.getHeartbeatWarningSentAt();
    if (warningSentAt && warningSentAt >= lastEcho) {
      // Already warned during this staleness episode. A fresh echo would
      // push lastEcho past warningSentAt and re-arm the warning.
      this.logger.debug('notifications', 'heartbeat: warning already sent for this episode', {
        warningSentAt: warningSentAt.toISOString(),
        lastEcho: lastEcho.toISOString(),
      });
      return;
    }

    const daysSilent = Math.floor(ageDays);
    const text =
      `Heads up — your WhatsApp Business app hasn't been opened in ${daysSilent} days. ` +
      `Coexistence breaks at 13 days and disconnects the Bonté Maison number. ` +
      `Open the app once to reset the timer.`;

    await this.notifications.notifyOwner(text, { reason: 'coexistence_heartbeat' });
    await this.bookingRules.markHeartbeatWarningSent(now);
    this.logger.info('notifications', 'heartbeat warning sent', {
      ageDays: Number(ageDays.toFixed(2)),
    });
  }
}
