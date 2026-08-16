import { formatE164, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('promotes a national UK number to country-code form', () => {
    expect(normalizePhone('07901857452')).toBe('447901857452');
  });

  it('accepts an already-E.164 number and drops the plus', () => {
    expect(normalizePhone('+447901857452')).toBe('447901857452');
  });

  it('accepts the 00 international prefix', () => {
    expect(normalizePhone('00447901857452')).toBe('447901857452');
  });

  it('passes through a bare country-coded number unchanged', () => {
    expect(normalizePhone('447901857452')).toBe('447901857452');
  });

  it('ignores spaces, hyphens and parentheses', () => {
    expect(normalizePhone('07901 857 452')).toBe('447901857452');
    expect(normalizePhone('(0)7901-857452')).toBe('447901857452');
  });

  // Jim signs his booking emails "+44 (0)7435 301 371". The (0) is a national
  // trunk prefix that is NOT dialled once +44 is present — keeping it would
  // produce 4407435301371 and never match his real number.
  it('drops the national trunk prefix after an explicit country code', () => {
    expect(normalizePhone('+44 (0)7435 301 371')).toBe('447435301371');
    expect(normalizePhone('0044 (0)7435 301 371')).toBe('447435301371');
  });

  it('leaves non-UK numbers alone', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
  });

  it('honours a different default country code', () => {
    expect(normalizePhone('07901857452', '33')).toBe('337901857452');
  });

  it('returns null for anything that is not a usable number', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('no digits here')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('+4479018574521234567890')).toBeNull();
    expect(normalizePhone(undefined as unknown as string)).toBeNull();
  });
});

describe('formatE164', () => {
  it('adds the plus back for display', () => {
    expect(formatE164('447901857452')).toBe('+447901857452');
  });

  it('is idempotent', () => {
    expect(formatE164('+447901857452')).toBe('+447901857452');
  });
});
