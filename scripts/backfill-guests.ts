/**
 * One-off backfill of the Guests table from historical SuperControl booking
 * emails.
 *
 * Scans the WHOLE bookings@ mailbox (not just unseen), parses every
 * booking-record email with the same parser the live watcher uses, and upserts
 * one Guests row per booking. Then makes sure each guest has a Conversations
 * row so Jim's CRM view isn't empty on day one.
 *
 * Safety: this script NEVER marks mail \Seen, NEVER sends a WhatsApp message
 * and NEVER schedules a follow-up. It is dry-run by default.
 *
 * Usage:
 *   npm run backfill:guests                # dry run — prints what it would write
 *   npm run backfill:guests -- --commit    # actually write to Airtable
 *   npm run backfill:guests -- --limit 20  # only look at the 20 newest matches
 */
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AirtableService } from '../src/airtable/airtable.service';
import { startOfUtcDay, parseIsoDate } from '../src/common/dates';
import { ConversationService } from '../src/conversation/conversation.service';
import {
  parseBookingEmail,
  ParsedBooking,
} from '../src/email-integration/booking-email.parser';
import {
  isBookingRecordEmail,
  SUPERCONTROL_CONFIG,
} from '../src/email-integration/subject-matcher';
import { GuestsService } from '../src/guests/guests.service';
import { HoldsService } from '../src/holds/holds.service';
import { LoggerService } from '../src/logger/logger.service';

type Envelope = {
  messageId?: string;
  subject?: string;
  from?: Array<{ address?: string; name?: string }>;
};

type Args = { commit: boolean; limit: number | null };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--limit');
  return {
    commit: argv.includes('--commit'),
    limit: idx !== -1 && argv[idx + 1] ? parseInt(argv[idx + 1], 10) : null,
  };
}

function describeImapError(err: unknown): Record<string, unknown> {
  const e = err as {
    message?: string;
    responseText?: string;
    executedCommand?: string;
    authenticationFailed?: boolean;
  };
  return {
    error: e?.message ?? String(err),
    responseText: e?.responseText,
    executedCommand: e?.executedCommand,
    authenticationFailed: e?.authenticationFailed,
  };
}

/**
 * Services are wired by hand rather than through NestFactory: booting AppModule
 * would also start the live email watcher and every cron, which is exactly what
 * a backfill must not do.
 */
function buildServices() {
  const config = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;
  const logger = new LoggerService(config);
  const airtable = new AirtableService(config, logger);
  const holds = new HoldsService(airtable, logger);
  return {
    guests: new GuestsService(airtable, holds, logger),
    conversations: new ConversationService(airtable, logger),
  };
}

function stayStatus(booking: ParsedBooking): 'future' | 'current' | 'past' {
  const today = startOfUtcDay(new Date()).getTime();
  if (parseIsoDate(booking.checkOut).getTime() < today) return 'past';
  if (parseIsoDate(booking.checkIn).getTime() > today) return 'future';
  return 'current';
}

const allowedSenders = new Set<string>([
  ...SUPERCONTROL_CONFIG.senderEmails.map((s) => s.toLowerCase()),
  ...(process.env.SUPERCONTROL_EXTRA_SENDERS
    ? process.env.SUPERCONTROL_EXTRA_SENDERS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : []),
]);

async function collectBookings(limit: number | null): Promise<{
  bookings: ParsedBooking[];
  scanned: number;
  matched: number;
  unparseable: string[];
}> {
  const host = process.env.SUPERCONTROL_IMAP_HOST;
  const user = process.env.SUPERCONTROL_IMAP_USER;
  const pass = process.env.SUPERCONTROL_IMAP_PASS;
  const port = process.env.SUPERCONTROL_IMAP_PORT
    ? parseInt(process.env.SUPERCONTROL_IMAP_PORT, 10)
    : 993;

  if (!host || !user || !pass) {
    throw new Error(
      'IMAP not configured — set SUPERCONTROL_IMAP_HOST / _USER / _PASS in .env',
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
  });
  client.on('error', (err) =>
    console.error('IMAP client error', describeImapError(err)),
  );

  const bookings: ParsedBooking[] = [];
  const unparseable: string[] = [];
  let scanned = 0;
  const candidates: number[] = [];

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const mailbox = client.mailbox;
    const total =
      mailbox && typeof mailbox !== 'boolean' ? mailbox.exists : null;
    console.log(
      `Connected to ${user} — INBOX holds ${total ?? '?'} message(s)`,
    );

    // Envelopes first: downloading every body in the mailbox would be slow and
    // pointless when only one subject matters.
    for await (const msg of client.fetch('1:*', {
      envelope: true,
      uid: true,
    })) {
      scanned++;
      const env = (msg.envelope ?? {}) as Envelope;
      const from = (env.from?.[0]?.address ?? '').trim().toLowerCase();
      if (!allowedSenders.has(from)) continue;
      if (!isBookingRecordEmail(env.subject)) continue;
      if (msg.uid !== undefined) candidates.push(msg.uid);
    }

    // Newest first, so --limit gives the most recent bookings.
    candidates.reverse();
    const selected = limit ? candidates.slice(0, limit) : candidates;
    console.log(
      `Scanned ${scanned} message(s); ${candidates.length} booking email(s) matched${
        limit ? `, taking the newest ${selected.length}` : ''
      }`,
    );

    for (const uid of selected) {
      const fetched = await client.fetchOne(
        String(uid),
        { source: true },
        { uid: true },
      );
      const source = fetched ? fetched.source : null;
      if (!source) {
        unparseable.push(`uid ${uid}: body could not be downloaded`);
        continue;
      }
      const mail = await simpleParser(source);
      const booking = parseBookingEmail(
        mail.text ?? '',
        mail.html || undefined,
      );
      if (!booking) {
        unparseable.push(`uid ${uid}: "${mail.subject ?? ''}" did not parse`);
        continue;
      }
      bookings.push(booking);
    }
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      // ignore close errors
    }
  }

  // Same booking can appear twice (amendment, redelivery). Last one wins.
  const byRef = new Map<string, ParsedBooking>();
  for (const b of bookings) byRef.set(b.bookingRef, b);

  return {
    bookings: [...byRef.values()].sort((a, b) =>
      a.checkIn.localeCompare(b.checkIn),
    ),
    scanned,
    matched: candidates.length,
    unparseable,
  };
}

function printTable(bookings: ParsedBooking[]): void {
  console.log(
    '\n  ref   status   check-in     check-out    phone           guest',
  );
  console.log('  ' + '-'.repeat(72));
  for (const b of bookings) {
    console.log(
      `  ${b.bookingRef.padEnd(5)} ${stayStatus(b).padEnd(8)} ${b.checkIn}   ${
        b.checkOut
      }   ${(b.phone ?? '(none)').padEnd(15)} ${b.guestName}`,
    );
  }
  console.log('');
}

async function main(): Promise<void> {
  const { commit, limit } = parseArgs();
  console.log(
    commit
      ? 'MODE: commit — Airtable will be written to.\n'
      : 'MODE: dry run — nothing will be written. Re-run with --commit to apply.\n',
  );

  const { bookings, matched, unparseable } = await collectBookings(limit);

  if (bookings.length === 0) {
    console.log('No booking emails could be parsed. Nothing to do.');
    return;
  }

  printTable(bookings);

  const noPhone = bookings.filter((b) => !b.phone);
  if (noPhone.length > 0) {
    console.log(
      `${noPhone.length} booking(s) have no phone number in the email — add those by hand in Airtable:`,
    );
    for (const b of noPhone) {
      console.log(`  • booking ${b.bookingRef} — ${b.guestName}`);
    }
    console.log('');
  }
  if (unparseable.length > 0) {
    console.log(`${unparseable.length} email(s) could not be parsed:`);
    for (const u of unparseable) console.log(`  • ${u}`);
    console.log('');
  }

  if (!commit) {
    console.log(
      `Would write ${bookings.length} Guests row(s) (of ${matched} matched email(s)).`,
    );
    return;
  }

  const { guests, conversations } = buildServices();
  let written = 0;
  let crmRows = 0;
  const failures: string[] = [];

  for (const booking of bookings) {
    try {
      await guests.upsertByBookingRef(booking, 'backfill');
      written++;
    } catch (err) {
      failures.push(`booking ${booking.bookingRef}: ${(err as Error).message}`);
      continue;
    }

    // Seed the CRM so Jim opens Airtable to a populated view. No message is
    // sent and no follow-up is queued — those live in other tables entirely.
    if (!booking.phone) continue;
    try {
      await conversations.updateContext(booking.phone, {
        customerName: booking.guestName || null,
      });
      if (booking.email) {
        await conversations.recordEmail(booking.phone, booking.email);
      }
      const status = stayStatus(booking);
      if (status !== 'past') {
        await conversations.setLifecycleStatus(booking.phone, 'Booked');
      }
      crmRows++;
    } catch (err) {
      failures.push(
        `conversation for ${booking.phone}: ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `\nDone. ${written} guest row(s) written, ${crmRows} conversation row(s) touched, ${noPhone.length} without a phone.`,
  );
  if (failures.length > 0) {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  • ${f}`);
  }
}

main().catch((err: Error) => {
  console.error('backfill:guests failed:', err.message);
  process.exit(1);
});
