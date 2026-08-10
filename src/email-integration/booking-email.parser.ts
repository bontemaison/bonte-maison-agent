import { formatIsoDate } from '../common/dates';
import { normalizePhone } from '../common/phone';

/**
 * Structured guest record extracted from a SuperControl booking email.
 *
 * There is deliberately **no field for money**. The email carries the property
 * total, the deposit, the outstanding balance, a masked card PAN and a payment
 * link, all flattened into the same paragraph as the arrival and departure
 * rows. None of it is captured, so financial data cannot reach Airtable or the
 * composer even by accident. That is also why the date anchors below are
 * label-bound and non-greedy rather than pattern-bound.
 */
export type ParsedBooking = {
  bookingRef: string;
  guestName: string;
  firstName: string;
  email: string | null;
  /** Canonical digits-only form, or null when the email carried no number. */
  phone: string | null;
  /** Exactly as it appeared, for debugging a normalisation that went wrong. */
  phoneRaw: string | null;
  /** `YYYY-MM-DD` calendar dates — see src/common/dates.ts. */
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
};

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// "Sun 23 May 2027", optionally followed by "from 16:00" or "(7 nights) by
// 10:00". The weekday is present in every SuperControl email but ignored — the
// date itself is authoritative.
const DATE = String.raw`(?:\w{3,9},?\s+)?(\d{1,2})\s+(\w{3})\w*\s+(\d{4})`;

const TITLES = /^(mr|mrs|ms|miss|dr|prof|sir|lady)\.?\s+/i;

/**
 * Parses the decoded body of a SuperControl booking email.
 *
 * `text` must be the **decoded** text/plain part (the raw MIME part is
 * quoted-printable and breaks words across lines). `html` is used only when the
 * text part is missing or unusable; SuperControl's markup is tag soup but the
 * same labels survive a tag strip.
 *
 * Returns `null` when the email is not a parseable booking. A missing phone
 * number is NOT fatal — the record is still worth keeping, and Jim fills the
 * number in by hand.
 */
export function parseBookingEmail(
  text: string,
  html?: string,
): ParsedBooking | null {
  const fromText = extract(text ?? '');
  if (fromText) return fromText;
  return html ? extract(htmlToText(html)) : null;
}

function extract(body: string): ParsedBooking | null {
  if (!body.trim()) return null;

  const bookingRef = match(body, /Booking\s+number:\s*(\d+)/i);
  const checkIn = matchDate(body, 'Arrival date');
  const checkOut = matchDate(body, 'Departure date');

  // Without a reference we cannot upsert idempotently, and without both dates
  // the record cannot place the guest in their journey.
  if (!bookingRef || !checkIn || !checkOut) return null;

  const phoneRaw =
    match(body, /\bTel:\s*(\+?[\d][\d\s()\-.]*)/i)?.trim() ?? null;

  return {
    bookingRef,
    guestName: guestName(body),
    firstName: guestName(body).split(/\s+/)[0] ?? '',
    email:
      match(body, /\bEmail:\s*([^\s<>]+@[^\s<>]+)/i)?.toLowerCase() ?? null,
    // Anchored on "Tel:" on purpose: Jim signs every email with his own
    // "+44 (0)7435 301 371" further down the same body, and an unanchored
    // search would store the owner's number as the guest's.
    phone: phoneRaw ? normalizePhone(phoneRaw) : null,
    phoneRaw,
    checkIn,
    checkOut,
    ...partySize(body),
  };
}

/**
 * The salutation ("Dear  Abigail Johns") is cleaner than the address block,
 * which prefixes a title ("*Mrs Abigail Johns*"). Fall back to the address
 * block and strip the title if the salutation is absent.
 */
function guestName(body: string): string {
  const salutation = match(body, /^\s*Dear\s+(.+?)\s*$/m);
  if (salutation) return clean(salutation);

  const addressed = match(body, /^\s*\*([^*\n]+)\*\s*$/m);
  return addressed ? clean(addressed).replace(TITLES, '') : '';
}

function partySize(body: string): {
  adults: number;
  children: number;
  infants: number;
} {
  // "Guests: Adults: 4\nChildren: 2 Infants: 2" — the counts straddle a line
  // break in the text part, so the gaps have to allow newlines.
  const m = body.match(
    /Adults:\s*(\d+)[\s\S]{0,40}?Children:\s*(\d+)[\s\S]{0,40}?Infants:\s*(\d+)/i,
  );
  if (m) {
    return {
      adults: Number(m[1]),
      children: Number(m[2]),
      infants: Number(m[3]),
    };
  }
  return {
    adults: Number(match(body, /Adults:\s*(\d+)/i) ?? 0),
    children: Number(match(body, /Children:\s*(\d+)/i) ?? 0),
    infants: Number(match(body, /Infants:\s*(\d+)/i) ?? 0),
  };
}

/**
 * Label-bound so "Booking date: Wed 22 Jul 2026", which sits directly above the
 * arrival row and has the identical shape, can never be read as a stay date.
 */
function matchDate(body: string, label: string): string | null {
  const m = body.match(new RegExp(`${label}:\\s*${DATE}`, 'i'));
  if (!m) return null;

  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;

  // Booking dates are calendar dates anchored at UTC midnight — see
  // src/common/dates.ts.
  return formatIsoDate(new Date(Date.UTC(Number(m[3]), month, Number(m[1]))));
}

function match(body: string, re: RegExp): string | null {
  return body.match(re)?.[1]?.trim() || null;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Enough of a tag strip to recover the same labels from SuperControl's HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(tr|td|div|p|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ');
}
