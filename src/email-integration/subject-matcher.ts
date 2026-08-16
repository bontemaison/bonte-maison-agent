// Keys MUST exactly match the WhatsApp Business Template names registered
// with Meta — we call sendTemplate(phone, key, ...) and Meta resolves by name.
export type NudgeKey =
  | 'nudge_booking_confirmation'
  | 'nudge_4_weeks_anticipation'
  | 'nudge_1_week_practical'
  | 'nudge_pre_arrival'
  | 'nudge_mid_stay'
  | 'nudge_before_departure'
  | 'nudge_thank_you'
  | 'nudge_re_engagement';

// SuperControl does not send from bookings@bontemaison.com directly — it
// relays through Mandrill, which rewrites the envelope sender:
//
//   From:     "Bonte holiday home in France"
//             <bookings=bontemaison.com@secure-booking-email.net>
//   Reply-To: bookings@bontemaison.com
//
// Only the Reply-To carries the friendly address, so the allowlist has to know
// the relay form too or every SuperControl email is dropped as an unknown
// sender. See resources/booking-confirmed.eml for a real example.
export const SUPERCONTROL_RELAY_SENDER =
  'bookings=bontemaison.com@secure-booking-email.net';

// Single source of truth for SuperControl. Update the right-hand strings when
// Jim tweaks SuperControl subjects; the left-hand keys must stay aligned with
// the Meta template names.
export const SUPERCONTROL_CONFIG = {
  senderEmail: 'bookings@bontemaison.com',
  senderEmails: ['bookings@bontemaison.com', SUPERCONTROL_RELAY_SENDER],
  subjects: {
    nudge_booking_confirmation:  'Your Stay at Bonté is Confirmed',
    nudge_4_weeks_anticipation:  'Your stay at Bonté — wine, vineyards and long lunches ahead',
    nudge_1_week_practical:      'Your stay at Bonté — everything you need for arrival',
    nudge_pre_arrival:           'Bonté — your arrival details',
    nudge_mid_stay:              'Just checking in — hope you’re enjoying Bonté',
    nudge_before_departure:      'Before you leave Bonté',
    nudge_thank_you:             'Thank you for staying',
    nudge_re_engagement:         'Thinking about another stay at Bonté',
  } satisfies Record<NudgeKey, string>,
};

// Normalise for tolerant comparison: lowercase, collapse whitespace, unify
// dash + quote variants, strip accents. Catches things like double-spaces,
// em/en-dashes, curly apostrophes vs straight ones, and "Bonté" vs "Bonte" —
// real SuperControl deliveries (and mail clients re-saving them) have been
// seen with the accent silently dropped, and an unfolded comparison drops
// the whole email as unmatched.
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics (e.g. accented e -> e)
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')   // unicode dashes → '-'
    .replace(/[’‘‛`]/g, "'")    // curly/back single quotes → '
    .replace(/[“”„]/g, '"')     // curly double quotes → "
    .replace(/\s+/g, ' ')
    .trim();
}

const SUBJECT_INDEX: Map<string, NudgeKey> = new Map(
  (Object.entries(SUPERCONTROL_CONFIG.subjects) as [NudgeKey, string][]).map(
    ([key, subject]) => [normalize(subject), key],
  ),
);

export function matchSubject(subject: string | null | undefined): NudgeKey | null {
  if (!subject) return null;
  return SUBJECT_INDEX.get(normalize(subject)) ?? null;
}

/**
 * The email that carries the guest record. Deliberately NOT a `NudgeKey` — it
 * triggers a write to the `Guests` table, not a WhatsApp send, and must never
 * be routed through the nudge dispatcher.
 *
 * This is a distinct email from `nudge_booking_confirmation` ("Your Stay at
 * Bonté is Confirmed"), which SuperControl sends later, once the balance is
 * paid. The deposit email is the first point at which we learn the guest's
 * phone number, and the booking already blocks the iCal by then.
 */
export const BOOKING_RECORD_SUBJECT = 'Deposit paid for your holiday at Bonte';

const BOOKING_RECORD_SUBJECT_NORMALIZED = normalize(BOOKING_RECORD_SUBJECT);

export function isBookingRecordEmail(subject: string | null | undefined): boolean {
  if (!subject) return false;
  return normalize(subject) === BOOKING_RECORD_SUBJECT_NORMALIZED;
}

const SENDER_INDEX: Set<string> = new Set(
  SUPERCONTROL_CONFIG.senderEmails.map((s) => s.toLowerCase()),
);

export function isSuperControlSender(fromAddress: string | null | undefined): boolean {
  if (!fromAddress) return false;
  return SENDER_INDEX.has(fromAddress.trim().toLowerCase());
}
