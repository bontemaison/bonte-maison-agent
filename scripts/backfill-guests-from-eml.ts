/**
 * Ad-hoc test: parse "Deposit paid for your holiday at Bonte" emails (the
 * SuperControl booking-record subject — the only one documented to carry the
 * guest phone number, per BOOKING_RECORD_SUBJECT in subject-matcher.ts) from
 * a local folder of .eml files, dedup by booking reference (same booking can
 * show up as multiple downloaded copies — resend, amendment, or just
 * re-exporting the same thread), and upsert every distinct booking into the
 * Guests table in Airtable. Flags bookings missing a phone, guest name, or
 * email so they can be fixed by hand instead of silently going in
 * incomplete.
 *
 * Subject matching is accent-tolerant (subject-matcher.ts's normalize() now
 * folds diacritics), so "Bonte" and "Bonté" both match — real downloaded
 * copies of the same SuperControl email have shown up with the accent
 * dropped.
 *
 * Processes ALL matching emails in the folder by default. Pass --limit N to
 * cap it to the N newest distinct bookings instead.
 *
 * No IMAP access needed — drop downloaded .eml files into CONFIG.emailFolder
 * (defaults to resources/inbox-test/) and run this. On a Mac, the easiest way
 * to get .eml files out of a mailbox is to drag messages from Apple Mail's
 * list onto a Finder folder; it saves each one as .eml automatically.
 *
 * Airtable config comes from the environment (AIRTABLE_API_KEY /
 * AIRTABLE_BASE_ID), same as every other script in this repo — NOT hardcoded
 * here. .env and .env.production point at DIFFERENT bases (dev vs live), so
 * pick deliberately with --env-file; there is no default.
 *
 * Safety, same as backfill-guests.ts: NEVER sends a WhatsApp message, NEVER
 * schedules a follow-up. Dry-run by default.
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' node --env-file=.env -r ts-node/register scripts/backfill-guests-from-eml.ts
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' node --env-file=.env -r ts-node/register scripts/backfill-guests-from-eml.ts --commit
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' node --env-file=.env.production -r ts-node/register scripts/backfill-guests-from-eml.ts --commit
 */
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { simpleParser } from 'mailparser';
import { AirtableService } from '../src/airtable/airtable.service';
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

// ---------------------------------------------------------------------------
// CONFIG — non-secret settings only. Airtable credentials come from the
// environment (loaded via --env-file), never hardcoded here.
// ---------------------------------------------------------------------------
const CONFIG = {
  // Folder of .eml files to scan (not recursive).
  emailFolder: path.join(__dirname, '..', 'resources', 'inbox-test'),
  // Cap on how many of the newest DISTINCT bookings to use. null = all.
  // Override per-run with --limit N.
  limit: null as number | null,
};
// ---------------------------------------------------------------------------

const allowedSenders = new Set<string>(
  SUPERCONTROL_CONFIG.senderEmails.map((s) => s.toLowerCase()),
);

/**
 * Services wired by hand rather than through NestFactory: booting AppModule
 * would also start the live email watcher and every cron, which a one-off
 * test script must not do. Config comes from process.env (--env-file), same
 * as backfill-guests.ts.
 */
function buildServices() {
  const config = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;
  const logger = new LoggerService(config);
  const airtable = new AirtableService(config, logger); // throws if unset
  const holds = new HoldsService(airtable, logger);
  return { guests: new GuestsService(airtable, holds, logger) };
}

type Candidate = {
  file: string;
  date: Date;
  text: string;
  html?: string;
};

/** Fields the Guests table actually depends on. Missing ones are still
 * written (per CLAUDE.md: "dropping the record would lose the whole
 * booking") but flagged loudly so they can be filled in by hand. */
function flagMissing(b: ParsedBooking): string[] {
  const flags: string[] = [];
  if (!b.phone) flags.push('NO PHONE — guest recognition will never match this number');
  if (!b.guestName.trim()) flags.push('no guest name parsed');
  if (!b.email) flags.push('no email parsed');
  return flags;
}

async function collectBookings(limit: number | null): Promise<{
  bookings: ParsedBooking[];
  scanned: number;
  matched: number;
  duplicates: number;
  unparseable: string[];
}> {
  if (!fs.existsSync(CONFIG.emailFolder)) {
    throw new Error(
      `Email folder not found: ${CONFIG.emailFolder} — create it and drop .eml files in, or update CONFIG.emailFolder`,
    );
  }

  const files = fs
    .readdirSync(CONFIG.emailFolder)
    .filter((f) => f.toLowerCase().endsWith('.eml'));

  const candidates: Candidate[] = [];
  let scanned = 0;

  for (const file of files) {
    scanned++;
    const full = path.join(CONFIG.emailFolder, file);
    const source = fs.readFileSync(full);
    const mail = await simpleParser(source);

    const from = (mail.from?.value?.[0]?.address ?? '').trim().toLowerCase();
    if (!allowedSenders.has(from)) continue;
    if (!isBookingRecordEmail(mail.subject)) continue;

    candidates.push({
      file,
      // Falls back to file mtime if the email has no Date header.
      date: mail.date ?? fs.statSync(full).mtime,
      text: mail.text ?? '',
      html: mail.html || undefined,
    });
  }

  // Newest first, so "first wins" below keeps the newest copy of a booking
  // and the final limit gives the most recent DISTINCT bookings.
  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());

  const unparseable: string[] = [];
  const byRef = new Map<string, ParsedBooking>();
  let parseableCount = 0;

  for (const c of candidates) {
    const booking = parseBookingEmail(c.text, c.html);
    if (!booking) {
      // Dump a chunk of the decoded body so the real layout of this email
      // type can be inspected — parseBookingEmail expects labels
      // (Booking number:/Arrival date:/Tel:/etc.) that a guest-facing
      // confirmation message may not use.
      const snippet = (c.text || '(no text part)').slice(0, 600).trim();
      unparseable.push(
        `${c.file}: did not parse\n----- raw text (first 600 chars) -----\n${snippet}\n---------------------------------------`,
      );
      continue;
    }
    parseableCount++;
    // Same booking can appear across multiple downloaded copies (duplicate
    // export, resend, amendment). Candidates are newest-first, so the first
    // one seen per bookingRef wins.
    if (!byRef.has(booking.bookingRef)) byRef.set(booking.bookingRef, booking);
  }

  const duplicates = parseableCount - byRef.size;
  const deduped = [...byRef.values()]; // already newest-first
  const bookings = limit !== null ? deduped.slice(0, limit) : deduped;

  console.log(
    `Scanned ${scanned} .eml file(s) in ${CONFIG.emailFolder}; ${candidates.length} subject/sender match(es), ${byRef.size} distinct booking(s) after dedup (${duplicates} duplicate copy/copies collapsed), taking ${
      limit !== null ? `the newest ${bookings.length}` : `all ${bookings.length}`
    }`,
  );

  return { bookings, scanned, matched: candidates.length, duplicates, unparseable };
}

function printTable(bookings: ParsedBooking[]): void {
  console.log('\n  ref   check-in     check-out    phone           guest');
  console.log('  ' + '-'.repeat(64));
  for (const b of bookings) {
    const flags = flagMissing(b);
    const marker = flags.length > 0 ? '  ⚠' : '';
    console.log(
      `  ${b.bookingRef.padEnd(5)} ${b.checkIn}   ${b.checkOut}   ${(b.phone ?? '(none)').padEnd(15)} ${b.guestName}${marker}`,
    );
  }
  console.log('');

  const flagged = bookings
    .map((b) => ({ b, flags: flagMissing(b) }))
    .filter((x) => x.flags.length > 0);
  if (flagged.length > 0) {
    console.log(`${flagged.length} booking(s) with missing critical info:`);
    for (const { b, flags } of flagged) {
      console.log(`  • ref ${b.bookingRef} (${b.guestName || '(no name)'}):`);
      for (const f of flags) console.log(`      - ${f}`);
    }
    console.log('');
  }
}

function parseLimit(): number | null {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--limit');
  if (idx !== -1 && argv[idx + 1]) return parseInt(argv[idx + 1], 10);
  return CONFIG.limit;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  console.log(
    commit
      ? 'MODE: commit — Airtable will be written to.\n'
      : 'MODE: dry run — nothing will be written. Re-run with --commit to apply.\n',
  );

  const { bookings, unparseable } = await collectBookings(parseLimit());

  if (bookings.length === 0) {
    console.log('No matching booking emails could be parsed. Nothing to do.');
    if (unparseable.length > 0) {
      console.log(`${unparseable.length} email(s) matched the subject but failed to parse:`);
      for (const u of unparseable) console.log(`  • ${u}`);
    }
    return;
  }

  printTable(bookings);

  if (unparseable.length > 0) {
    console.log(`${unparseable.length} email(s) could not be parsed:`);
    for (const u of unparseable) console.log(`  • ${u}`);
    console.log('');
  }

  if (!commit) {
    console.log(`Would write ${bookings.length} Guests row(s). Re-run with --commit to apply.`);
    return;
  }

  console.log(`Writing to Airtable base ${process.env.AIRTABLE_BASE_ID ?? '(unset)'}...\n`);
  const { guests } = buildServices();
  let written = 0;
  const failures: string[] = [];

  for (const booking of bookings) {
    try {
      await guests.upsertByBookingRef(booking, 'backfill');
      written++;
    } catch (err) {
      failures.push(`booking ${booking.bookingRef}: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${written} guest row(s) written.`);
  if (failures.length > 0) {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  • ${f}`);
  }
}

main().catch((err: Error) => {
  console.error('backfill-guests-from-eml failed:', err.message);
  process.exit(1);
});
