/**
 * Sends a unique SuperControl deposit-paid email to the watched mailbox and
 * waits for the live IMAP watcher to create the corresponding Guests row.
 *
 * Usage: npm run test:e2e-booking-ingest
 *
 * The created Airtable row is intentionally retained so it can be inspected.
 */
import Airtable from 'airtable';
import * as nodemailer from 'nodemailer';
import { BOOKING_RECORD_SUBJECT } from '../src/email-integration/subject-matcher';

const POLL_MS = 5_000;
const TIMEOUT_MS = 90_000;

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const inbox = required('SUPERCONTROL_IMAP_USER');
  const smtpHost = required('SMTP_HOST');
  const smtpPort = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const smtpUser = required('SMTP_USER');
  const smtpPass = required('SMTP_PASS');
  const from = process.env.SMTP_FROM ?? smtpUser;
  const bookingRef = `99${Date.now().toString().slice(-8)}`;
  const guestEmail = `imap-watcher-test+${bookingRef}@example.com`;

  const body = [
    'Tel: +447700900123',
    `Email: ${guestEmail}`,
    `*Booking number: ${bookingRef}*`,
    'Dear IMAP Watcher Test',
    'Arrival date: Sun 23 May 2027 from 16:00',
    'Departure date: Sun 30 May 2027 (7 nights) by 10:00',
    'Guests: Adults: 2 Children: 1 Infants: 0',
  ].join('\n');

  console.log('\n=== SuperControl booking-ingestion smoke test ===');
  console.log(`watched inbox : ${inbox}`);
  console.log(`sender        : ${from} (must be in SUPERCONTROL_EXTRA_SENDERS)`);
  console.log(`booking ref   : ${bookingRef}`);
  console.log('[1/2] Sending deposit-paid email...');

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const sent = await transporter.sendMail({
    from,
    to: inbox,
    subject: BOOKING_RECORD_SUBJECT,
    text: body,
  });
  console.log(`      sent, messageId=${sent.messageId}`);

  const base = new Airtable({ apiKey: required('AIRTABLE_API_KEY') }).base(
    required('AIRTABLE_BASE_ID'),
  );
  const deadline = Date.now() + TIMEOUT_MS;
  console.log('[2/2] Waiting for the Guests row...');

  while (Date.now() < deadline) {
    const rows = await base('Guests')
      .select({
        filterByFormula: `{booking_ref}='${bookingRef}'`,
        maxRecords: 1,
      })
      .firstPage();
    const row = rows[0];
    if (row) {
      console.log('\nPASS: watcher parsed the email and posted it to Airtable.');
      console.log({ airtableRecordId: row.id, fields: row.fields });
      console.log('The test row was retained for inspection.');
      return;
    }
    await sleep(POLL_MS);
  }

  throw new Error(
    `Timed out after ${TIMEOUT_MS / 1000}s waiting for booking_ref ${bookingRef}. ` +
      'Confirm the app watcher is running and the SMTP sender is allowlisted.',
  );
}

main().catch((err: Error) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
