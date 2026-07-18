import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from '../conversation/conversation.service';
import { LoggerService } from '../logger/logger.service';
import type {
  IncomingMessage,
  OutboundEcho,
  SignatureDebug,
  WhatsAppProvider,
} from './providers/provider.interface';

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';

export type SendOptions = { override?: boolean };

// Cache TTL/size for bot-sent message IDs. Webhook echoes for messages the bot
// itself just sent should land well within this window; anything older we
// assume is a human takeover.
const SENT_ID_TTL_MS = 10 * 60 * 1000;
const SENT_ID_MAX = 1000;

// Human-like typing delay: instant replies feel robotic (Jim's feedback), so
// sends wait in proportion to reply length — short replies stay snappy, long
// quotes take longer, like a person typing. Applies to session sends only;
// sendTemplate (HSM, owner notifications) stays immediate.
const TYPING_MS_PER_CHAR = 50;
const TYPING_DELAY_MIN_MS = 2000;
const TYPING_DELAY_MAX_MS = 10000;

export function computeTypingDelayMs(text: string): number {
  return Math.min(
    TYPING_DELAY_MAX_MS,
    Math.max(TYPING_DELAY_MIN_MS, text.length * TYPING_MS_PER_CHAR),
  );
}

@Injectable()
export class WhatsappService {
  private readonly sentIds = new Map<string, number>();

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly logger: LoggerService,
    private readonly conversation: ConversationService,
    private readonly config: ConfigService,
  ) {}

  async sendMessage(to: string, text: string, options: SendOptions = {}): Promise<void> {
    if (!options.override && !(await this.conversation.canSendBot(to))) {
      this.logger.warn('whatsapp', 'skipped send: conversation not in bot mode', { to });
      return;
    }
    const delayMs = computeTypingDelayMs(text);
    this.logger.debug('whatsapp', 'typing delay before send', { to, delayMs });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const result = await this.provider.sendMessage(to, text);
    if (result?.id) this.markSent(result.id);
  }

  async sendTemplate(
    to: string,
    templateName: string,
    vars: Record<string, string>,
    options: SendOptions = {},
  ): Promise<void> {
    if (!options.override && !(await this.conversation.canSendBot(to))) {
      this.logger.warn('whatsapp', 'skipped template: conversation not in bot mode', { to });
      return;
    }
    const result = await this.provider.sendTemplate(to, templateName, vars);
    if (result?.id) this.markSent(result.id);
  }

  async assignToHuman(conversationId: string): Promise<void> {
    if (this.provider.assignToHuman) {
      await this.provider.assignToHuman(conversationId);
    }
  }

  parseWebhook(payload: unknown): IncomingMessage | null {
    return this.provider.parseWebhook(payload);
  }

  parseOutboundEcho(payload: unknown): OutboundEcho | null {
    return this.provider.parseOutboundEcho?.(payload) ?? null;
  }

  wasRecentlySentByBot(id: string): boolean {
    const ts = this.sentIds.get(id);
    if (ts === undefined) return false;
    if (Date.now() - ts > SENT_ID_TTL_MS) {
      this.sentIds.delete(id);
      return false;
    }
    return true;
  }

  validateWebhookSignature(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    return this.provider.validateWebhookSignature(raw, headers);
  }

  debugSignature(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): SignatureDebug | null {
    return this.provider.debugSignature?.(raw, headers) ?? null;
  }

  // Meta's webhook verification handshake is provider-agnostic: it just needs
  // the verify token to match. Handle it here so it works regardless of which
  // provider is active (e.g. WATI's API doesn't use this, but the underlying
  // Meta Business app may still verify against our URL).
  verifyWebhook(mode: string, token: string, challenge: string): string {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (!expected) {
      throw new Error('WHATSAPP_VERIFY_TOKEN not configured');
    }
    if (mode !== 'subscribe' || token !== expected) {
      throw new Error('verification failed');
    }
    return challenge;
  }

  private markSent(id: string): void {
    const now = Date.now();
    // Evict expired entries from the front while we're here.
    for (const [key, ts] of this.sentIds) {
      if (now - ts > SENT_ID_TTL_MS) this.sentIds.delete(key);
      else break;
    }
    this.sentIds.set(id, now);
    if (this.sentIds.size > SENT_ID_MAX) {
      const oldest = this.sentIds.keys().next().value;
      if (oldest) this.sentIds.delete(oldest);
    }
  }
}
