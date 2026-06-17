/**
 * Seed/update Pricing table in Airtable.
 *
 * Usage:
 *   npm run seed:pricing
 *
 * Idempotent: upserts by `label`. Edit PRICING_BANDS below and re-run.
 *
 * Airtable table must have fields: label (string), start_date (date),
 * end_date (date), weekly_rate (currency/number), min_weeks (number).
 *
 * The `base` row has a weekly_rate but no start_date/end_date. PricingService
 * uses it as the fallback rate for any check-in not covered by a seasonal band
 * (e.g. years beyond the seeded bands).
 */
import Airtable from 'airtable';

type PricingRow = {
  label: string;
  start_date?: string;
  end_date?: string;
  weekly_rate: number;
  min_weeks: number;
};

const PRICING_BANDS: PricingRow[] = [
  { label: 'base',             weekly_rate: 2495, min_weeks: 1 },
  { label: 'Low season',       start_date: '2026-10-03', end_date: '2027-05-30', weekly_rate: 2495, min_weeks: 1 },
  { label: 'Summer 2027',      start_date: '2027-05-30', end_date: '2027-07-11', weekly_rate: 3995, min_weeks: 1 },
  { label: 'High Summer 2027', start_date: '2027-07-11', end_date: '2027-08-29', weekly_rate: 4995, min_weeks: 1 },
  { label: 'Autumn 2027',      start_date: '2027-08-29', end_date: '2027-10-03', weekly_rate: 3995, min_weeks: 1 },
  { label: 'Late Autumn',      start_date: '2027-10-03', end_date: '2027-11-07', weekly_rate: 2495, min_weeks: 1 },
  { label: 'Spring 2028',      start_date: '2028-04-02', end_date: '2028-05-21', weekly_rate: 2695, min_weeks: 1 },
  { label: 'Early Summer 28',  start_date: '2028-05-21', end_date: '2028-07-09', weekly_rate: 4295, min_weeks: 1 },
  { label: 'Summer',           start_date: '2028-07-09', end_date: '2028-09-03', weekly_rate: 5795, min_weeks: 1 },
  { label: 'Late Summer 28',   start_date: '2028-09-03', end_date: '2028-10-15', weekly_rate: 4495, min_weeks: 1 },
  { label: 'Autumn 28',        start_date: '2028-10-15', end_date: '2028-11-12', weekly_rate: 3995, min_weeks: 1 },
];

const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set.');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const table = base<PricingRow>('Pricing');

async function upsert(row: PricingRow): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await table
    .select({
      filterByFormula: `{label}='${row.label.replace(/'/g, "\\'")}'`,
      maxRecords: 1,
    })
    .firstPage();

  if (existing.length === 0) {
    await table.create(row);
    return 'created';
  }

  const current = existing[0];
  if (
    current.fields.start_date === row.start_date &&
    current.fields.end_date === row.end_date &&
    current.fields.weekly_rate === row.weekly_rate &&
    current.fields.min_weeks === row.min_weeks
  ) {
    return 'unchanged';
  }

  await table.update(current.id, row);
  return 'updated';
}

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of PRICING_BANDS) {
    const result = await upsert(row);
    if (result === 'created') {
      created++;
      console.log(`+ created  ${row.label}`);
    } else if (result === 'updated') {
      updated++;
      console.log(`~ updated  ${row.label}`);
    } else {
      unchanged++;
      console.log(`  unchanged ${row.label}`);
    }
  }

  console.log(
    `\nDone. ${created} created, ${updated} updated, ${unchanged} unchanged (total ${PRICING_BANDS.length}).`,
  );
}

main().catch((err: Error) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
