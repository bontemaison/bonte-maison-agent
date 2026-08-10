import {
  BOOKING_RECORD_SUBJECT,
  isBookingRecordEmail,
  isSuperControlSender,
  matchSubject,
  SUPERCONTROL_CONFIG,
  SUPERCONTROL_RELAY_SENDER,
} from './subject-matcher';

describe('matchSubject (SuperControl exact subjects)', () => {
  it('matches each configured subject to its NudgeKey', () => {
    for (const [key, subject] of Object.entries(SUPERCONTROL_CONFIG.subjects)) {
      expect(matchSubject(subject)).toBe(key);
    }
  });

  it('is tolerant of case and whitespace differences', () => {
    expect(matchSubject('your stay at bonté is confirmed')).toBe('nudge_booking_confirmation');
    expect(matchSubject('  Your Stay at Bonté   is   Confirmed  ')).toBe('nudge_booking_confirmation');
  });

  it("normalises unicode dashes so en/em-dashes don't break matching", () => {
    // Jim's subjects use em-dashes; subjects typed with a plain hyphen
    // should still match after normalisation.
    expect(
      matchSubject('Your stay at Bonté - everything you need for arrival'),
    ).toBe('nudge_1_week_practical');
  });

  it('normalises curly apostrophes vs straight ones', () => {
    // Jim's mid-stay subject uses a curly apostrophe in "you're";
    // a straight apostrophe should still match.
    expect(
      matchSubject("Just checking in — hope you're enjoying Bonté"),
    ).toBe('nudge_mid_stay');
  });

  it('returns null for unrelated subjects', () => {
    expect(matchSubject('Marketing newsletter')).toBeNull();
    expect(matchSubject('Booking confirmed for August')).toBeNull(); // wording differs
    expect(matchSubject('')).toBeNull();
    expect(matchSubject(null)).toBeNull();
    expect(matchSubject(undefined)).toBeNull();
  });
});

describe('isBookingRecordEmail', () => {
  it('recognises the deposit-paid email that carries the guest record', () => {
    expect(isBookingRecordEmail(BOOKING_RECORD_SUBJECT)).toBe(true);
    expect(isBookingRecordEmail('deposit paid for your holiday at bonte')).toBe(true);
    expect(isBookingRecordEmail('  Deposit  paid for your holiday at Bonte ')).toBe(true);
  });

  it('does not collide with the nudge subjects', () => {
    for (const subject of Object.values(SUPERCONTROL_CONFIG.subjects)) {
      expect(isBookingRecordEmail(subject)).toBe(false);
    }
    // The later full-confirmation email must stay a nudge, not a record write.
    expect(matchSubject(SUPERCONTROL_CONFIG.subjects.nudge_booking_confirmation)).toBe(
      'nudge_booking_confirmation',
    );
    expect(matchSubject(BOOKING_RECORD_SUBJECT)).toBeNull();
  });

  it('returns false for anything else', () => {
    expect(isBookingRecordEmail('Marketing newsletter')).toBe(false);
    expect(isBookingRecordEmail('')).toBe(false);
    expect(isBookingRecordEmail(null)).toBe(false);
    expect(isBookingRecordEmail(undefined)).toBe(false);
  });
});

describe('isSuperControlSender', () => {
  it('accepts the friendly sender, case-insensitively', () => {
    expect(isSuperControlSender('bookings@bontemaison.com')).toBe(true);
    expect(isSuperControlSender('Bookings@BonteMaison.com')).toBe(true);
    expect(isSuperControlSender('  bookings@bontemaison.com  ')).toBe(true);
  });

  // SuperControl relays through Mandrill, so the envelope From is rewritten.
  // Rejecting this form drops every real SuperControl email.
  it('accepts the Mandrill relay sender', () => {
    expect(isSuperControlSender(SUPERCONTROL_RELAY_SENDER)).toBe(true);
    expect(
      isSuperControlSender('bookings=bontemaison.com@secure-booking-email.net'),
    ).toBe(true);
    expect(
      isSuperControlSender('Bookings=BonteMaison.com@Secure-Booking-Email.net'),
    ).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSuperControlSender('jim@bontemaison.com')).toBe(false);
    expect(isSuperControlSender('nadine@fosterlabs.dev')).toBe(false);
    expect(isSuperControlSender('someone@secure-booking-email.net')).toBe(false);
    expect(isSuperControlSender('')).toBe(false);
    expect(isSuperControlSender(null)).toBe(false);
    expect(isSuperControlSender(undefined)).toBe(false);
  });
});
