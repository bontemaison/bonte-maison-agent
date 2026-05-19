/**
 * Seed BookingRules table in Airtable with default rows.
 *
 * Usage:
 *   npm run seed:booking-rules
 *
 * Idempotent — only fills in missing rows. Existing values are preserved
 * (so toggled flags like year_2026_fully_booked=true won't be reset).
 *
 * Airtable table must have fields: key (string), value (string), active (checkbox).
 */
import Airtable from 'airtable';

type BookingRuleRow = {
  key: string;
  value: string;
  active: boolean;
  description: string;
};

const ROWS: BookingRuleRow[] = [
  {
    key: 'year_2026_fully_booked',
    value: 'false',
    active: true,
    description: 'When true, 2026 enquiries get the redirect-to-2027 template.',
  },
  {
    key: 'instant_book_enabled',
    value: 'false',
    active: true,
    description: 'When true, booking confirmations use the instant-book variant.',
  },
  {
    key: 'bot_paused_global',
    value: 'false',
    active: true,
    description: 'Global kill-switch. When true, no conversation gets a bot reply.',
  },
  {
    key: 'owner_notify_phone_enabled',
    value: 'true',
    active: true,
    description:
      'When true, owner WhatsApp notifications fire to OWNER_PHONE (env). Set to false to silence WA only.',
  },
  {
    key: 'owner_notify_email_enabled',
    value: 'true',
    active: true,
    description:
      'When true, owner email notifications fire to OWNER_EMAIL (env). Set to false to silence email only.',
  },
];

const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set.');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const table = base<{ key: string; value: string; active: boolean }>('BookingRules');

async function ensureExists(
  row: BookingRuleRow,
): Promise<'created' | 'skipped'> {
  const existing = await table
    .select({
      filterByFormula: `{key}='${row.key.replace(/'/g, "\\'")}'`,
      maxRecords: 1,
    })
    .firstPage();

  if (existing.length > 0) return 'skipped';

  await table.create({
    key: row.key,
    value: row.value,
    active: row.active,
  });
  return 'created';
}

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;

  for (const row of ROWS) {
    const result = await ensureExists(row);
    if (result === 'created') {
      created++;
      console.log(`+ created  ${row.key.padEnd(24)} (default: "${row.value}")`);
    } else {
      skipped++;
      console.log(`  skipped  ${row.key.padEnd(24)} (already exists)`);
    }
  }

  console.log(
    `\nDone. ${created} created, ${skipped} skipped (total ${ROWS.length}).`,
  );
  console.log('\nDescriptions:');
  for (const row of ROWS) {
    console.log(`  ${row.key.padEnd(24)} ${row.description}`);
  }
}

main().catch((err: Error) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
