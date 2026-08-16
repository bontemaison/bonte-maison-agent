import * as fs from 'fs';
import * as path from 'path';
import { simpleParser } from 'mailparser';
import { parseBookingEmail, ParsedBooking } from './booking-email.parser';

const FIXTURE = path.join(
  __dirname,
  '..',
  '..',
  'resources',
  'booking-confirmed.eml',
);

describe('parseBookingEmail (real SuperControl email)', () => {
  let booking: ParsedBooking | null;

  beforeAll(async () => {
    // Parse the raw .eml exactly as the watcher does. The text part is
    // quoted-printable with soft line breaks mid-word ("rec=\neived",
    // "Bont=C3=A9"), so regexing the raw source would fail — the decode has to
    // happen first, and this test proves that path works end to end.
    const mail = await simpleParser(fs.readFileSync(FIXTURE));
    booking = parseBookingEmail(mail.text ?? '', mail.html || undefined);
  });

  it('extracts the booking reference', () => {
    expect(booking?.bookingRef).toBe('33');
  });

  it('extracts the guest name from the salutation, without the title', () => {
    // The address block says "*Mrs Abigail Johns*"; the Dear line is clean.
    expect(booking?.guestName).toBe('Abigail Johns');
    expect(booking?.firstName).toBe('Abigail');
  });

  it('extracts the guest email', () => {
    expect(booking?.email).toBe('asjohns95@gmail.com');
  });

  it('extracts the guest phone and normalises it', () => {
    expect(booking?.phoneRaw).toBe('+447877023353');
    expect(booking?.phone).toBe('447877023353');
  });

  // Jim signs off with "+44 (0)7435 301 371" further down the same body. An
  // unanchored phone search picks up the owner's number and every future
  // message from the real guest goes unrecognised.
  it("never picks up Jim's own number from the signature", () => {
    expect(booking?.phone).not.toBe('447435301371');
    expect(booking?.phoneRaw).not.toContain('7435');
  });

  it('extracts arrival and departure as calendar dates', () => {
    expect(booking?.checkIn).toBe('2027-05-23');
    expect(booking?.checkOut).toBe('2027-05-30');
  });

  // "Booking date: Wed 22 Jul 2026" sits above the arrival row and matches the
  // same date shape — the anchors have to be label-bound, not shape-bound.
  it('does not confuse the booking date with the arrival date', () => {
    expect(booking?.checkIn).not.toBe('2026-07-22');
  });

  it('extracts the party size across the line break', () => {
    // The text part reads "Adults: 4\nChildren: 2 Infants: 2".
    expect(booking?.adults).toBe(4);
    expect(booking?.children).toBe(2);
    expect(booking?.infants).toBe(2);
  });

  // The booking table, the payment summary and the card PAN fragment all
  // collapse into one paragraph in the text part. Nothing financial may reach
  // Airtable or the composer.
  it('captures no financial data at all', () => {
    const serialised = JSON.stringify(booking);
    expect(serialised).not.toContain('2,495');
    expect(serialised).not.toContain('2495');
    expect(serialised).not.toContain('623.75');
    expect(serialised).not.toContain('1,871.25');
    expect(serialised).not.toContain('4670');
    expect(serialised).not.toContain('supercontrol.co.uk');
    expect(Object.keys(booking as object)).toEqual(
      expect.not.arrayContaining(['total', 'deposit', 'balance', 'payment']),
    );
  });
});

describe('parseBookingEmail (edge cases)', () => {
  const MINIMAL = [
    'Tel: 07901857452',
    'Email: guest@example.com',
    '*Booking number: 41*',
    'Dear  Sam Reeve',
    'Arrival date:  Sun 4 Jul 2027 from 16:00',
    'Departure date:  Sun 11 Jul 2027 (7 nights) by 10:00',
    'Guests: Adults: 2 Children: 0 Infants: 0',
  ].join('\n');

  it('normalises a national-format phone number', () => {
    expect(parseBookingEmail(MINIMAL)?.phone).toBe('447901857452');
  });

  it('parses single-digit days', () => {
    const booking = parseBookingEmail(MINIMAL);
    expect(booking?.checkIn).toBe('2027-07-04');
    expect(booking?.checkOut).toBe('2027-07-11');
  });

  // Per the brief, a booking with no phone in the body is still worth keeping —
  // Jim adds the number by hand. Dropping the record loses the whole booking.
  it('keeps the record when the phone is missing, flagging it', () => {
    const noPhone = MINIMAL.replace('Tel: 07901857452', '');
    const booking = parseBookingEmail(noPhone);
    expect(booking).not.toBeNull();
    expect(booking?.phone).toBeNull();
    expect(booking?.bookingRef).toBe('41');
  });

  it('returns null when the booking cannot be identified or dated', () => {
    expect(parseBookingEmail('')).toBeNull();
    expect(parseBookingEmail('a newsletter about vineyards')).toBeNull();
    expect(
      parseBookingEmail(MINIMAL.replace('*Booking number: 41*', '')),
    ).toBeNull();
    expect(
      parseBookingEmail(MINIMAL.replace(/Arrival date:.*/, '')),
    ).toBeNull();
  });

  it('falls back to the HTML part when there is no text part', () => {
    const html = `
      <strong class="sc-summary-booking-number">Booking number: 41</strong>
      <span class="sc-summary-customer-phone"><br> Tel: +447901857452</span>
      <span class="sc-summary-customer-email"><br>Email: guest@example.com</span>
      Dear &nbsp;Sam Reeve<br>
      <tr class="sc-summary-row-arrival"><td>Arrival date: </td>
      <td colspan="2">Sun 4 Jul 2027 from 16:00</td></tr>
      <tr class="sc-summary-row-departure"><td>Departure date: </td>
      <td colspan="2">Sun 11 Jul 2027 (7 nights) by 10:00</td></tr>
      <td colspan="2">Adults: 2 Children: 0 Infants: 0</td>`;
    const booking = parseBookingEmail('', html);
    expect(booking?.bookingRef).toBe('41');
    expect(booking?.guestName).toBe('Sam Reeve');
    expect(booking?.phone).toBe('447901857452');
    expect(booking?.checkIn).toBe('2027-07-04');
  });
});
