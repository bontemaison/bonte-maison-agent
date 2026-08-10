import { sendIncoming } from '../helpers/send-message';
import { lastOutboundText } from '../helpers/assertions';
import { buildHarness, CUSTOMER, Harness } from '../helpers/test-app';

const FORBIDDEN_WHEN_REJECTING = ['sold', 'taken', 'unavailable'];
const HALLUCINATIONS = ['sauna', 'gym', 'air conditioning', ' AC ', 'jacuzzi', 'hot tub'];

/**
 * Tone/voice checks. These run against the Airtable-seeded template copy,
 * since the composer is stubbed out in e2e. To extend coverage, swap the seed
 * in fixtures/seed.ts to include realistic Jim copy per template.
 *
 * The generic seed used here writes "[key] reply" — the assertions below
 * still catch infra regressions and any future seed that introduces bad
 * vocabulary.
 */
describe('Scenario 17 — Tone & voice spot-checks', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness();
  });

  afterEach(async () => {
    await h.shutdown();
  });

  it('availability_no_handoff text never says "sold" or "taken"', async () => {
    h.availability.block(new Date('2027-08-01'), new Date('2027-08-31'));
    await sendIncoming(h, '8-15 Aug 2027', {
      parse: {
        intent: 'availability_inquiry',
        confidence: 0.95,
        checkIn: new Date('2027-08-08'),
        checkOut: new Date('2027-08-15'),
      },
    });
    const text = lastOutboundText(h, CUSTOMER).toLowerCase();
    for (const word of FORBIDDEN_WHEN_REJECTING) {
      // Permitted only as part of "unavailable_subject_to_confirmation" template name
      if (text.includes(word)) {
        // soft-warn unless template seeded with forbidden word
        expect(text).not.toContain(word);
      }
    }
  });

  it('quote text never hallucinates amenities not in the KB', async () => {
    await sendIncoming(h, '11-18 July 2027', {
      parse: {
        intent: 'availability_inquiry',
        confidence: 0.95,
        checkIn: new Date('2027-07-11'),
        checkOut: new Date('2027-07-18'),
      },
    });
    const text = lastOutboundText(h, CUSTOMER).toLowerCase();
    for (const fake of HALLUCINATIONS) {
      expect(text).not.toContain(fake.toLowerCase());
    }
  });

  it('outbound replies are within sane length bounds', async () => {
    await sendIncoming(h, 'Hi', {
      parse: { intent: 'greeting', confidence: 0.95 },
    });
    const text = lastOutboundText(h, CUSTOMER);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(2000);
  });

  it('does not proactively offer a discount in normal availability flow', async () => {
    await sendIncoming(h, '11-18 July 2027', {
      parse: {
        intent: 'availability_inquiry',
        confidence: 0.95,
        checkIn: new Date('2027-07-11'),
        checkOut: new Date('2027-07-18'),
      },
    });
    const text = lastOutboundText(h, CUSTOMER).toLowerCase();
    expect(text).not.toMatch(/\bdiscount\b/);
    expect(text).not.toMatch(/\boffer\s+you\s+a\s+\d/);
  });
});
