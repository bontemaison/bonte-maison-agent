import fs from 'node:fs/promises';
import Airtable from 'airtable';
import { normalizePhone } from '../src/common/phone';

const CSV_PATH = process.argv[2] ?? 'resources/guests.csv';
const TABLE = 'Guests';

type CsvRow = Record<string, string>;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function asIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{2}) ([A-Za-z]{3}) (\d{4})$/);
  if (!match) throw new Error(`Unsupported date: ${value}`);
  const date = new Date(`${match[2]} ${match[1]}, ${match[3]} UTC`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString().slice(0, 10);
}

function numberOrUndefined(value: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid number: ${value}`);
  return number;
}

async function main() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set');

  const raw = await fs.readFile(CSV_PATH, 'utf8');
  const rows = parseCsv(raw);
  if (rows[0]?.[0]?.startsWith('sep=')) rows.shift();
  const headers = rows.shift();
  if (!headers?.length) throw new Error('CSV has no header row');
  const records: CsvRow[] = rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );

  const base = new Airtable({ apiKey }).base(baseId);
  let created = 0;
  let updated = 0;
  for (const row of records) {
    const bookingRef = row['Your booking ref'] || row.Ref;
    if (!bookingRef) throw new Error(`Row for ${row['Email address'] || row['First name']} has no booking reference`);
    const fields = {
      booking_ref: bookingRef,
      guest_name: [row.Title, row['First name'], row['Last name']].filter(Boolean).join(' '),
      email: row['Email address'] || '',
      phone: normalizePhone(row['Mobile telephone'] || row.Telephone || '') || '',
      phone_raw: row['Mobile telephone'] || row.Telephone || '',
      check_in: asIsoDate(row.Arrival),
      check_out: asIsoDate(row.Departure),
      adults: numberOrUndefined(row.Adults),
      children: numberOrUndefined(row.Children),
      infants: numberOrUndefined(row.Infants),
      property: row['Property Name'] || 'Bonté Maison',
      source: 'backfill',
    };
    const matches = await base(TABLE).select({
      filterByFormula: `{booking_ref}='${bookingRef.replace(/'/g, "\\'")}'`,
      maxRecords: 1,
    }).all();
    if (matches[0]) {
      await base(TABLE).update(matches[0].id, fields);
      updated += 1;
    } else {
      await base(TABLE).create(fields);
      created += 1;
    }
  }
  console.log(`Imported ${records.length} rows into ${TABLE}: ${created} created, ${updated} updated.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
