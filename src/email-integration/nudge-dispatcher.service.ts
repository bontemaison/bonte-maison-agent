import { Injectable } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service';
import { ConversationService } from '../conversation/conversation.service';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { GuestsService } from '../guests/guests.service';
import { LoggerService } from '../logger/logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NudgeKey } from './subject-matcher';

type ConversationFields = {
  phone?: string;
  email?: string;
  customer_name?: string;
};

type Recipient = { phone: string; name: string };

export type DispatchInput = {
  key: NudgeKey;
  guestEmail: string;
  subject: string;
  messageId: string;
};

export type DispatchResult =
  | { status: 'sent'; phone: string; key: NudgeKey }
  | { status: 'unmatched_guest'; email: string };

@Injectable()
export class NudgeDispatcherService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly whatsapp: WhatsappService,
    private readonly notifications: NotificationsService,
    private readonly guests: GuestsService,
    private readonly conversation: ConversationService,
    private readonly followUps: FollowUpsService,
    private readonly logger: LoggerService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const email = input.guestEmail.trim().toLowerCase();
    if (!email) {
      this.logger.warn('email-integration', 'dispatch called with empty guestEmail', input);
      return { status: 'unmatched_guest', email: '' };
    }

    const recipient =
      (await this.fromConversations(email)) ?? (await this.fromGuests(email));

    if (!recipient) {
      this.logger.warn('email-integration', 'unmatched guest for SuperControl email', {
        email,
        subject: input.subject,
        key: input.key,
        messageId: input.messageId,
      });
      await this.notifications
        .notifyOwner(
          `Unmatched SuperControl email — no Conversations or Guests row with email "${email}". Subject: "${input.subject}".`,
          { reason: 'unmatched_guest', extra: { key: input.key, messageId: input.messageId } },
        )
        .catch(() => undefined);
      return { status: 'unmatched_guest', email };
    }

    const { phone, name } = recipient;

    // sendTemplate, not sendMessage: nudges fire outside the 24h CSW and
    // Meta will reject freeform text with error 131047. The template name
    // equals the NudgeKey by design — Jim's Meta templates use the same
    // identifiers. `{{1}}` is the guest name on every approved template.
    await this.whatsapp.sendTemplate(phone, input.key, { '1': name }, { override: true });

    this.logger.info('email-integration', 'sent SuperControl nudge', {
      key: input.key,
      phone,
      name,
      subject: input.subject,
      messageId: input.messageId,
    });

    if (input.key === 'nudge_booking_confirmation') {
      await this.markBooked(phone);
    }

    return { status: 'sent', phone, key: input.key };
  }

  private async fromConversations(email: string): Promise<Recipient | null> {
    const safe = email.replace(/'/g, "\\'");
    const rows = await this.airtable.list<ConversationFields>('Conversations', {
      filterByFormula: `LOWER({email})='${safe}'`,
      maxRecords: 1,
    });
    const phone = rows[0]?.fields?.phone;
    if (!phone) return null;
    return {
      phone,
      name: (rows[0].fields.customer_name ?? '').trim() || 'there',
    };
  }

  /**
   * A guest who booked through the website may never have messaged us, so they
   * have no Conversations row at all. The booking email gave us their phone
   * number, so the Guests table can still match them — without this they would
   * silently get none of their pre-arrival nudges.
   */
  private async fromGuests(email: string): Promise<Recipient | null> {
    try {
      const rows = await this.guests.findByEmail(email);
      const match = rows.find((r) => r.fields.phone);
      if (!match?.fields.phone) return null;
      this.logger.info('email-integration', 'matched guest via Guests table', {
        email,
        phone: match.fields.phone,
        bookingRef: match.fields.booking_ref,
      });
      return {
        phone: match.fields.phone,
        name:
          (match.fields.guest_name ?? '').trim().split(/\s+/)[0] || 'there',
      };
    } catch (err) {
      this.logger.warn('email-integration', 'Guests lookup failed', {
        email,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * The confirmation email is proof the booking landed, so the CRM should say
   * so and the chase sequence must stop. Best-effort: the nudge has already
   * gone out, and a bookkeeping failure must not look like a send failure.
   */
  private async markBooked(phone: string): Promise<void> {
    try {
      await this.conversation.setLifecycleStatus(phone, 'Booked');
    } catch (err) {
      this.logger.warn('email-integration', 'set Booked after confirmation failed', {
        phone,
        error: (err as Error).message,
      });
    }
    try {
      await this.followUps.cancel(phone);
    } catch (err) {
      this.logger.warn('email-integration', 'follow-up cancel after confirmation failed', {
        phone,
        error: (err as Error).message,
      });
    }
  }
}
