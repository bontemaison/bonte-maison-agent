/**
 * Per-row expectations for the feedback regression script.
 *
 * Each row corresponds to a customer message in `.claude/feedbacks/feedback-1.csv`,
 * matched by exact text. For each, we list:
 *   - mustInclude:    regexes the bot reply MUST match (premium-tone signals,
 *                     correct facts, expected next steps)
 *   - mustNotInclude: regexes the bot reply MUST NOT match (known bugs from the
 *                     audited reply column)
 *   - notes:          short human-readable rationale linking back to the
 *                     "Rule Application / Agent Logic" column from the CSV
 *
 * Keep regexes pragmatic, not poetic — a passing reply is one free of the
 * concrete defects we already identified, not one that perfectly matches the
 * recommended copy.
 */

export type Criterion = {
  customerMessage: string;
  mustInclude?: RegExp[];
  mustNotInclude?: RegExp[];
  notes: string;
};

export const FEEDBACK_CRITERIA: Criterion[] = [
  {
    customerMessage: 'Hi when is the villa available',
    mustInclude: [/sunday/i, /www\.bontemaison\.com/i],
    mustNotInclude: [/saturday to saturday/i, /saturday changeover/i],
    notes:
      'Open availability: must mention Sunday changeover (not Saturday), include website link.',
  },
  {
    customerMessage: 'Thinking of August',
    mustInclude: [/august/i, /www\.bontemaison\.com/i, /2027/],
    mustNotInclude: [/€/],
    notes: 'August enquiry: high-demand framing, redirect to 2027, £ not €.',
  },
  {
    customerMessage: 'Ok',
    mustInclude: [/www\.bontemaison\.com/i],
    mustNotInclude: [/€/],
    notes: 'Low-intent ack: keep door open, include website softly.',
  },
  {
    customerMessage: 'Week starting the 8th aug',
    mustInclude: [/reserved/i, /priority/i, /bontemaison\.com\/priority/i],
    mustNotInclude: [
      /€/,
      /^\s*That week is already reserved\.?\s*Many thanks/i,
      /exclusive use of the villa/i,
    ],
    notes:
      'Specific unavailable week (Jim 2026-05): give priority-list link, no auto-alternative, no "exclusive use of the villa".',
  },
  {
    customerMessage: 'Ok when is free ?',
    mustInclude: [/£\s?3,?995/i, /29 (august|aug)|aug.*29/i, /www\.bontemaison\.com/i],
    mustNotInclude: [/€/],
    notes:
      'What is free: give exact remaining option (29 Aug week) with £ pricing.',
  },
  {
    customerMessage: 'Anything in July ?',
    mustInclude: [/£\s?4,?995/i, /july|jul/i, /www\.bontemaison\.com/i],
    mustNotInclude: [/€/, /£\s?3,?995/i],
    notes:
      'July weeks: all high summer at £4,995. Bug: 11-Jul was previously priced at £3,995.',
  },
  {
    customerMessage: 'How many can it sleep',
    mustInclude: [/sleeps? 10|ten guests/i, /five bedrooms?|5 bedrooms?/i, /www\.bontemaison\.com/i],
    notes: 'Capacity: 10 across 5 bedrooms, add layout/family framing, website.',
  },
  {
    customerMessage: 'Ok is the pool heated ?',
    mustInclude: [
      /(not heated|isn'?t heated|naturally (warm|heated))/i,
      /hot tubs?/i,
      /www\.bontemaison\.com/i,
    ],
    notes: 'Pool: answer honestly, mention two hot tubs as positive reframe.',
  },
  {
    customerMessage: 'Is there air conditioning',
    mustInclude: [/(no air|isn'?t air|don'?t have air|no a\/c)/i, /(shutters|thick walls|fans)/i],
    mustNotInclude: [
      /come back to you/i,
      /let me check/i,
      /don'?t have the answer/i,
    ],
    notes:
      'AC: must answer confidently from KB. Bug: bot said "I will check and come back".',
  },
  {
    customerMessage: 'Ok how can I book ?',
    mustInclude: [/www\.bontemaison\.com/i, /booking|book online/i, /25\s?%|deposit/i],
    mustNotInclude: [/^.{0,200}(share your email|drop me your email)/is],
    notes:
      'How to book: send to website + 25% deposit + 8wk balance. Do not lead with "share your email".',
  },
  {
    customerMessage: 'What’s the deposit ?',
    mustInclude: [/25\s?%/, /8 weeks|eight weeks/i],
    mustNotInclude: [/already reserved/i, /fully booked/i, /2026/],
    notes:
      'Deposit terms: must answer the question. Bug: bot replied "those dates are already reserved".',
  },
  {
    customerMessage: 'I’ll take the last week of July',
    mustInclude: [/july|jul/i, /(hold|deposit|£\s?4,?995|booking)/i],
    mustNotInclude: [/€/, /^.{0,200}(share your email|drop me your email)/is],
    notes:
      'Buying signal: confirm momentum, give price + deposit + hold. Do not just ask for email.',
  },
  {
    customerMessage: 'Ok can you tell me the deposit needed please ?',
    mustInclude: [/25\s?%/, /8 weeks|eight weeks/i],
    mustNotInclude: [/already reserved/i, /fully booked/i, /2026/],
    notes:
      'Deposit follow-up: must answer. Bug: bot replied "2026 is now fully reserved".',
  },
  {
    customerMessage: 'How close to the nearest restaurant',
    mustInclude: [/duras|eymet|bergerac/i, /www\.bontemaison\.com/i],
    mustNotInclude: [/don'?t have/i, /can'?t answer/i],
    notes:
      'Restaurants: name nearby towns/places, no vague "short drive" only.',
  },
  {
    customerMessage: 'What week would you recommend in June 2027 ?',
    mustInclude: [/june/i, /www\.bontemaison\.com/i, /hold/i],
    mustNotInclude: [/facebook\.com/i],
    notes: 'June recommendation: consultative, offer hold. No Facebook link.',
  },
  {
    customerMessage: 'Can I have a discount?',
    mustInclude: [/(don'?t|do not) (usually )?(reduce|discount|offer)|exclusive use/i],
    mustNotInclude: [/let me check/i, /come back to you/i],
    notes:
      'Discount: direct, no-emotional decline. Value anchor + multi-week saving.',
  },
  {
    customerMessage: 'Hi can you tell me about the Villa?',
    mustInclude: [
      /sleeps? 10|ten guests|five bedrooms?/i,
      /pool/i,
      /hot tubs?/i,
      /www\.bontemaison\.com/i,
    ],
    notes:
      'Property overview: capacity + pool/hot tubs + website. Premium summary.',
  },
  {
    customerMessage: 'What weeks are available this year ?',
    mustInclude: [/2026/i, /fully booked|fully reserved/i, /2027/, /www\.bontemaison\.com/i],
    notes:
      'This-year availability: state 2026 fully booked, redirect to 2027, website.',
  },
  {
    customerMessage: 'Ok is Aug 27 free?',
    mustInclude: [/29 (august|aug)|aug.*29/i, /£\s?3,?995/i, /www\.bontemaison\.com/i],
    mustNotInclude: [/€/],
    notes: 'August 2027 specific: 29 Aug week at £3,995. £ not €.',
  },
  {
    customerMessage: 'Anything in July ?',
    mustInclude: [/£\s?4,?995/i, /www\.bontemaison\.com/i],
    mustNotInclude: [/€/, /£\s?3,?995/i],
    notes:
      'Second July ask: all weeks £4,995. Same pricing-band bug as row 6.',
  },
  {
    customerMessage: 'Ok cool that sounds nice',
    mustInclude: [/hold/i],
    notes: 'Warm lead: move from positive signal to hold offer.',
  },
  {
    customerMessage: 'How can I book it',
    mustInclude: [/www\.bontemaison\.com/i, /booking|book online/i, /25\s?%|deposit/i],
    notes:
      'How to book (2nd phrasing): website + deposit + hold + offer to help.',
  },
  {
    customerMessage: 'What about bike hire ?',
    mustInclude: [/(cycling|bike|cycl|cycle)/i],
    mustNotInclude: [/facebook\.com/i, /don'?t have details/i, /don'?t have the info/i],
    notes:
      'Bike hire: answer confidently. Bug: bot said "don\'t have details" + facebook link.',
  },
];
