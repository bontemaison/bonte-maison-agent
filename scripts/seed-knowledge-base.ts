/**
 * Seed/update KnowledgeBase table in Airtable.
 *
 * Usage:
 *   npm run seed:kb                # safe: create missing rows, backfill a
 *                                   # blank audience column, never touch content
 *   npm run seed:kb -- --force     # overwrite answer/question_examples/audience
 *                                   # on existing rows from KB_ENTRIES below
 *
 * Airtable, not this file, is the runtime source of truth: KnowledgeBaseService
 * queries Airtable live on every message, so anything Jim adds or edits
 * directly in Airtable is authoritative immediately — no sync step needed for
 * that direction. KB_ENTRIES below is only an initial seed / version-controlled
 * template.
 *
 * That's why the default run never overwrites `answer` or `question_examples`
 * on a row that already exists — doing so unconditionally would silently
 * clobber a manual edit Jim made in Airtable the next time this script runs
 * for an unrelated reason (e.g. adding one new topic). The only thing the
 * default run backfills on an existing row is a genuinely blank `audience`
 * column, which is metadata, not content. Use `--force` only when you
 * deliberately want to push a code-side content revision over Airtable.
 *
 * Airtable table must have fields: topic_key (string), question_examples (long text),
 * answer (long text), audience (single select), active (checkbox).
 *
 * `audience` controls who may be told the answer:
 *   all       — anyone, including a cold prospect (the default when blank)
 *   pre_stay  — confirmed future guests and in-house guests
 *   in_stay   — in-house guests only
 *   sensitive — in-house guests only, and never in a document Jim doesn't
 *               control (WiFi password, door codes)
 */
import Airtable from 'airtable';

type KbAudience = 'all' | 'pre_stay' | 'in_stay' | 'sensitive';

type KbRow = {
  topic_key: string;
  question_examples: string;
  answer: string;
  /** Omit for public content — a blank column reads as `all`. */
  audience?: KbAudience;
  active?: boolean;
};

const KB_ENTRIES: KbRow[] = [
  {
    topic_key: 'air_conditioning',
    question_examples: 'air conditioning, AC, A/C, is there air con, do you have air conditioning, is it hot inside',
    answer: `There isn't air conditioning at Bonté. The house is a traditional French property with thick stone walls and shutters, which keep it comfortably cool during the warmer months when guests use the shutters during the day and open up in the evenings. There are also fans in the bedrooms.\n\nMost of the summer is naturally spent outside by the pool, on the terrace or in the evening shade.`,
  },
  {
    topic_key: 'bike_hire',
    question_examples: 'bike hire, cycling, can we cycle, hire bikes, rent bikes, bike rental, can we hire bikes',
    answer: `Yes, the area around Bonté is excellent for cycling, with quiet country roads and vineyard routes around Duras and Eymet.\n\nLocal companies can arrange bike hire and in many cases either deliver to the house or meet guests nearby. If cycling is something you'd like to build into your stay, I'd be very happy to point you towards suitable local options before you arrive.`,
  },
  {
    topic_key: 'cancellation_policy',
    question_examples: 'cancellation, refund, cancel booking, what if plans change',
    answer: `Full cancellation terms are included with the booking confirmation. If you'd like me to talk you through anything specific before booking, just let me know.`,
  },
  {
    topic_key: 'car_needed',
    question_examples: 'do we need a car, is a car required, can we get around without a car',
    answer: `Yes, I would definitely recommend having a car.\n\nThe house is in a lovely, peaceful setting surrounded by countryside and vineyards, which is part of what makes it so special, but it does mean you'll want a car to explore properly.\n\nThere are some fantastic local towns, markets and restaurants nearby, all within a short drive.`,
  },
  {
    topic_key: 'changeover_day',
    question_examples: 'changeover day, arrival day, what day, can we arrive on a different day, midweek arrival',
    answer: `Changeover is on Sunday only. The house runs on a Sunday-to-Sunday basis, which keeps things consistent and means everything is properly prepared between stays.`,
  },
  {
    topic_key: 'check_in_out_times',
    question_examples: 'check-in time, check-out time, arrival time, when can we arrive',
    answer: `Check-in is from 4pm on Sunday, and check-out is by 10am the following Sunday.\n\nThat timing allows us to get everything perfectly prepared for your arrival. Most guests arrive mid to late afternoon and settle straight into the evening.\n\nIf you're running ahead of schedule, it's well worth stopping off at St Emilion if driving from Bordeaux — a fabulous UNESCO world heritage town where wine has been produced for centuries. Closer to Bonté, Sainte-Foy and Duras are both lovely for a coffee on the terraces.`,
  },
  {
    topic_key: 'cot_highchair',
    question_examples: 'cot, highchair, baby equipment, travelling with a baby',
    answer: `Yes — there are two cots and two highchairs at the house.\n\nIt's very well set up for families, so you shouldn't need to bring those with you.`,
  },
  {
    topic_key: 'couple',
    question_examples: 'just two of us, couple, romantic break, anniversary',
    answer: `The house is set up for groups of up to 10, so for two it's quite a lot of space, but it does make for a really special, private stay if that's what you're after.\n\nIf you let me know your dates, I can check availability.`,
  },
  {
    topic_key: 'deposit',
    question_examples: 'deposit, how much deposit, what is the deposit, deposit needed, deposit amount, payment terms, booking terms',
    answer: `A 25% deposit secures your dates, with the remaining balance due 8 weeks before arrival.\n\nWe also take a £200 refundable security deposit, which is returned after your stay. Payments can be made in £ or €, all major cards accepted.\n\nIf you let me know the week you'd like, I can confirm the exact deposit amount and either send the booking details through or point you to the online booking at www.bontemaison.com.`,
  },
  {
    topic_key: 'dogs',
    question_examples: 'dogs allowed, pet friendly, can we bring our dog',
    answer: `Yes — dogs are very welcome, no limit.\n\nThe house works really nicely for them — plenty of outdoor space and walks nearby.`,
  },
  {
    topic_key: 'ev_charger',
    question_examples: 'EV charger, electric car charging, Tesla, electric vehicle',
    answer: `There isn't an EV charger at the house itself.\n\nHowever, there are charging points available locally in the nearby towns, so it's still very manageable if you're travelling with an electric car. The nearest is at 80 Avenue de la Résistance, 33220 Pineuilh (about 10 minutes' drive).`,
  },
  {
    topic_key: 'families',
    question_examples: 'family holiday, kids, children, young children, suitable for kids',
    answer: `The house is wonderful for families. There are two cots and two highchairs already at the house, plus plenty of outdoor space for children to enjoy.\n\nThe pool, the grounds and the local area all work brilliantly for family holidays.`,
  },
  {
    topic_key: 'hot_tub',
    question_examples: 'hot tub, jacuzzi, spa',
    answer: `Yes, there are two hot tubs at the house, which guests really enjoy in the cooler evenings.`,
  },
  {
    topic_key: 'how_to_book',
    question_examples: 'how do I book, how can I book, how to reserve, booking process, how do I confirm, how to pay',
    answer: `The easiest way is to book directly online at www.bontemaison.com — just select Booking from the menu and the system will guide you through everything, including the 25% deposit to secure your dates.\n\nThe balance is due 8 weeks before arrival. All major cards are accepted with secure 3D payment, in £ or €.\n\nI'm also very happy to handle the booking for you, or to jump on a quick call if that would help.`,
  },
  {
    topic_key: 'interior_photos',
    question_examples: 'interior photos, photos of the inside, can I see pictures, what does it look like inside, pictures of the house, see inside, more photos, internal photos, interior pictures, gallery, do you have photos, images of the house',
    answer: `You can see photos of the interior — and the rest of the house — here:\nwww.bontemaison.com/about-bonte\n\nIt gives a lovely feel for the space: the light-filled living areas, the kitchen and the bedrooms. If there's a particular room you'd like to see more of, just let me know.`,
  },
  {
    topic_key: 'local_area',
    question_examples: 'what is the local area like, what is there to do, things to do, nearby, what is around, area, surroundings, restaurants, eating out, where to eat',
    answer: `There's so much to enjoy in the local area. The medieval towns of Eymet, Duras and Bergerac are all close by, and the wider Dordogne is a wonderful region to explore.\n\nDuras is around 10 minutes away and the Château des Vigiers is close by for a more traditional setting, including relaxed dining on the terrace. Eymet and Bergerac are excellent for evenings out with market squares, wine bars and highly rated French restaurants. In July and August, booking ahead is sensible.\n\nVineyards, local markets, restaurants and wine experiences are all easily within reach. You can also see our eating-out guide at www.bontemaison.com/eating-out.`,
  },
  {
    topic_key: 'location',
    question_examples: 'where is the property, location, nearest airport, how to get there',
    answer: `Bonté Maison is near Duras in south-west France — between Bordeaux and Bergerac, right in the middle of wine country.\n\nIt's a quiet, private spot surrounded by vineyards, with some fantastic medieval towns nearby: Eymet, Duras and Bergerac are all close. It's a great base for exploring the Dordogne.`,
  },
  {
    topic_key: 'long_stays',
    question_examples: 'long stay, monthly rental, winter rental, off-season long stay, several months',
    answer: `We do offer longer stays from October through to May, anywhere between 1 and 6 months.\n\nPricing for longer stays is handled individually rather than at the standard weekly rate, so let me take your dates and I'll come back to you with the right figure.`,
  },
  {
    topic_key: 'minimum_stay',
    question_examples: 'minimum stay, shortest booking, can we stay for a few nights, weekend stay',
    answer: `The minimum stay is 7 nights, and bookings are taken in one-week blocks (so 1, 2 or 3 weeks).\n\nFor longer stays between October and May, we can accommodate 1 to 6 months, though those are priced separately.`,
  },
  {
    topic_key: 'nearest_shops',
    question_examples: 'nearest shops, supermarket, groceries, where to shop',
    answer: `The nearest shops are just a short drive away in the local towns. You've got everything you need nearby — bakeries, supermarkets, and some really good local markets, especially in the summer months.\n\nMost guests tend to pick things up on the way in, then top up locally during the week.\n\nHere are the recommendations:\n- E.Leclerc Pineuilh — 80 Avenue de la Résistance, 33220 Pineuilh (huge hypermarket)\n- Carrefour Contact — 83 Chemin Boutères Pourraou, 47120 Duras`,
  },
  {
    topic_key: 'outdoor_area',
    question_examples: 'outdoor area, garden, terrace, outside, outdoor space, BBQ, grounds',
    answer: `There's a wonderful outdoor area to enjoy — a terrace for meals, plenty of space to relax, and lovely views over the surrounding countryside and vineyards.\n\nIn the warmer months it's where most of the day naturally spends itself: long lunches outside, evenings on the terrace, and quiet time around the pool.`,
  },
  {
    topic_key: 'outdoor_dining',
    // Trimmed to stop colliding with outdoor_area's examples (both listed
    // "terrace" / "outdoor area") — the parser was picking either near-
    // arbitrarily for the same question.
    question_examples: 'outdoor dining, eating outside, dinner outside, pergola',
    answer: `There's a beautiful outdoor dining area that seats 10, plus pergola seating elsewhere in the grounds.\n\nMost evenings end the same way, outside with a drink, watching the sun drop over the vineyards.`,
  },
  {
    topic_key: 'parking',
    question_examples: 'parking, where to park, car park, can we park',
    answer: `Yes, there's private parking available at the house.`,
  },
  {
    topic_key: 'pool_heated',
    question_examples: 'is the pool heated, pool temperature, warm pool',
    answer: `The pool isn't heated, but it's warmed naturally by the sun and from around June through September it sits at a really lovely temperature.\n\nThere are also two hot tubs at the house, which are lovely for relaxing in the evenings whatever the season.`,
  },
  {
    topic_key: 'pool_overview',
    question_examples: 'is there a pool, do you have a pool, swimming pool, what about the pool, pool size',
    answer: `Yes — there's a lovely outdoor pool at the house, set in a beautiful spot overlooking the countryside.\n\nIt's one of the favourite features of Bonté Maison, especially over the long summer days. Guests tend to spend a lot of the day in and around it.`,
  },
  {
    topic_key: 'pool_towels',
    question_examples: 'pool towels, towels provided, do we need to bring towels',
    answer: `Yes — all towels are provided, including pool towels.\n\nEverything is set up so you can arrive and settle in straight away.`,
  },
  {
    topic_key: 'property_overview',
    question_examples: 'tell me about the villa, tell me about the property, what is the house like, what is the villa, describe the property, can you tell me about, more info about the house',
    answer: `Bonté is a private luxury villa in the Dordogne, set in peaceful countryside close to Duras, Eymet and Bergerac, and well placed for the Bordeaux wine region.\n\nIt sleeps 10 across five bedrooms (two king-size and three twin) and three bathrooms, making it ideal for families, friends and multi-generational stays. We can also accommodate an 11th guest if it's a child, using a good quality fold-out bed.\n\nThe house is reserved exclusively for your group and includes the private pool, two hot tubs, generous outdoor dining space, a BBQ, pétanque court, fast WiFi, bedding, towels, pool towels, cleaning and a welcome pack on arrival.`,
  },
  {
    topic_key: 'sleeps',
    question_examples: 'how many people, how many guests, how many bedrooms, how many bathrooms, capacity, layout',
    answer: `The house comfortably sleeps 10 across five bedrooms and three bathrooms.\n\nWe can also accommodate an 11th guest if it's a child, using a good quality fold-out bed that's already at the house.\n\nThere are also two cots available if needed, so it works really well for families or mixed groups.`,
  },
  {
    topic_key: 'st_emilion_stop',
    question_examples: 'St Emilion, stop on the way, places to visit en route, sightseeing on arrival day',
    answer: `If you're driving from Bordeaux and running ahead of schedule, it's well worth stopping off at St Emilion. It's a fabulous UNESCO world heritage town where wine has been produced for centuries.\n\nCloser to the house, Saint-Foy and Duras are both lovely for a coffee on the terraces.`,
  },
  {
    topic_key: 'twin_to_double',
    question_examples: 'can the twin beds be pushed together, twin to double, push the twin beds together, can twins make a double, join twin beds, super king from twins',
    answer: `On the twin beds, yes we can push them together, but the reality of two separate mattresses means it will always feel like two beds together — many guests are happy with this.`,
  },
  {
    topic_key: 'welcome_pack',
    question_examples: "welcome pack, welcome basket, what's provided on arrival, arrival gifts",
    answer: `There's a premium welcome pack ready for your arrival, including chilled wine.\n\nFull arrival details are here: https://bontemaison.com/arrival-details`,
  },
  {
    topic_key: 'whats_included',
    question_examples: "what's included, what do we get, included in price, extras, additional costs",
    answer: `The weekly rate includes the full house, all bedding and towels (including pool towels), the welcome pack with chilled wine, use of the pool, both hot tubs, and the outdoor dining and pergola areas.\n\nThere's plenty of useful detail on the website at www.bontemaison.com if you'd like to take a look.`,
  },
];

type FieldSet = {
  topic_key: string;
  question_examples: string;
  answer: string;
  audience: KbAudience;
  active?: boolean;
};

const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set.');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const table = base<FieldSet>('KnowledgeBase');

const FORCE = process.argv.includes('--force');

type UpsertResult = 'created' | 'updated' | 'audience_backfilled' | 'skipped';

async function upsert(row: KbRow): Promise<UpsertResult> {
  const existing = await table
    .select({
      filterByFormula: `{topic_key}='${row.topic_key}'`,
      maxRecords: 1,
    })
    .firstPage();

  // Only written if the row explicitly asks for it — the seed script must
  // never touch Jim's manual active/inactive toggle otherwise.
  const activePatch = row.active !== undefined ? { active: row.active } : {};

  if (existing.length === 0) {
    await table.create({
      topic_key: row.topic_key,
      question_examples: row.question_examples,
      answer: row.answer,
      audience: row.audience ?? 'all',
      ...activePatch,
    });
    return 'created';
  }

  const current = existing[0];

  if (FORCE) {
    const fields: FieldSet = {
      topic_key: row.topic_key,
      question_examples: row.question_examples,
      answer: row.answer,
      audience: row.audience ?? 'all',
      ...activePatch,
    };
    const unchanged =
      current.fields.question_examples === fields.question_examples &&
      current.fields.answer === fields.answer &&
      (current.fields.audience ?? 'all') === fields.audience &&
      (row.active === undefined || current.fields.active === row.active);
    if (unchanged) return 'skipped';
    await table.update(current.id, fields);
    return 'updated';
  }

  // Non-destructive default: content that already exists in Airtable may have
  // been hand-edited by Jim, so leave answer/question_examples alone. A blank
  // audience column is metadata, not content — safe to fill in.
  if (current.fields.audience === undefined) {
    await table.update(current.id, {
      audience: row.audience ?? 'all',
    } as Partial<FieldSet>);
    return 'audience_backfilled';
  }

  return 'skipped';
}

async function main(): Promise<void> {
  console.log(
    FORCE
      ? 'MODE: --force — existing rows will be overwritten from KB_ENTRIES.\n'
      : 'MODE: safe — existing content is left alone; only new rows and a blank audience column are written. Re-run with --force to push content changes.\n',
  );

  const counts: Record<UpsertResult, number> = {
    created: 0,
    updated: 0,
    audience_backfilled: 0,
    skipped: 0,
  };

  for (const row of KB_ENTRIES) {
    const result = await upsert(row);
    counts[result]++;
    const label = {
      created: '+ created',
      updated: '~ updated',
      audience_backfilled: '~ audience backfilled',
      skipped: '  skipped (unchanged)',
    }[result];
    console.log(`${label}  ${row.topic_key}`);
  }

  console.log(
    `\nDone. ${counts.created} created, ${counts.updated} updated, ${counts.audience_backfilled} audience-backfilled, ${counts.skipped} skipped (total ${KB_ENTRIES.length}).`,
  );
}

main().catch((err: Error) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
