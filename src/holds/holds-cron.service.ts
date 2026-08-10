import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as cron from 'node-cron';
import { HoldsService, Hold, isLapsed } from './holds.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MessageLogService } from '../messagelog/messagelog.service';
import { TemplatesService } from '../templates/templates.service';
import { LoggerService } from '../logger/logger.service';
import { DAY_MS } from '../common/dates';

@Injectable()
export class HoldsCronService implements OnModuleInit, OnModuleDestroy {
  private task: cron.ScheduledTask | null = null;

  constructor(
    private readonly holds: HoldsService,
    private readonly whatsapp: WhatsappService,
    private readonly messageLog: MessageLogService,
    private readonly templates: TemplatesService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    // Every 15 minutes. A hold expires at `created + 5 days` — i.e. at whatever
    // minute the guest asked for it — so a daily tick missed its own expiry
    // window by up to 24h. Timezone is pinned so the schedule can't drift with
    // the server's TZ.
    this.task = cron.schedule(
      '*/15 * * * *',
      () => {
        this.runDailyCheck().catch((err: Error) => {
          this.logger.error('holds', 'cron runDailyCheck failed', { error: err.message });
        });
      },
      { timezone: 'UTC' },
    );
  }

  onModuleDestroy(): void {
    this.task?.stop();
  }

  async runDailyCheck(): Promise<void> {
    const active = await this.holds.listActive();
    this.logger.info('holds', 'holds check', { count: active.length });

    for (const hold of active) {
      try {
        await this.processHold(hold);
      } catch (err) {
        this.logger.error('holds', 'failed to process hold', {
          id: hold.id,
          phone: hold.fields.phone,
          error: (err as Error).message,
        });
      }
    }
  }

  private async processHold(hold: Hold): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(hold.fields.hold_expires_at);
    const { phone, check_in, check_out } = hold.fields;

    // Claim before sending, in both branches. At a 15-minute cadence a send that
    // throws after delivery would otherwise re-notify the guest 96 times a day.
    // Losing one message to a failed send is the better trade — the error is
    // logged by the caller either way.
    if (isLapsed(hold, now)) {
      await this.holds.setStatus(hold.id, 'expired');
      this.logger.info('holds', 'hold expired', { id: hold.id, phone });
      const text = await this.templates.render('hold_expired', {
        phone,
        check_in,
        check_out,
      });
      await this.whatsapp.sendMessage(phone, text);
      await this.messageLog.log(phone, 'out', text);
      return;
    }

    const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / DAY_MS;

    if (daysUntilExpiry <= 1 && !hold.fields.reminder_sent) {
      await this.holds.setReminderSent(hold.id);
      this.logger.info('holds', 'hold reminder sent', { id: hold.id, phone });
      const text = await this.templates.render('hold_reminder', {
        phone,
        check_in,
        check_out,
      });
      await this.whatsapp.sendMessage(phone, text);
      await this.messageLog.log(phone, 'out', text);
    }
  }
}
