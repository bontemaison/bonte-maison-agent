import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { LoggerService } from '../logger/logger.service';
import { NudgeDispatcherService } from './nudge-dispatcher.service';
import { matchSubject, SUPERCONTROL_CONFIG } from './subject-matcher';

type Envelope = {
  messageId?: string;
  subject?: string;
  from?: Array<{ address?: string; name?: string }>;
  to?: Array<{ address?: string; name?: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * imapflow throws a bare `Error('Command failed')` on a NO/BAD IMAP response
 * and attaches the real detail to extra properties. Surface them so the log
 * tells us *which* command failed and *why* (auth, mailbox, throttling, etc.).
 */
function describeImapError(err: unknown): Record<string, unknown> {
  const e = err as {
    message?: string;
    code?: string;
    responseText?: string;
    responseStatus?: string;
    executedCommand?: string;
    authenticationFailed?: boolean;
  };
  return {
    error: e?.message ?? String(err),
    code: e?.code,
    responseStatus: e?.responseStatus,
    responseText: e?.responseText,
    executedCommand: e?.executedCommand,
    authenticationFailed: e?.authenticationFailed,
  };
}

@Injectable()
export class EmailWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly host: string | undefined;
  private readonly user: string | undefined;
  private readonly pass: string | undefined;
  private readonly port: number;
  private readonly pollMs: number;
  private readonly dispatchSpacingMs: number;
  private readonly enabled: boolean;

  private readonly seen = new Set<string>();
  private readonly allowedSenders: Set<string>;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    config: ConfigService,
    private readonly logger: LoggerService,
    private readonly dispatcher: NudgeDispatcherService,
  ) {
    this.host = config.get<string>('SUPERCONTROL_IMAP_HOST');
    this.user = config.get<string>('SUPERCONTROL_IMAP_USER');
    this.pass = config.get<string>('SUPERCONTROL_IMAP_PASS');
    const portRaw = config.get<string>('SUPERCONTROL_IMAP_PORT');
    this.port = portRaw ? parseInt(portRaw, 10) : 993;
    const pollRaw = config.get<string>('SUPERCONTROL_IMAP_POLL_MS');
    this.pollMs = pollRaw ? parseInt(pollRaw, 10) : 30_000;
    const spacingRaw = config.get<string>('SUPERCONTROL_DISPATCH_SPACING_MS');
    this.dispatchSpacingMs = spacingRaw ? parseInt(spacingRaw, 10) : 3_000;
    this.enabled = !!(this.host && this.user && this.pass);

    const extra = config.get<string>('SUPERCONTROL_EXTRA_SENDERS');
    this.allowedSenders = new Set<string>([
      SUPERCONTROL_CONFIG.senderEmail.toLowerCase(),
      ...(extra
        ? extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        : []),
    ]);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        'email-integration',
        'IMAP not configured — SuperControl watcher disabled',
      );
      return;
    }
    this.logger.info('email-integration', 'starting SuperControl watcher', {
      host: this.host,
      user: this.user,
      pollMs: this.pollMs,
    });
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.pollMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed so tests / scripts can trigger a single fetch on demand. */
  async pollOnce(): Promise<void> {
    if (this.polling) {
      this.logger.debug('email-integration', 'poll skipped — previous poll still running');
      return;
    }
    this.polling = true;

    let client: ImapFlow | null = null;
    try {
      client = new ImapFlow({
        host: this.host!,
        port: this.port,
        secure: this.port === 993,
        auth: { user: this.user!, pass: this.pass! },
        logger: false,
      });

      client.on('error', (err) => {
        this.logger.error('email-integration', 'IMAP client error', describeImapError(err));
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Drain the iterator first so we don't hold the cursor open while
        // pacing dispatches — and so we can space sends out to avoid Meta
        // template-API rate-limiting on the same WABA.
        const queue: { env: Envelope; uid: number | undefined }[] = [];
        for await (const msg of client.fetch(
          { seen: false },
          { envelope: true, uid: true },
        )) {
          queue.push({ env: msg.envelope as Envelope, uid: msg.uid });
        }

        const toMark: number[] = [];
        for (let i = 0; i < queue.length; i++) {
          const { env, uid } = queue[i];
          const handled = await this.handle(env, uid);
          if (handled && uid) toMark.push(uid);
          if (i < queue.length - 1) {
            await sleep(this.dispatchSpacingMs);
          }
        }
        if (toMark.length > 0) {
          await client.messageFlagsAdd(toMark, ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      this.logger.error('email-integration', 'poll failed', describeImapError(err));
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          // ignore close errors
        }
      }
      this.polling = false;
    }
  }

  private async handle(env: Envelope | undefined, uid: number | undefined): Promise<boolean> {
    if (!env) return false;

    const messageId = env.messageId ?? (uid !== undefined ? `uid-${uid}` : '');
    if (!messageId) return false;
    if (this.seen.has(messageId)) {
      this.logger.debug('email-integration', 'duplicate message ignored', { messageId });
      return true; // still mark seen on server
    }
    this.seen.add(messageId);

    const subject = env.subject ?? '';
    const toAddr = env.to?.[0]?.address ?? '';
    const fromAddr = env.from?.[0]?.address ?? '';

    this.logger.info('email-integration', 'inbox: new email', {
      messageId,
      subject,
      from: fromAddr,
      to: toAddr,
    });

    if (!this.allowedSenders.has(fromAddr.trim().toLowerCase())) {
      this.logger.debug('email-integration', 'ignoring email — sender not allowlisted', {
        from: fromAddr,
        subject,
      });
      return true;
    }

    const key = matchSubject(subject);
    if (!key) {
      this.logger.debug('email-integration', 'subject did not match any nudge rule', {
        subject,
      });
      return true;
    }

    if (!toAddr) {
      this.logger.warn(
        'email-integration',
        'matched subject but no To address — cannot resolve guest',
        { subject, messageId },
      );
      return true;
    }

    try {
      await this.dispatcher.dispatch({
        key,
        guestEmail: toAddr,
        subject,
        messageId,
      });
    } catch (err) {
      this.logger.error('email-integration', 'dispatch failed', {
        error: (err as Error).message,
        messageId,
        subject,
      });
    }

    return true;
  }
}
