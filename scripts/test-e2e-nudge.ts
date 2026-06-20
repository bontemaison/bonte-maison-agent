/**
 * Full end-to-end SuperControl nudge test in ONE command.
 *
 * Chains the entire real flow:
 *   1. SMTP-sends a SuperControl-style email (correct sender + subject) into
 *      the watched inbox, addressed To: the guest's email.
 *   2. Boots the real AppModule and drives the actual EmailWatcherService —
 *      polls IMAP, allowlists the sender, matches the subject, resolves the
 *      guest by To: address in Airtable, and fires
 *      whatsapp.sendTemplate(phone, key, {{1}}: name).
 *   3. Polls until the message is processed (or times out), then exits.
 *
 * Unlike `test:nudges` (sends the WA template directly) and `watch:imap`
 * (read-only, never dispatches), this exercises the whole chain exactly as
 * production does — including the \Seen marking and guest matching.
 *
 * PREREQUISITES:
 * - SUPERCONTROL_IMAP_* must authenticate (run `npm run watch:imap -- --once`).
 * - SMTP_* must be set (used to inject the test email).
 * - A Conversations row must exist with email = GUEST_EMAIL and a phone, or
 *   the dispatcher logs "unmatched guest" and notifies the owner instead.
 * - The nudge_* WhatsApp template must be approved at Meta to actually deliver.
 *
 * Usage:
 *   npm run test:e2e-nudge -- GUEST_EMAIL                 # defaults to pre_arrival
 *   npm run test:e2e-nudge -- GUEST_EMAIL pre_arrival     # pick the subject/key
 *   npm run test:e2e-nudge -- guest@example.com booking_confirmation
 *
 * Short keys: booking_confirmation, weeks_4, weeks_1, pre_arrival, mid_stay,
 *             before_departure, thank_you, re_engagement.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AppModule } from '../src/app.module';
import { EmailWatcherService } from '../src/email-integration/email-watcher.service';
import { SUPERCONTROL_CONFIG } from '../src/email-integration/subject-matcher';

const SHORT_KEYS: Record<string, keyof typeof SUPERCONTROL_CONFIG.subjects> = {
  booking_confirmation: 'nudge_booking_confirmation',
  weeks_4: 'nudge_4_weeks_anticipation',
  weeks_1: 'nudge_1_week_practical',
  pre_arrival: 'nudge_pre_arrival',
  mid_stay: 'nudge_mid_stay',
  before_departure: 'nudge_before_departure',
  thank_you: 'nudge_thank_you',
  re_engagement: 'nudge_re_engagement',
};

function resolveSubject(arg: string | undefined): {
  key: keyof typeof SUPERCONTROL_CONFIG.subjects;
  subject: string;
} {
  const short = arg ?? 'pre_arrival';
  const key =
    SHORT_KEYS[short] ??
    (short in SUPERCONTROL_CONFIG.subjects
      ? (short as keyof typeof SUPERCONTROL_CONFIG.subjects)
      : undefined);
  if (!key) {
    throw new Error(
      `Unknown subject key "${short}". Use one of: ${Object.keys(SHORT_KEYS).join(', ')}`,
    );
  }
  return { key, subject: SUPERCONTROL_CONFIG.subjects[key] };
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTestEmail(to: string, subject: string, key: string): Promise<string> {
  const host = required('SMTP_HOST');
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = required('SMTP_USER');
  const pass = required('SMTP_PASS');
  // The watcher allowlists the SENDER. Gmail rewrites From to the authenticated
  // account unless it's a verified send-as alias, so the email will arrive From
  // the SMTP user (or SMTP_FROM). That address must therefore be allowlisted —
  // either it IS the canonical SuperControl sender, or add it to
  // SUPERCONTROL_EXTRA_SENDERS, or the watcher will SKIP it.
  const from = process.env.SMTP_FROM ?? user;

  // Mirror production: bookings@ sends To: the guest and BCC: the agent inbox.
  // The watcher reads To: (= guest) to match the Airtable row, while the BCC is
  // what actually lands the message in the watched mailbox. BCC headers aren't
  // delivered, so env.to stays the guest address. Required: the watched inbox
  // must be the IMAP user we poll.
  const bcc = required('SUPERCONTROL_IMAP_USER');

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from,
    to,
    bcc,
    subject,
    text:
      `End-to-end SuperControl nudge test.\n` +
      `Expected nudge key: ${key}\n` +
      `Guest resolved via To: ${to}\n`,
  });
  return info.messageId;
}

async function main(): Promise<void> {
  const [emailArg, subjectArg] = process.argv.slice(2);
  if (!emailArg) {
    throw new Error('Provide the guest email as the first arg: npm run test:e2e-nudge -- guest@example.com');
  }
  const guestEmail = emailArg.trim();
  const { key, subject } = resolveSubject(subjectArg);

  const fromAddr = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '(SMTP_USER unset)';
  console.log(`\n=== E2E nudge test ===`);
  console.log(`guest email : ${guestEmail}   (To: — used to match the Airtable row)`);
  console.log(`bcc inbox   : ${process.env.SUPERCONTROL_IMAP_USER ?? '(unset)'}   (watched inbox)`);
  console.log(`subject     : "${subject}"  (${key})`);
  console.log(`from        : ${fromAddr}  (must be allowlisted — canonical or SUPERCONTROL_EXTRA_SENDERS)\n`);

  // 1. Inject the email.
  console.log('[1/3] injecting SuperControl email via SMTP...');
  const messageId = await sendTestEmail(guestEmail, subject, key);
  console.log(`      sent, messageId=${messageId}`);

  // 2. Boot the real app (EmailWatcherService starts its own poll loop too,
  //    but we drive pollOnce explicitly for deterministic timing; the watcher's
  //    in-memory seen-set + \Seen marking dedupes any overlap).
  console.log('[2/3] booting app context + watcher...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get(ConfigService);
    const watcher = app.get(EmailWatcherService);

    const pollMs = config.get<string>('SUPERCONTROL_IMAP_POLL_MS');
    const interval = pollMs ? parseInt(pollMs, 10) : 5_000;

    // 3. Drive a few polls so IMAP has time to surface the freshly-sent email.
    console.log('[3/3] polling for the email + dispatching nudge...');
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`      poll ${attempt}/${maxAttempts}...`);
      await watcher.pollOnce();
      await sleep(interval);
    }

    console.log(
      '\nDone. Check the logs above for "sent SuperControl nudge" (success) or',
      '\n"unmatched guest" (no Conversations row for that email). If the WhatsApp',
      '\ntemplate is unapproved at Meta the dispatch logs but delivery fails.',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error('test:e2e-nudge failed:', err.message);
  process.exit(1);
});
