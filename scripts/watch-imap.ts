/**
 * Read-only IMAP watcher for diagnosing the SuperControl mailbox.
 *
 * Connects with the same SUPERCONTROL_IMAP_* config as EmailWatcherService,
 * then prints inbox status and every UNSEEN message — evaluating the sender
 * allowlist and subject match for each — on a repeating interval.
 *
 * It NEVER marks messages \Seen and NEVER dispatches a nudge. Purely
 * observational, so you can run it alongside the app or on its own to confirm
 * the connection works and see exactly what the real watcher would act on.
 *
 * Usage:
 *   npm run watch:imap                 # poll forever (interval = SUPERCONTROL_IMAP_POLL_MS or 30s)
 *   npm run watch:imap -- --once       # single poll then exit
 *   npm run watch:imap -- --interval 5000   # override poll interval (ms)
 *   npm run watch:imap -- --all        # show ALL recent messages, not just unseen
 *
 * On auth/connection failure it prints the full imapflow error detail
 * (responseText, executedCommand, authenticationFailed) instead of the
 * opaque "Command failed".
 */
import { ImapFlow } from 'imapflow';
import {
  matchSubject,
  SUPERCONTROL_CONFIG,
} from '../src/email-integration/subject-matcher';

type Envelope = {
  messageId?: string;
  subject?: string;
  from?: Array<{ address?: string; name?: string }>;
  to?: Array<{ address?: string; name?: string }>;
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts(): string {
  return new Date().toISOString();
}

const host = process.env.SUPERCONTROL_IMAP_HOST;
const user = process.env.SUPERCONTROL_IMAP_USER;
const pass = process.env.SUPERCONTROL_IMAP_PASS;
const port = process.env.SUPERCONTROL_IMAP_PORT
  ? parseInt(process.env.SUPERCONTROL_IMAP_PORT, 10)
  : 993;

const allowedSenders = new Set<string>([
  SUPERCONTROL_CONFIG.senderEmail.toLowerCase(),
  ...(process.env.SUPERCONTROL_EXTRA_SENDERS
    ? process.env.SUPERCONTROL_EXTRA_SENDERS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : []),
]);

function parseArgs(): { once: boolean; intervalMs: number; all: boolean } {
  const argv = process.argv.slice(2);
  const once = argv.includes('--once');
  const all = argv.includes('--all');
  const idx = argv.indexOf('--interval');
  const intervalMs =
    idx !== -1 && argv[idx + 1]
      ? parseInt(argv[idx + 1], 10)
      : process.env.SUPERCONTROL_IMAP_POLL_MS
        ? parseInt(process.env.SUPERCONTROL_IMAP_POLL_MS, 10)
        : 30_000;
  return { once, intervalMs, all };
}

async function pollOnce(all: boolean): Promise<void> {
  let client: ImapFlow | null = null;
  try {
    client = new ImapFlow({
      host: host!,
      port,
      secure: port === 993,
      auth: { user: user!, pass: pass! },
      logger: false,
    });

    client.on('error', (err) => {
      console.error(`[${ts()}] IMAP client error`, describeImapError(err));
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      const total = mailbox && typeof mailbox !== 'boolean' ? mailbox.exists : '?';
      console.log(`[${ts()}] connected — INBOX has ${total} message(s) total`);

      const range = all ? { seen: undefined } : { seen: false };
      let count = 0;
      for await (const msg of client.fetch(range as never, {
        envelope: true,
        uid: true,
        flags: true,
      })) {
        count++;
        const env = (msg.envelope ?? {}) as Envelope;
        const fromAddr = (env.from?.[0]?.address ?? '').trim().toLowerCase();
        const toAddr = env.to?.[0]?.address ?? '';
        const subject = env.subject ?? '';
        const senderOk = allowedSenders.has(fromAddr);
        const key = matchSubject(subject);
        const seen = (msg.flags as Set<string> | undefined)?.has('\\Seen');

        const verdict = !senderOk
          ? 'SKIP (sender not allowlisted)'
          : !key
            ? 'SKIP (subject no match)'
            : !toAddr
              ? 'SKIP (no To address)'
              : `MATCH → ${key}`;

        console.log(
          `[${ts()}]  • uid=${msg.uid} seen=${seen ? 'y' : 'n'} from="${
            env.from?.[0]?.address ?? ''
          }" to="${toAddr}"\n      subject="${subject}"\n      → ${verdict}`,
        );
      }
      if (count === 0) {
        console.log(`[${ts()}] no ${all ? '' : 'unseen '}messages`);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error(`[${ts()}] poll failed`, describeImapError(err));
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        // ignore close errors
      }
    }
  }
}

async function main(): Promise<void> {
  if (!host || !user || !pass) {
    throw new Error(
      'IMAP not configured — set SUPERCONTROL_IMAP_HOST / _USER / _PASS in .env',
    );
  }

  const { once, intervalMs, all } = parseArgs();
  console.log(
    `[${ts()}] watching ${user} @ ${host}:${port} (secure=${port === 993})`,
  );
  console.log(
    `[${ts()}] allowlisted senders: ${[...allowedSenders].join(', ')}`,
  );
  console.log(
    `[${ts()}] mode: ${once ? 'single poll' : `every ${intervalMs}ms`}${
      all ? ', showing ALL messages' : ', unseen only'
    }\n`,
  );

  if (once) {
    await pollOnce(all);
    return;
  }

  // Run forever; Ctrl-C to stop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pollOnce(all);
    await sleep(intervalMs);
  }
}

main().catch((err: Error) => {
  console.error('watch:imap failed:', err.message);
  process.exit(1);
});
