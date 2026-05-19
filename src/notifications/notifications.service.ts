import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingRulesService } from '../booking-rules/booking-rules.service';
import {
  ConversationService,
  CrmSnapshot,
} from '../conversation/conversation.service';
import { LoggerService } from '../logger/logger.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from './email.service';

export type NotificationContext = {
  reason?: string;
  from?: string;
  message?: string;
  intent?: string;
  extra?: Record<string, unknown>;
};

export type ConversationNotificationOptions = {
  message?: string;
  intent?: string;
  extra?: Record<string, unknown>;
};

const REASON_LABELS: Record<string, string> = {
  discount_request: 'Discount request',
  long_stay_manual_pricing: 'Long-stay manual pricing',
  faq_unknown: 'FAQ unknown — needs human',
  complaint: 'Complaint / frustration',
  human_request: 'Guest asked for a human',
  booking_confirmation: 'Booking confirmation',
  unclear_or_off_topic: 'Unclear / off-topic',
  hold_conflict: 'Hold conflict',
  dates_unavailable: 'Dates unavailable',
  orchestrator_error: 'Orchestrator error',
  owner_command: 'Owner command',
};

@Injectable()
export class NotificationsService {
  private readonly ownerPhone: string | undefined;
  private readonly ownerEmail: string | undefined;
  private readonly ownerWhatsappTemplate: string | undefined;

  constructor(
    config: ConfigService,
    private readonly whatsapp: WhatsappService,
    private readonly email: EmailService,
    private readonly conversation: ConversationService,
    private readonly bookingRules: BookingRulesService,
    private readonly logger: LoggerService,
  ) {
    this.ownerPhone = config.get<string>('OWNER_PHONE');
    this.ownerEmail = config.get<string>('OWNER_EMAIL');
    this.ownerWhatsappTemplate = config.get<string>('OWNER_WHATSAPP_TEMPLATE');
  }

  /**
   * Send a notification to the owner over every configured channel.
   * Never throws — failures are logged so callers can fire-and-forget.
   */
  async notifyOwner(text: string, context?: NotificationContext): Promise<void> {
    const composed = this.compose(text, context);
    await this.dispatch(composed.whatsapp, composed.subject, composed.body);
  }

  /**
   * Owner notification enriched with CRM details for `phone`.
   * Falls back to a plain notification if the CRM read fails or has no row.
   */
  async notifyOwnerAboutConversation(
    phone: string,
    reason: string,
    opts: ConversationNotificationOptions = {},
  ): Promise<void> {
    let snapshot: CrmSnapshot | null = null;
    try {
      snapshot = await this.conversation.getCrmSnapshot(phone);
    } catch (err) {
      this.logger.warn('notifications', 'CRM snapshot fetch failed', {
        phone,
        error: (err as Error).message,
      });
    }

    const composed = this.composeRich(phone, reason, snapshot, opts);
    await this.dispatch(composed.whatsapp, composed.subject, composed.body);
  }

  private async dispatch(
    whatsappText: string,
    subject: string,
    body: string,
  ): Promise<void> {
    const [phoneEnabled, emailEnabled] = await Promise.all([
      this.isPhoneEnabled(),
      this.isEmailEnabled(),
    ]);
    await Promise.allSettled([
      phoneEnabled ? this.sendWhatsapp(whatsappText) : Promise.resolve(),
      emailEnabled ? this.sendEmail(subject, body) : Promise.resolve(),
    ]);
  }

  private async isPhoneEnabled(): Promise<boolean> {
    try {
      return await this.bookingRules.isOwnerPhoneNotifyEnabled();
    } catch (err) {
      this.logger.warn(
        'notifications',
        'phone-enable flag read failed; defaulting to enabled',
        { error: (err as Error).message },
      );
      return true;
    }
  }

  private async isEmailEnabled(): Promise<boolean> {
    try {
      return await this.bookingRules.isOwnerEmailNotifyEnabled();
    } catch (err) {
      this.logger.warn(
        'notifications',
        'email-enable flag read failed; defaulting to enabled',
        { error: (err as Error).message },
      );
      return true;
    }
  }

  private async sendWhatsapp(text: string): Promise<void> {
    if (!this.ownerPhone) return;
    if (!this.ownerWhatsappTemplate) {
      // Without a pre-approved template name we can't reliably reach Jim
      // outside the 24h customer-service window, so don't fall back to a
      // session send — it would silently fail when stale.
      this.logger.warn(
        'notifications',
        'OWNER_WHATSAPP_TEMPLATE not configured; skipping WhatsApp delivery',
      );
      return;
    }
    try {
      await this.whatsapp.sendTemplate(
        this.ownerPhone,
        this.ownerWhatsappTemplate,
        { '1': text },
        { override: true },
      );
    } catch (err) {
      this.logger.error('notifications', 'whatsapp delivery failed', {
        error: (err as Error).message,
      });
    }
  }

  private async sendEmail(subject: string, body: string): Promise<void> {
    if (!this.ownerEmail) return;
    try {
      await this.email.send({ to: this.ownerEmail, subject, body });
    } catch (err) {
      this.logger.error('notifications', 'email delivery failed', {
        error: (err as Error).message,
      });
    }
  }

  private composeRich(
    phone: string,
    reason: string,
    snapshot: CrmSnapshot | null,
    opts: ConversationNotificationOptions,
  ): { whatsapp: string; subject: string; body: string } {
    const label = this.reasonLabel(reason);
    const guestLine = snapshot?.customerName
      ? `Guest: ${snapshot.customerName} (${phone})`
      : `Guest: ${phone}`;

    const lines: string[] = [`🔔 Bonté Maison — ${label}`, guestLine];

    if (snapshot) {
      const statusBits: string[] = [`Status: ${snapshot.lifecycleStatus}`];
      const lastIntent = opts.intent ?? snapshot.lastIntent;
      if (lastIntent) statusBits.push(`Last intent: ${lastIntent}`);
      if (snapshot.status !== 'bot') statusBits.push(`Mode: ${snapshot.status}`);
      lines.push(statusBits.join(' · '));

      if (snapshot.datesRequested) {
        lines.push(`Dates: ${snapshot.datesRequested}`);
      }
      if (snapshot.priceQuoted || snapshot.availabilityResult) {
        const quoteBits: string[] = [];
        if (snapshot.priceQuoted) {
          quoteBits.push(`Quote: £${Math.round(snapshot.priceQuoted).toLocaleString('en-GB')}`);
        }
        if (snapshot.availabilityResult) {
          quoteBits.push(snapshot.availabilityResult);
        }
        lines.push(quoteBits.join(' · '));
      }
      if (snapshot.email) lines.push(`Email: ${snapshot.email}`);
      if (snapshot.followUpCount && snapshot.followUpCount > 0) {
        lines.push(`Follow-ups sent: ${snapshot.followUpCount}`);
      }
    } else if (opts.intent) {
      lines.push(`Last intent: ${opts.intent}`);
    }

    if (opts.message) lines.push(`Message: "${opts.message}"`);

    if (opts.extra) {
      for (const [k, v] of Object.entries(opts.extra)) {
        const value = this.stringify(v);
        if (value) lines.push(`${k}: ${value}`);
      }
    }

    const body = lines.join('\n');
    const subject = snapshot?.customerName
      ? `[Bonté Maison] ${label} — ${snapshot.customerName}`
      : `[Bonté Maison] ${label} — ${phone}`;

    return { whatsapp: body, subject, body };
  }

  private reasonLabel(reason: string): string {
    return (
      REASON_LABELS[reason] ??
      reason
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ')
    );
  }

  private compose(
    text: string,
    ctx?: NotificationContext,
  ): { whatsapp: string; subject: string; body: string } {
    const reason = ctx?.reason ?? 'notification';

    const subject = ctx?.from
      ? `[Bonté Maison] ${reason} — ${ctx.from}`
      : `[Bonté Maison] ${reason}`;

    const lines: string[] = [text];
    if (ctx?.from) lines.push(`From: ${ctx.from}`);
    if (ctx?.intent) lines.push(`Intent: ${ctx.intent}`);
    if (ctx?.message) lines.push(`Message: ${ctx.message}`);
    if (ctx?.extra) {
      for (const [k, v] of Object.entries(ctx.extra)) {
        lines.push(`${k}: ${this.stringify(v)}`);
      }
    }

    return {
      whatsapp: text,
      subject,
      body: lines.join('\n'),
    };
  }

  private stringify(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}
