/**
 * Seed/update Templates table in Airtable.
 *
 * Usage:
 *   npm run seed:templates
 *
 * Idempotent: upserts by (key, variant). Edit TEMPLATES below and re-run.
 */
import Airtable from 'airtable';

type TemplateRow = {
  key: string;
  variant: number;
  text: string;
};

const TEMPLATES: TemplateRow[] = [
  // ── 1. ENQUIRY FLOW ──────────────────────────────────────────────────

  // greeting_ask_dates
  {
    key: 'greeting_ask_dates',
    variant: 1,
    text: `Hi! How can I help?\n\nMany thanks`,
  },
  {
    key: 'greeting_ask_dates',
    variant: 2,
    text: `Hello! What can I help you with?\n\nMany thanks`,
  },
  {
    key: 'greeting_ask_dates',
    variant: 3,
    text: `Hi! How can I help?\n\nMany thanks`,
  },

  // dates_unclear_ask_clarify
  {
    key: 'dates_unclear_ask_clarify',
    variant: 1,
    text: `Thanks, just to make sure I quote the right week, could you share the specific dates? For example: "9th to 16th August".\n\nWe run Sunday to Sunday, so any week in that window should work well. Once I have the exact dates I'll come back with availability and pricing.\n\nMany thanks`,
  },
  {
    key: 'dates_unclear_ask_clarify',
    variant: 2,
    text: `To make sure I check the right dates, could you let me know the exact Sunday you'd arrive and Sunday you'd leave?\n\nMany thanks`,
  },
  {
    key: 'dates_unclear_ask_clarify',
    variant: 3,
    text: `Thank you, could you confirm the exact dates you have in mind? The house runs Sunday to Sunday, so something like "12th to 19th July" is perfect.\n\nMany thanks`,
  },

  // dates_not_sunday_to_sunday
  {
    key: 'dates_not_sunday_to_sunday',
    variant: 1,
    text: `Thanks for those dates.\n\nThe house runs on Sunday changeovers, so the closest Sunday-to-Sunday week to what you're looking at would be {suggested_check_in} to {suggested_check_out}.\n\nWould that work for you? Happy to check availability if so.\n\nMany thanks`,
  },
  {
    key: 'dates_not_sunday_to_sunday',
    variant: 2,
    text: `Thank you, one thing to mention, Bonté Maison is let Sunday to Sunday only.\n\nBased on your preferred dates, the nearest option would be {suggested_check_in} to {suggested_check_out}. Let me know if that works and I'll check availability.\n\nMany thanks`,
  },
  {
    key: 'dates_not_sunday_to_sunday',
    variant: 3,
    text: `Just a quick note, the house runs on Sunday changeovers, so stays are Sunday to Sunday.\n\nWould {suggested_check_in} to {suggested_check_out} work for you? If so, I'll come back with availability.\n\nMany thanks`,
  },

  // minimum_stay_not_met
  {
    key: 'minimum_stay_not_met',
    variant: 1,
    text: `Thanks for reaching out.\n\nThe house has a 7-night minimum stay, Sunday to Sunday. If you can stretch to {suggested_check_out} that would give you a full week, and honestly, most guests say a week flies by.\n\nLet me know and I'll check availability.\n\nMany thanks`,
  },
  {
    key: 'minimum_stay_not_met',
    variant: 2,
    text: `Thank you, bookings here are in one-week blocks (Sunday to Sunday), so the minimum would be {suggested_check_in} to {suggested_check_out}.\n\nIf that works, I'll check availability for you.\n\nMany thanks`,
  },

  // ── 2. AVAILABILITY & QUOTING ─────────────────────────────────────────

  // availability_yes_quote
  // Structure (per Jim, 2026-05): anchor → offer + Sunday changeover → desire → action (tell, don't ask) with link.
  {
    key: 'availability_yes_quote',
    variant: 1,
    text: `Lovely, that's a great week to be here.\n\n{check_in} to {check_out} is available, {nights} nights at {price}. Sunday is changeover day, it makes the journey through France much easier.\n\nA brilliant time of year, long evenings, everything open and a real atmosphere locally.\n\nI can hold the dates for you while you decide, no rush at all, or take care of the booking, just say the word. Or book direct here: www.bontemaison.com\n\nMany thanks`,
  },
  {
    key: 'availability_yes_quote',
    variant: 2,
    text: `That's a fabulous week to come down.\n\n{check_in} to {check_out} is free, {nights} nights at {price}. Sunday changeover, it works much better for travel through France.\n\nThe house really comes into its own that time of year, warm evenings, vineyards busy, plenty going on locally.\n\nHappy to pencil those dates in for you while you have a think, or sort the booking out, just say the word. Direct booking is here too: www.bontemaison.com\n\nMany thanks`,
  },
  {
    key: 'availability_yes_quote',
    variant: 3,
    text: `Lovely choice of dates.\n\n{check_in} to {check_out} is available, {nights} nights at {price}. Sunday is the changeover, makes travel through France much smoother.\n\nA great time to relax and explore, markets, vineyards, long days outside.\n\nI'll hold the week for you while you decide, no rush, or take care of the booking, just say the word. Or book direct here: www.bontemaison.com\n\nMany thanks`,
  },
  {
    key: 'availability_yes_quote',
    variant: 4,
    text: `That's a great week to be here.\n\nThe villa is free from {check_in} to {check_out}, {nights} nights at {price}. Sunday changeover day, the journey through France runs much smoother that way.\n\nA real atmosphere here at that time, vineyards, markets, evenings outside.\n\nI can hold the dates for you while you have a think, or sort the booking out, just say the word. Direct booking link: www.bontemaison.com\n\nMany thanks`,
  },

  // september_wine_harvest_note (inserted before the sign-off when stay touches September)
  {
    key: 'september_wine_harvest_note',
    variant: 1,
    text: `That's right in the middle of the wine harvest too, vineyards busy, local food and wine events, usually still hot and sunny.`,
  },
  {
    key: 'september_wine_harvest_note',
    variant: 2,
    text: `Worth mentioning, September is wine harvest season here, so the whole area comes alive with tastings, markets and vineyard events.`,
  },

  // availability_no_priority — week is reserved. Offer priority list (Typeform) and
  // invite the guest to share flexibility. We deliberately don't volunteer a specific
  // alternative upfront; if they have flexibility they'll come back and ask.
  // Jim's exact tone, 2026-05.
  // {name_comma} is either ", Sarah" or "" so we don't get "Hi ," when name unknown.
  {
    key: 'availability_no_priority',
    variant: 1,
    text: `Hi{name_comma}, thanks for your message.\n\n{check_in} to {check_out} is already reserved I'm afraid, it's one of the most popular times and tends to be secured well in advance.\n\nWhat I can do is give you first priority if anything changes. We do occasionally have cancellations, and I'll let you know straight away before it's offered more widely.\n\nIf you'd like to be included, you can register your details here:\nwww.bontemaison.com/priority\n\nAnd if you have any flexibility on dates, I'd be very happy to suggest the closest options that are currently available.\n\nMany thanks`,
  },
  {
    key: 'availability_no_priority',
    variant: 2,
    text: `Thanks for getting in touch.\n\nThat particular week is already reserved I'm afraid, {month} tends to book up early.\n\nWhat I can do is keep you first in line if anything changes. We do occasionally see cancellations, and I'll let you know straight away before the week goes back out more widely.\n\nIf you'd like to be added, register your details here:\nwww.bontemaison.com/priority\n\nIf you have any flexibility on dates, I'd be very happy to share what's still open close to your week.\n\nMany thanks`,
  },

  // availability_no_handoff — legacy key, kept for backward compat with any
  // direct references. Routes the same priority-list reply as v1 above.
  {
    key: 'availability_no_handoff',
    variant: 1,
    text: `Hi{name_comma}, thanks for your message.\n\n{check_in} to {check_out} is already reserved I'm afraid, it's one of the most popular times and tends to be secured well in advance.\n\nWhat I can do is give you first priority if anything changes. We do occasionally have cancellations, and I'll let you know straight away before it's offered more widely.\n\nIf you'd like to be included, you can register your details here:\nwww.bontemaison.com/priority\n\nAnd if you have any flexibility on dates, I'd be very happy to suggest the closest options that are currently available.\n\nMany thanks`,
  },

  // availability_subject_to_confirmation
  {
    key: 'availability_subject_to_confirmation',
    variant: 1,
    text: `Those dates look available based on what I'm seeing, though it's subject to final confirmation.\n\nI'll double-check and come back to you shortly.\n\nMany thanks`,
  },

  // availability_pending_pricing — the week is free on the calendar but falls in
  // a future period Jim hasn't set rates for yet (only the base rate matched).
  // Never quote the base rate as firm; confirm it's open and that the rate will
  // follow. {year} is the check-in year. Jim is notified in parallel.
  {
    key: 'availability_pending_pricing',
    variant: 1,
    text: `That week looks open at the moment, {check_in} to {check_out}.\n\nWe haven't finalised our {year} rates just yet, so let me confirm the exact price for you and come straight back.\n\nHappy to note your interest in the meantime, just say the word.\n\nMany thanks`,
  },
  {
    key: 'availability_pending_pricing',
    variant: 2,
    text: `Good news, {check_in} to {check_out} looks open.\n\nOur {year} pricing isn't quite settled yet, so I'll confirm the exact rate and come straight back to you.\n\nIn the meantime I'm very happy to note your interest, just let me know.\n\nMany thanks`,
  },

  // ── 3. HOLD FLOW ──────────────────────────────────────────────────────

  // hold_offer_post_quote (usually bundled into availability_yes_quote)
  {
    key: 'hold_offer_post_quote',
    variant: 1,
    text: `If it helps, I can hold those dates for you for 5 days while you decide. Just let me know.`,
  },
  {
    key: 'hold_offer_post_quote',
    variant: 2,
    text: `I'm very happy to pencil those dates in for you for 5 days while you have a think, just say the word.`,
  },

  // hold_confirmed
  {
    key: 'hold_confirmed',
    variant: 1,
    text: `Lovely, I've held {check_in} to {check_out} for you.\n\nThose dates are yours until {hold_expiry} (5 days from today). I'll drop you a gentle reminder before then.\n\nIf you'd like to confirm sooner, just let me know.\n\nMany thanks`,
  },
  {
    key: 'hold_confirmed',
    variant: 2,
    text: `That's great, I've pencilled in {check_in} to {check_out} for you.\n\nThey'll stay held until {hold_expiry}. No rush, I'll check in with you before then.\n\nMany thanks`,
  },
  {
    key: 'hold_confirmed',
    variant: 3,
    text: `Perfect, dates held. {check_in} to {check_out} are yours until {hold_expiry}.\n\nI'll send a quick reminder the day before if I haven't heard back. If you have any questions in the meantime, just ask.\n\nMany thanks`,
  },

  // hold_reminder (sent on day 4 of hold)
  {
    key: 'hold_reminder',
    variant: 1,
    text: `Just a quick note, the hold on {check_in} to {check_out} expires tomorrow.\n\nIf you'd still like the week, just let me know and I'll help you through the next step. If plans have changed, no problem at all, let me know and I'll release the dates.\n\nMany thanks`,
  },
  {
    key: 'hold_reminder',
    variant: 2,
    text: `Just checking in, your dates ({check_in} to {check_out}) are held until tomorrow.\n\nHappy to help you confirm, or if you're still thinking let me know and I can extend or release.\n\nMany thanks`,
  },

  // hold_expired (auto-sent when hold expires without reply)
  {
    key: 'hold_expired',
    variant: 1,
    text: `Just to let you know I've released the hold on {check_in} to {check_out} as I hadn't heard back.\n\nNo problem at all, if you'd still like to book or have a look at other dates, just let me know and I'll help.\n\nMany thanks`,
  },
  {
    key: 'hold_expired',
    variant: 2,
    text: `Quick note, the hold on your dates has now expired and I've released them.\n\nCompletely understand plans can change. If you'd like to look at anything else, do give me a shout.\n\nMany thanks`,
  },

  // ── 4. BOOKING CONFIRMATION ───────────────────────────────────────────

  // booking_confirmed_handoff (manual email flow — current)
  {
    key: 'booking_confirmed_handoff',
    variant: 1,
    text: `That's wonderful, delighted you'd like to go ahead.\n\nThe easiest way is to book directly online at www.bontemaison.com — select Booking from the menu and the system will guide you through everything, including the 25% deposit to secure the dates. The balance is due 8 weeks before arrival.\n\nI can hold the week for a short time while you complete the booking, and I'm very happy to handle it for you directly or jump on a quick call if that would help.\n\nMany thanks`,
  },
  {
    key: 'booking_confirmed_handoff',
    variant: 2,
    text: `Lovely to hear.\n\nYou're very welcome to book directly online at www.bontemaison.com — just select Booking from the menu. A 25% deposit secures your dates, with the balance due 8 weeks before arrival. All major cards accepted.\n\nI can hold the week briefly while you finalise plans, or handle the booking for you — just say the word.\n\nMany thanks`,
  },
  {
    key: 'booking_confirmed_handoff',
    variant: 3,
    text: `That's great to hear.\n\nYou can book directly at www.bontemaison.com by selecting Booking from the menu — the 25% deposit secures the dates and the balance is due 8 weeks before arrival. Cards accepted in £ or €.\n\nI'm happy to hold the week for a short time while you complete the booking, or take care of it for you if easier.\n\nMany thanks`,
  },

  // booking_email_received_handoff (sent when the customer provides their email)
  {
    key: 'booking_email_received_handoff',
    variant: 1,
    text: `Got it, thanks. I'll send the booking details over to {email} shortly.\n\nMany thanks`,
  },
  {
    key: 'booking_email_received_handoff',
    variant: 2,
    text: `Thanks, your email is noted. The booking details will be on their way shortly.\n\nMany thanks`,
  },

  // booking_confirmed_instant_book (used once BookingRules.instant_book_enabled=true)
  // NOTE: website URL kept — it's the operational point of this scenario.
  {
    key: 'booking_confirmed_instant_book',
    variant: 1,
    text: `That's great, delighted you'd like to book.\n\nThe quickest way is to use the website below, where you can confirm everything and secure the dates instantly. All cards accepted, secure 3D payment.\n\nwww.bontemaison.com\n\nOnce booked, everything is confirmed straight away and you'll receive full details by email.\n\nMany thanks`,
  },
  {
    key: 'booking_confirmed_instant_book',
    variant: 2,
    text: `Thank you, lovely to hear.\n\nYou can book directly on the website, it only takes a moment and everything is confirmed instantly: www.bontemaison.com\n\nYou'll get full details through by email straight after. Any questions, just shout.\n\nMany thanks`,
  },

  // ── 5. FAQ HANDOFF ────────────────────────────────────────────────────
  // Property-fact FAQs (pool, sleeps, car, etc.) now live in the
  // KnowledgeBase table — see scripts/seed-knowledge-base.ts

  {
    key: 'faq_unknown_handoff',
    variant: 1,
    text: `Good question, let me check on that and get back to you shortly.\n\nMany thanks`,
  },
  {
    key: 'faq_unknown_handoff',
    variant: 2,
    text: `Thanks, I'll come back to you on that one shortly so I can give you the right answer.\n\nMany thanks`,
  },
  {
    key: 'faq_unknown_handoff',
    variant: 3,
    text: `Let me check with Jim on that, he'll reply here soon.\n\nMany thanks`,
  },

  // ── 6. SPECIAL CASES ──────────────────────────────────────────────────

  // year_2026_redirect — {month_phrase} is either "" or " for June" (orchestrator provides leading space, no trailing comma)
  {
    key: 'year_2026_redirect',
    variant: 1,
    text: `Thanks for getting in touch.\n\n2026 is fully booked{month_phrase} I'm afraid, it went very quickly this year. I do have some lovely weeks still available in 2027 if you'd like to look at dates there.\n\nMany thanks`,
  },
  {
    key: 'year_2026_redirect',
    variant: 2,
    text: `Thank you for your message.\n\n2026 is now fully reserved{month_phrase}. We are taking bookings for 2027 and some of the most popular summer weeks are already going. If you have a rough month or week in mind, I'll send the best remaining options.\n\nMany thanks`,
  },

  // long_stay_manual_pricing
  {
    key: 'long_stay_manual_pricing',
    variant: 1,
    text: `Thanks for your enquiry.\n\nFor longer stays in the autumn and winter months (October through May), the pricing is done a bit differently, I'll put something together for you personally and come back shortly with a quote.\n\nMany thanks`,
  },
  {
    key: 'long_stay_manual_pricing',
    variant: 2,
    text: `Thank you for getting in touch.\n\nLonger stays between October and May are something I price individually. Leave it with me and I'll come back to you shortly with options.\n\nMany thanks`,
  },

  // discount_request — in-line decline, no "come back to you"
  {
    key: 'discount_request',
    variant: 1,
    text: `Thank you for asking.\n\nWe don't usually reduce individual peak-week rates, as the most popular dates tend to book well in advance and the rate reflects exclusive use of the full villa — pool, two hot tubs, outdoor dining, cleaning, linen, towels and the welcome pack.\n\nFor longer stays of two weeks or more, I'm sometimes able to reflect the saving from one less changeover. I'll look into the best option for you and come back to you personally.\n\nMany thanks`,
  },
  {
    key: 'discount_request',
    variant: 2,
    text: `Thanks for asking.\n\nWe don't usually discount individual weeks — Bonté is reserved exclusively for one group and the most sought-after dates tend to go well in advance. For stays of two weeks or more I can sometimes build in a small saving, as there's one less changeover.\n\nLeave it with me and I'll come back to you personally with the best option.\n\nMany thanks`,
  },

  // group_size_confirmation
  {
    key: 'group_size_confirmation',
    variant: 1,
    text: `Yes, that works very well. The house comfortably sleeps 10 across 5 bedrooms, and we can accommodate an 11th guest if it's a child using a good quality fold-out bed.\n\nThere's plenty of space both inside and outside, so it works really nicely for groups.\n\nIf you'd like to share your dates, I can check availability for you.\n\nMany thanks`,
  },

  // ── 7. FOLLOW-UP SEQUENCE ─────────────────────────────────────────────

  {
    key: 'followup_24h',
    variant: 1,
    text: `Just a quick note as I know plans can take a bit of coordinating.\n\nThose dates are still available at the moment. If it helps, I'm very happy to pencil them in for you while you have a think.\n\nHappy to help if you have any questions at all.\n\nMany thanks`,
  },

  // date_reconfirmation_check — Jim 2026-05: prompted customer to confirm they're
  // still interested in their previously-requested dates after a few days of silence.
  {
    key: 'date_reconfirmation_check',
    variant: 1,
    text: `Hi{name_comma}, just checking back in.\n\nAre you still looking at {check_in} to {check_out}? Happy to re-check availability if so, or if dates have shifted let me know your new preference and I'll come back to you.\n\nMany thanks`,
  },
  {
    key: 'date_reconfirmation_check',
    variant: 2,
    text: `Just a quick note{name_comma}.\n\nLast time we spoke you were looking at {check_in} to {check_out}. Are you still considering those dates? If so I'll re-check availability, or if you've shifted, just let me know the new week.\n\nMany thanks`,
  },
  {
    key: 'followup_7d',
    variant: 1,
    text: `Just a final note from me.\n\nTotally understand if plans have changed, but if you're still thinking about a stay, I'd be very happy to help or suggest alternatives.\n\nHappy to help in any way.\n\nMany thanks`,
  },

  // ── 8. SUPERCONTROL EMAIL NUDGES ──────────────────────────────────────
  // NOTE: in-body URLs (arrival-details, useful-guide, tourism page) are
  // functional content, not decorative sign-offs — kept intentionally.

  {
    key: 'nudge_booking_confirmation',
    variant: 1,
    text: `I've just sent over your booking confirmation by email with all the details for your stay.\n\nIf you could have a quick look and let me know everything is in order, that would be great.\n\nReally looking forward to welcoming you to Bonté Maison, I'm sure you'll have an amazing time.\n\nMany thanks`,
  },
  {
    key: 'nudge_directions',
    variant: 1,
    text: `I've just sent you an email with full directions and arrival details for Bonté Maison.\n\nIt should have everything you need for a smooth arrival, but if anything isn't clear just let me know.\n\nThere's more information here:\n- https://bontemaison.com/arrival-details\n- https://bontemaison.com/useful-guide\n\nI'll drop you another message with a reminder just before your holiday.\n\nMany thanks`,
  },
  {
    key: 'nudge_pre_arrival',
    variant: 1,
    text: `Just a quick note ahead of your stay, I've sent a short email with arrival details and a few useful bits for the week.\n\nThe house will be ready for you from 4pm on Sunday.\n\nMost people arrive, settle in and end up outside with a drink on that first evening, it's a great way to start the week.\n\nThere'll be a welcome pack for you at the house, all detailed here:\nhttps://bontemaison.com/arrival-details\n\nSunday afternoon is very quiet in France and most shops are closed, so worth taking a few things with you if you can. Towels, pool towels and bedding are all provided.\n\nIf you need anything before you arrive, just let me know.\n\nMany thanks`,
  },
  {
    key: 'nudge_mid_stay',
    variant: 1,
    text: `Just checking in to make sure everything is perfect for you at the house.\n\nHopefully you've had a chance to settle in and enjoy it properly. There's plenty going on in the area, the local markets, vineyards and night markets are all great in the evenings.\n\nIf you need anything at all during your stay, please let me know.\n\nEnjoy the rest of your week.\n\nMany thanks`,
  },
  {
    key: 'nudge_thank_you',
    variant: 1,
    text: `I've just sent you a quick email to say thank you following your stay.\n\nIt was a pleasure having you at Bonté Maison and I hope you had a really special week.\n\nYou'd be very welcome back anytime.\n\nMany thanks`,
  },
  {
    key: 'nudge_review_request',
    variant: 1,
    text: `I've just sent a short email with a quick review link, I'd really appreciate it if you had a moment to take a look.\n\nIt makes a big difference for a small business like ours.\n\nThanks again, and hopefully we'll see you back at Bonté Maison in the future.\n\nMany thanks`,
  },

  // ── 9. ESCALATION & HANDOFF ───────────────────────────────────────────

  {
    key: 'human_request_handoff',
    variant: 1,
    text: `Of course, I'll pass this straight to Jim and he'll come back to you shortly.\n\nMany thanks`,
  },
  {
    key: 'human_request_handoff',
    variant: 2,
    text: `No problem at all, Jim will be in touch with you shortly.\n\nMany thanks`,
  },
  {
    key: 'human_request_handoff',
    variant: 3,
    text: `Got it, Jim will take over from here.\n\nMany thanks`,
  },
  {
    key: 'complaint_handoff',
    variant: 1,
    text: `I'm sorry to hear that, Jim will reach out to you personally as soon as possible.\n\nMany thanks`,
  },
  {
    key: 'complaint_handoff',
    variant: 2,
    text: `Really sorry about this. I'm flagging this to Jim now so he can be in touch with you personally.\n\nMany thanks`,
  },
  {
    key: 'complaint_handoff',
    variant: 3,
    text: `Sorry about that. Passing this to Jim straight away.\n\nMany thanks`,
  },
  {
    key: 'acknowledgment_reply',
    variant: 1,
    text: `Thanks, let me know if anything else comes up.`,
  },
  {
    key: 'acknowledgment_reply',
    variant: 2,
    text: `Thanks — happy to help if anything else comes to mind.`,
  },
  {
    key: 'acknowledgment_reply',
    variant: 3,
    text: `Thanks. Just shout if you need anything else.`,
  },
  {
    key: 'unclear_handoff',
    variant: 1,
    text: `Sorry for the misunderstanding. Could you clarify your question again?\n\nMany thanks`,
  },
  {
    key: 'unclear_handoff',
    variant: 2,
    text: `Apologies if I misread that. Could you rephrase what you'd like to know?\n\nMany thanks`,
  },
  {
    key: 'unclear_handoff',
    variant: 3,
    text: `Sorry, I want to make sure I answer the right thing. Could you let me know what you're after?\n\nMany thanks`,
  },
];

type FieldSet = { key: string; variant: number; text: string };

const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set.');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const table = base<FieldSet>('Templates');

async function upsert(row: TemplateRow): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await table
    .select({
      filterByFormula: `AND({key}='${row.key}', {variant}=${row.variant})`,
      maxRecords: 1,
    })
    .firstPage();

  if (existing.length === 0) {
    await table.create({ key: row.key, variant: row.variant, text: row.text });
    return 'created';
  }

  const current = existing[0];
  if (current.fields.text === row.text) return 'unchanged';

  await table.update(current.id, { text: row.text });
  return 'updated';
}

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of TEMPLATES) {
    const result = await upsert(row);
    const label = `${row.key}#${row.variant}`;
    if (result === 'created') {
      created++;
      console.log(`+ created  ${label}`);
    } else if (result === 'updated') {
      updated++;
      console.log(`~ updated  ${label}`);
    } else {
      unchanged++;
      console.log(`  unchanged ${label}`);
    }
  }

  console.log(
    `\nDone. ${created} created, ${updated} updated, ${unchanged} unchanged (total ${TEMPLATES.length}).`,
  );
}

main().catch((err: Error) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
