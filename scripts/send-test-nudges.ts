/**
 * Send all 8 SuperControl nudge texts to a single phone number as session
 * messages (sendMessage). Useful for previewing the wording end-to-end in
 * WhatsApp without burning Meta template billing.
 *
 * IMPORTANT — session-message window:
 *   WhatsApp only allows free-form session messages within 24h of the
 *   recipient's last inbound message. Before running this, send any text
 *   from 6287878642956 → the business number so the 24h window is open.
 *
 * Usage:
 *   npm run test:nudges -- 6287878642956
 *   npm run test:nudges -- 6287878642956 Nico
 *   npm run test:nudges --                          # phone = OWNER_PHONE
 *
 * Notes:
 * - Uses `override: true` to bypass conversation pause state.
 * - Spaces each send by 3s so all 8 land in order without rate-limit hits.
 * - The text below mirrors the Meta-approved nudge templates in tone; for
 *   the 4 nudges that don't have an Airtable template yet
 *   (4_weeks_anticipation, 1_week_practical, before_departure,
 *   re_engagement) the text is approximated in the same voice.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import type { NudgeKey } from '../src/email-integration/subject-matcher';

const NUDGE_TEXTS: Record<NudgeKey, string> = {
  nudge_booking_confirmation: `Hi {name}, I've just sent over your booking confirmation by email with all the details for your stay.

If you could have a quick look and let me know everything is in order, that would be great.

Really looking forward to welcoming you to Bonté Maison, I'm sure you'll have an amazing time.

Many thanks`,

  nudge_4_weeks_anticipation: `Hi {name}, just a quick note as your stay at Bonté is coming up in around four weeks.

The vineyards will be in full swing by then, the markets are at their best, and the long lunches outside really are something else.

I've sent a short email with a few ideas for the area to start thinking about ahead of your trip.

Looking forward to having you.

Many thanks`,

  nudge_1_week_practical: `Hi {name}, one week to go.

I've just sent an email with everything practical for your arrival — what to bring, what's already at the house, and a few useful local tips.

Sunday afternoons in France are quiet and most shops are closed, so worth picking up a few essentials on the way if you can. Towels, pool towels and bedding are all provided.

If anything's unclear before you head off, just let me know.

Many thanks`,

  nudge_pre_arrival: `Hi {name}, just a quick note ahead of your stay, I've sent a short email with arrival details and a few useful bits for the week.

The house will be ready for you from 4pm on Sunday.

Most people arrive, settle in and end up outside with a drink on that first evening, it's a great way to start the week.

There'll be a welcome pack for you at the house, all detailed here:
https://bontemaison.com/arrival-details

Sunday afternoon is very quiet in France and most shops are closed, so worth taking a few things with you if you can. Towels, pool towels and bedding are all provided.

If you need anything before you arrive, just let me know.

Many thanks`,

  nudge_mid_stay: `Hi {name}, just checking in to make sure everything is perfect for you at the house.

Hopefully you've had a chance to settle in and enjoy it properly. There's plenty going on in the area, the local markets, vineyards and night markets are all great in the evenings.

If you need anything at all during your stay, please let me know.

Enjoy the rest of your week.

Many thanks`,

  nudge_before_departure: `Hi {name}, hope you've had a wonderful week at Bonté.

I've just sent a quick email with the checkout details for Sunday morning — nothing complicated, just a few small things to leave the house as you found it.

If there's anything you need before you head off, let me know.

Many thanks`,

  nudge_thank_you: `Hi {name}, I've just sent you a quick email to say thank you following your stay.

It was a pleasure having you at Bonté Maison and I hope you had a really special week.

You'd be very welcome back anytime.

Many thanks`,

  nudge_re_engagement: `Hi {name}, hope you're well.

It's been a little while since your last stay at Bonté and the new season is opening up nicely — I've just sent a short email with a few of the best weeks if you've been thinking about another visit.

Would be lovely to have you back.

Many thanks`,
};

const SEND_SPACING_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function render(text: string, name: string): string {
  return text.replace(/\{name\}/g, name);
}

async function main(): Promise<void> {
  const [phoneArg, nameArg] = process.argv.slice(2);
  const name = (nameArg ?? 'Nico').trim() || 'Nico';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get(ConfigService);
    const whatsapp = app.get(WhatsappService);

    const phone = phoneArg ?? config.get<string>('OWNER_PHONE');
    if (!phone) {
      throw new Error('No phone provided and OWNER_PHONE is not set in .env');
    }

    const keys = Object.keys(NUDGE_TEXTS) as NudgeKey[];
    console.log(`sending ${keys.length} nudges as session messages`, {
      to: phone,
      name,
      spacingMs: SEND_SPACING_MS,
    });

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const body = `${render(NUDGE_TEXTS[key], name)}`;
      console.log(`\n[${i + 1}/${keys.length}] ${key}`);
      try {
        await whatsapp.sendMessage(phone, body, { override: true });
        console.log(`  → dispatched`);
      } catch (err) {
        console.error(`  ✗ failed:`, (err as Error).message);
      }
      if (i < keys.length - 1) {
        await sleep(SEND_SPACING_MS);
      }
    }

    console.log('\nAll sends dispatched. If any failed with a "session" or "131047" error,');
    console.log('the 24h customer service window is closed — send a WhatsApp from the');
    console.log('target number to the business number first, then re-run this script.');
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error('test:nudges failed:', err.message);
  process.exit(1);
});
