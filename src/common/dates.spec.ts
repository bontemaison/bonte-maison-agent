import {
  addDays,
  floatingDateToUtc,
  formatIsoDate,
  nextSunday,
  parseIsoDate,
  startOfUtcDay,
} from './dates';

describe('dates', () => {
  describe('floatingDateToUtc', () => {
    it('re-anchors a floating local-midnight date to UTC midnight', () => {
      // How node-ical resolves `20270509T000000` — local midnight, whatever
      // the server zone is.
      const parsed = new Date(2027, 4, 9, 0, 0, 0);
      expect(floatingDateToUtc(parsed).toISOString()).toBe(
        '2027-05-09T00:00:00.000Z',
      );
    });

    it('preserves the calendar day regardless of server timezone', () => {
      // Whatever TZ this suite runs under, local-midnight 9 May must stay 9 May.
      // Run the suite under TZ=Asia/Jakarta / TZ=America/Los_Angeles to prove it.
      const parsed = new Date(2027, 4, 9, 0, 0, 0);
      expect(formatIsoDate(floatingDateToUtc(parsed))).toBe('2027-05-09');
    });
  });

  describe('parseIsoDate', () => {
    it('parses a plain calendar date as UTC midnight', () => {
      expect(parseIsoDate('2027-05-02').toISOString()).toBe(
        '2027-05-02T00:00:00.000Z',
      );
    });

    it('tolerates a full ISO timestamp by taking the date portion', () => {
      expect(parseIsoDate('2027-05-02T13:45:00.000Z').toISOString()).toBe(
        '2027-05-02T00:00:00.000Z',
      );
    });

    it('throws on a malformed value', () => {
      expect(() => parseIsoDate('2 May 2027')).toThrow('Invalid ISO date');
    });
  });

  describe('startOfUtcDay', () => {
    it('truncates the time portion', () => {
      expect(
        startOfUtcDay(new Date('2027-05-02T18:30:00.000Z')).toISOString(),
      ).toBe('2027-05-02T00:00:00.000Z');
    });
  });

  describe('nextSunday', () => {
    it('returns the same day when already Sunday', () => {
      expect(formatIsoDate(nextSunday(parseIsoDate('2027-05-02')))).toBe(
        '2027-05-02',
      );
    });

    it('advances to the following Sunday otherwise', () => {
      // 2027-05-04 is a Tuesday.
      expect(formatIsoDate(nextSunday(parseIsoDate('2027-05-04')))).toBe(
        '2027-05-09',
      );
    });

    it('truncates any time portion', () => {
      expect(
        nextSunday(new Date('2027-05-02T18:30:00.000Z')).toISOString(),
      ).toBe('2027-05-02T00:00:00.000Z');
    });
  });

  describe('addDays', () => {
    it('adds whole days', () => {
      expect(formatIsoDate(addDays(parseIsoDate('2027-05-02'), 7))).toBe(
        '2027-05-09',
      );
    });
  });
});
