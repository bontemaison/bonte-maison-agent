/**
 * Shared phone-number normalisation.
 *
 * The canonical form in this system is **digits only, no leading `+`**
 * (`447901857452`). That is exactly what Meta puts in `wa_id` on an inbound
 * webhook, and what every existing `phone` column already holds
 * (`Conversations`, `Holds`, `MessageLog`, `OWNER_PHONE`). Numbers arriving
 * from SuperControl booking emails are written in national or E.164 form, so
 * both sides go through `normalizePhone` before they are ever compared.
 *
 * Only `formatE164` adds a `+`, and only for display in owner notifications.
 * Nothing writes a `+` to Airtable.
 */

/**
 * Applied to national-format numbers ("07901857452"). Read from the
 * environment rather than a ConfigService so the pure helpers below stay usable
 * from scripts and specs without Nest.
 */
export const DEFAULT_COUNTRY_CODE =
  process.env.DEFAULT_COUNTRY_CODE?.replace(/\D/g, '') || '44';

/** E.164 allows at most 15 digits; anything under 8 is not a real number. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Returns the canonical digits-only form, or `null` if `raw` cannot be read as
 * a phone number. Callers log and skip on `null` — a bad number must never be
 * written to Airtable, where it would silently fail to match forever.
 */
export function normalizePhone(
  raw: string,
  defaultCc: string = DEFAULT_COUNTRY_CODE,
): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // An explicit international prefix means the country code is already there.
  const hasIntlPrefix = trimmed.startsWith('+') || digits.startsWith('00');

  let national: string;
  if (hasIntlPrefix) {
    national = stripTrunkPrefix(
      digits.startsWith('00') ? digits.slice(2) : digits,
      defaultCc,
    );
  } else if (digits.startsWith('0')) {
    // National form: the leading 0 is the trunk prefix, replaced by the code.
    national = `${defaultCc}${digits.slice(1)}`;
  } else {
    // No prefix of any kind — assume it already carries a country code.
    national = digits;
  }

  if (national.length < MIN_DIGITS || national.length > MAX_DIGITS) return null;
  return national;
}

/**
 * `+44 (0)7435 301 371` — the `(0)` is a national trunk prefix that is not
 * dialled once `+44` is present, but stripping punctuation leaves it behind as
 * `4407435301371`. Drop it when it directly follows the country code.
 */
function stripTrunkPrefix(digits: string, cc: string): string {
  if (digits.startsWith(`${cc}0`)) {
    return `${cc}${digits.slice(cc.length + 1)}`;
  }
  return digits;
}

/** Display form for owner notifications. Never persisted. */
export function formatE164(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`;
}
