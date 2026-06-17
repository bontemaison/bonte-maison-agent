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

const DAY_MS = 24 * 60 * 60 * 1000;

type ReasonContext = {
  guestName: string;
  phoneFormatted: string;
  message?: string;
  email?: string;
  datesFormatted?: string;
  nightsLabel?: string;
  priceQuoted?: number;
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
    const ctx = this.buildReasonContext(phone, snapshot, opts);
    const bodyLines = this.renderReason(reason, ctx);
    const body = bodyLines.join('\n');
    const subject = this.subjectFor(reason, ctx, bodyLines);
    return { whatsapp: body, subject, body };
  }

  private buildReasonContext(
    phone: string,
    snapshot: CrmSnapshot | null,
    opts: ConversationNotificationOptions,
  ): ReasonContext {
    const parsed = this.parseDatesRequested(snapshot?.datesRequested);
    return {
      guestName: snapshot?.customerName ?? '',
      phoneFormatted: this.formatPhone(phone),
      message: opts.message,
      email: snapshot?.email ?? undefined,
      datesFormatted: parsed?.formatted,
      nightsLabel: parsed?.nightsLabel,
      priceQuoted: snapshot?.priceQuoted ?? undefined,
    };
  }

  private renderReason(reason: string, ctx: ReasonContext): string[] {
    switch (reason) {
      case 'discount_request':
        return this.tplDiscount(ctx);
      case 'booking_confirmation':
        return this.tplBooking(ctx);
      case 'faq_unknown':
        return this.tplFaqUnknown(ctx);
      case 'hold_conflict':
        return this.tplHoldConflict(ctx);
      case 'dates_unavailable':
        return this.tplDatesUnavailable(ctx);
      case 'complaint':
        return this.tplComplaint(ctx);
      case 'human_request':
        return this.tplHumanRequest(ctx);
      case 'long_stay_manual_pricing':
        return this.tplLongStay(ctx);
      case 'pricing_pending':
        return this.tplPricingPending(ctx);
      case 'unclear_or_off_topic':
        return this.tplUnclear(ctx);
      case 'orchestrator_error':
        return this.tplCrash(ctx);
      case 'composer_fallback':
        return this.tplComposerFallback(ctx);
      default:
        return this.tplGeneric(reason, ctx);
    }
  }

  private tplDiscount(ctx: ReasonContext): string[] {
    const lines: string[] = ['*Discount asked.*', '', this.guestLine(ctx)];
    const facts = this.factLines(ctx);
    if (facts.length) lines.push('', ...facts);
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    return lines;
  }

  private tplBooking(ctx: ReasonContext): string[] {
    const lines: string[] = ['🎉 *Wants to book.*', '', this.guestLine(ctx)];
    const facts = this.factLines(ctx, { email: true });
    if (facts.length) lines.push('', ...facts);
    lines.push('', 'Marked as Booked.');
    return lines;
  }

  private tplFaqUnknown(ctx: ReasonContext): string[] {
    const lines: string[] = [
      "*Question I couldn't answer.*",
      '',
      this.guestLine(ctx),
    ];
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    lines.push('', "Told them you'd come back shortly.");
    return lines;
  }

  private tplHoldConflict(ctx: ReasonContext): string[] {
    const lines: string[] = [
      '*Asked about dates already held.*',
      '',
      this.guestLine(ctx),
    ];
    const wanted = this.wantedLine(ctx);
    if (wanted) lines.push('', wanted);
    lines.push(
      '',
      'Replied "unavailable" — worth a look before the hold lapses.',
    );
    return lines;
  }

  private tplDatesUnavailable(ctx: ReasonContext): string[] {
    const lines: string[] = [
      '*Asked about dates that are already booked.*',
      '',
      this.guestLine(ctx),
    ];
    const wanted = this.wantedLine(ctx);
    if (wanted) lines.push('', wanted);
    lines.push('', 'Replied "unavailable".');
    return lines;
  }

  private tplComplaint(ctx: ReasonContext): string[] {
    const lines: string[] = ['*Sounds frustrated.*', '', this.guestLine(ctx)];
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    lines.push('', 'Bot paused. Worth replying yourself.');
    return lines;
  }

  private tplHumanRequest(ctx: ReasonContext): string[] {
    const lines: string[] = [
      '*Asked for you directly.*',
      '',
      this.guestLine(ctx),
    ];
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    lines.push('', 'Bot paused.');
    return lines;
  }

  private tplLongStay(ctx: ReasonContext): string[] {
    const lines: string[] = [
      '*Long stay — needs your pricing call.*',
      '',
      this.guestLine(ctx),
    ];
    if (ctx.datesFormatted) {
      const tail = ctx.nightsLabel ? ` (${ctx.nightsLabel})` : '';
      lines.push('', `Dates: ${ctx.datesFormatted}${tail}`);
    }
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    lines.push('', 'Not quoted yet — over to you.');
    return lines;
  }

  private tplPricingPending(ctx: ReasonContext): string[] {
    const lines: string[] = [
      '*Future dates — no rate set yet.*',
      '',
      this.guestLine(ctx),
    ];
    if (ctx.datesFormatted) {
      const tail = ctx.nightsLabel ? ` (${ctx.nightsLabel})` : '';
      lines.push('', `Dates: ${ctx.datesFormatted}${tail}`);
    }
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    lines.push(
      '',
      "Calendar's open but no band priced for that period. Told them you'd confirm the rate, over to you.",
    );
    return lines;
  }

  private tplUnclear(ctx: ReasonContext): string[] {
    const lines: string[] = [
      "*Bot couldn't follow this one.*",
      '',
      this.guestLine(ctx),
    ];
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    return lines;
  }

  private tplCrash(ctx: ReasonContext): string[] {
    const lines: string[] = [
      '*Bot crashed on this conversation.*',
      '',
      this.guestLine(ctx),
    ];
    lines.push('', 'Sent a holding reply. Worth checking what they last said.');
    return lines;
  }

  private tplComposerFallback(ctx: ReasonContext): string[] {
    const lines: string[] = [
      "*Fell back to a fixed reply — couldn't compose.*",
      '',
      this.guestLine(ctx),
    ];
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    return lines;
  }

  private tplGeneric(reason: string, ctx: ReasonContext): string[] {
    const lines: string[] = [
      `*${this.reasonTitle(reason)}.*`,
      '',
      this.guestLine(ctx),
    ];
    const facts = this.factLines(ctx);
    if (facts.length) lines.push('', ...facts);
    if (ctx.message) lines.push('', `"${ctx.message}"`);
    return lines;
  }

  private guestLine(ctx: ReasonContext): string {
    return ctx.guestName
      ? `${ctx.guestName} (${ctx.phoneFormatted})`
      : ctx.phoneFormatted;
  }

  private factLines(
    ctx: ReasonContext,
    opts: { email?: boolean } = {},
  ): string[] {
    const lines: string[] = [];
    if (ctx.datesFormatted) lines.push(`Dates: ${ctx.datesFormatted}`);
    if (ctx.priceQuoted) {
      lines.push(
        `Quote: £${Math.round(ctx.priceQuoted).toLocaleString('en-GB')}`,
      );
    }
    if (opts.email && ctx.email) lines.push(`Email: ${ctx.email}`);
    return lines;
  }

  private wantedLine(ctx: ReasonContext): string | null {
    return ctx.datesFormatted ? `Wanted: ${ctx.datesFormatted}` : null;
  }

  private subjectFor(
    reason: string,
    ctx: ReasonContext,
    bodyLines: string[],
  ): string {
    const leadRaw = bodyLines[0] ?? '';
    const cleanLead = leadRaw
      .replace(/\*/g, '')
      .replace(/🎉/g, '')
      .trim()
      .replace(/\.$/, '');
    const subjectCore = cleanLead || this.reasonTitle(reason);
    const who = ctx.guestName || ctx.phoneFormatted;
    return who
      ? `[Bonté Maison] ${subjectCore} — ${who}`
      : `[Bonté Maison] ${subjectCore}`;
  }

  private reasonTitle(reason: string): string {
    return reason
      .split('_')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  }

  /**
   * Render phone as a WhatsApp-clickable string. UK mobiles get human spacing;
   * everything else just gets a leading `+`.
   */
  private formatPhone(phone: string): string {
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.startsWith('44') && digits.length === 12) {
      return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
    }
    return `+${digits}`;
  }

  private parseDatesRequested(
    raw?: string | null,
  ): { formatted: string; nightsLabel: string } | undefined {
    if (!raw) return undefined;
    const match = raw.match(/(\d{4}-\d{2}-\d{2})[^\d]+(\d{4}-\d{2}-\d{2})/);
    if (!match) return undefined;
    const start = new Date(match[1]);
    const end = new Date(match[2]);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return undefined;
    }
    const formatted = this.formatDateRange(start, end);
    const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    const nightsLabel = `${nights} ${nights === 1 ? 'night' : 'nights'}`;
    return { formatted, nightsLabel };
  }

  private formatDateRange(start: Date, end: Date): string {
    const sameMonth =
      start.getUTCFullYear() === end.getUTCFullYear() &&
      start.getUTCMonth() === end.getUTCMonth();
    const startFmt = sameMonth
      ? this.formatDayShort(start)
      : this.formatDayMonth(start);
    const endFmt = this.formatDayMonthYear(end);
    return `${startFmt} — ${endFmt}`;
  }

  private formatDayShort(d: Date): string {
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  private formatDayMonth(d: Date): string {
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  }

  private formatDayMonthYear(d: Date): string {
    // en-GB inserts a comma after the short weekday when the year is present
    // ("Sun, 18 July 2027"). Strip it for a cleaner read on WhatsApp.
    return d
      .toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
      .replace(',', '');
  }

  private compose(
    text: string,
    ctx?: NotificationContext,
  ): { whatsapp: string; subject: string; body: string } {
    const reason = ctx?.reason ?? 'notification';
    const subjectCore = this.reasonTitle(reason);
    const subject = ctx?.from
      ? `[Bonté Maison] ${subjectCore} — ${ctx.from}`
      : `[Bonté Maison] ${subjectCore}`;
    return { whatsapp: text, subject, body: text };
  }
}
