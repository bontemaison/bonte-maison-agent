import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { ConversationService } from '../conversation/conversation.service';
import { LoggerService } from '../logger/logger.service';
import { MessageLogService } from '../messagelog/messagelog.service';
import { TemplatesService } from '../templates/templates.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { FollowUp, FollowUpsService } from './follow-ups.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECONFIRM_MIN_IDLE_DAYS = 3;
const RECONFIRM_MAX_IDLE_DAYS = 14;

@Injectable()
export class FollowUpsCronService implements OnModuleInit, OnModuleDestroy {
  private task: cron.ScheduledTask | null = null;

  constructor(
    private readonly followUps: FollowUpsService,
    private readonly whatsapp: WhatsappService,
    private readonly messageLog: MessageLogService,
    private readonly templates: TemplatesService,
    private readonly conversation: ConversationService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    // daily at 09:00 UTC — one hour after the holds cron
    this.task = cron.schedule('0 9 * * *', () => {
      this.runDailyCheck().catch((err: Error) => {
        this.logger.error('follow-ups', 'cron runDailyCheck failed', { error: err.message });
      });
    });
  }

  onModuleDestroy(): void {
    this.task?.stop();
  }

  async runDailyCheck(): Promise<void> {
    const due = await this.followUps.listDue();
    this.logger.info('follow-ups', 'daily check', { count: due.length });

    for (const row of due) {
      try {
        await this.processRow(row);
      } catch (err) {
        this.logger.error('follow-ups', 'failed to process row', {
          id: row.id,
          phone: row.fields.phone,
          error: (err as Error).message,
        });
      }
    }

    await this.runDateReconfirmationCheck();
  }

  /**
   * Date reconfirmation (Jim 2026-05): if a customer asked about specific
   * dates and has gone quiet for a few days, ping them once with the dates
   * spelled out so they can either re-confirm (→ availability re-check via
   * `awaiting_dates_confirmation` flow) or share new dates.
   */
  async runDateReconfirmationCheck(): Promise<void> {
    const candidates = await this.conversation.listDateReconfirmationCandidates(
      RECONFIRM_MIN_IDLE_DAYS,
      RECONFIRM_MAX_IDLE_DAYS,
    );
    this.logger.info('follow-ups', 'date reconfirmation check', {
      count: candidates.length,
    });

    for (const c of candidates) {
      try {
        const checkInLabel = this.formatIso(c.checkIn);
        const checkOutLabel = this.formatIso(c.checkOut);
        const text = await this.templates.render('date_reconfirmation_check', {
          name: c.customerName ?? '',
          name_comma: c.customerName ? `, ${c.customerName}` : '',
          check_in: checkInLabel,
          check_out: checkOutLabel,
        });
        await this.whatsapp.sendMessage(c.phone, text);
        await this.messageLog.log(c.phone, 'out', text);
        // Park the dates so a "yes please" reply runs availability for them.
        await this.conversation.updateContext(c.phone, {
          lastIntent: 'awaiting_dates_confirmation',
          pendingDates: {
            checkIn: c.checkIn,
            checkOut: c.checkOut,
            guests: null,
          },
        });
        await this.conversation.markDateReconfirmationSent(c.phone);
        this.logger.info('follow-ups', 'date reconfirmation sent', {
          phone: c.phone,
        });
      } catch (err) {
        this.logger.error('follow-ups', 'date reconfirmation send failed', {
          phone: c.phone,
          error: (err as Error).message,
        });
      }
    }
  }

  private formatIso(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  private async processRow(row: FollowUp): Promise<void> {
    const now = Date.now();
    const quoteSentAt = new Date(row.fields.quote_sent_at).getTime();
    const elapsed = now - quoteSentAt;
    const { phone, status } = row.fields;

    if (status === 'pending' && elapsed >= 24 * HOUR_MS && elapsed < 7 * DAY_MS) {
      await this.send(phone, 'followup_24h');
      await this.followUps.markSent24h(row.id);
      await this.mirrorCrm(phone, '24h');
      return;
    }

    if (
      (status === 'sent_24h' || status === 'pending') &&
      elapsed >= 7 * DAY_MS
    ) {
      await this.send(phone, 'followup_7d');
      await this.followUps.markCompleted(row.id);
      await this.mirrorCrm(phone, '7d');
    }
  }

  private async mirrorCrm(phone: string, stage: '24h' | '7d'): Promise<void> {
    try {
      await this.conversation.markFollowUpSent(phone, stage);
      await this.conversation.setLifecycleStatus(
        phone,
        stage === '7d' ? 'Lost' : 'Follow-up',
      );
    } catch (err) {
      this.logger.warn('follow-ups', 'CRM mirror failed', {
        phone,
        stage,
        error: (err as Error).message,
      });
    }
  }

  private async send(phone: string, key: string): Promise<void> {
    const text = await this.templates.render(key, { phone });
    await this.whatsapp.sendMessage(phone, text);
    await this.messageLog.log(phone, 'out', text);
    this.logger.info('follow-ups', 'sent', { phone, key });
  }
}
