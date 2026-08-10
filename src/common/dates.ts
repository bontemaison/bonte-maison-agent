/**
 * Shared date helpers.
 *
 * Booking dates in this system are *calendar dates*, not instants — "2 May 2027"
 * is a day, not a moment. Every such date is anchored at UTC midnight so that
 * comparisons are timezone-independent. Never build a booking date with a bare
 * `new Date(...)` outside this module.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Re-anchors a *floating* iCal datetime to UTC midnight.
 *
 * Values like `DTSTART:20270509T000000` carry no `Z` and no `TZID`, so node-ical
 * resolves them in the server's local zone — on UTC+7 that becomes
 * 2027-05-08T17:00Z, a day early. Reading the wall-clock parts back with local
 * getters and rebuilding via `Date.UTC` recovers the calendar day the feed
 * actually meant, on any server timezone.
 */
export function floatingDateToUtc(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Truncates an instant to midnight of its UTC calendar day. */
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Parses a `YYYY-MM-DD` calendar date as UTC midnight. Tolerates a full ISO
 * timestamp (Airtable returns one if a date field has "include time" enabled)
 * by taking only the date portion.
 */
export function parseIsoDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Formats a date as `YYYY-MM-DD`. */
export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** First Sunday on or after `d`, at UTC midnight. Returns `d` itself if Sunday. */
export function nextSunday(d: Date): Date {
  const start = startOfUtcDay(d);
  return addDays(start, (7 - start.getUTCDay()) % 7);
}
