/**
 * Year-by-year inquiry diagnostic.
 *
 * Sends one realistic availability inquiry per year (2028..2038) through the
 * live pipeline and prints, for each year, the full decision chain:
 *
 *   message → parser (intent / dates / monthQuery)
 *           → booking-rules validation
 *           → calendar (iCal) availability
 *           → pricing lookup
 *           → final outbound reply (captured, not sent)
 *
 * The point is to see WHERE a year falls over. The symptom we're chasing:
 * the bot replies "I don't have those dates" for years the calendar shows
 * as completely free, because pricing bands don't extend that far.
 *
 * Usage:
 *   npm run test:years
 *
 * Notes:
 *   - WhatsappService.sendMessage is stubbed to capture replies. Airtable,
 *     Claude and the iCal feed are hit for real (expect API spend).
 *   - Each year runs on its own fake phone so there's no cross-year state.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AvailabilityService } from '../src/availability/availability.service';
import { BookingRulesService } from '../src/booking-rules/booking-rules.service';
import { MessageHandlerService } from '../src/orchestrator/message-handler.service';
import { ParserService } from '../src/parser/parser.service';
import { PricingService } from '../src/pricing/pricing.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const START_YEAR = 2028;
const END_YEAR = 2038;
const DAY_MS = 24 * 60 * 60 * 1000;

/** First Sunday on or after 1 July of `year` (UTC). */
function firstJulySunday(year: number): Date {
  const d = new Date(Date.UTC(year, 6, 1));
  const dow = d.getUTCDay();
  if (dow !== 0) d.setUTCDate(d.getUTCDate() + (7 - dow));
  return d;
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function truncate(s: string, max = 220): string {
  const flat = s.replace(/\n+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Reject if `p` doesn't settle within `ms` — so one bad network call can't
 *  freeze the whole diagnostic. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms),
    ),
  ]);
}

const STEP_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const whatsapp = app.get(WhatsappService);
  const captured = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/require-await
  (
    whatsapp as unknown as {
      sendMessage: (to: string, text: string) => Promise<void>;
    }
  ).sendMessage = async (to: string, text: string): Promise<void> => {
    const list = captured.get(to) ?? [];
    list.push(text);
    captured.set(to, list);
  };

  const parser = app.get(ParserService);
  const availability = app.get(AvailabilityService);
  const pricing = app.get(PricingService);
  const bookingRules = app.get(BookingRulesService);
  const handler = app.get(MessageHandlerService);

  console.log(
    `${COLOR.bold}Year-by-year inquiry diagnostic (${START_YEAR}–${END_YEAR})${COLOR.reset}\n`,
  );

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const checkIn = firstJulySunday(year);
    const checkOut = new Date(checkIn.getTime() + 7 * DAY_MS);
    const message = `Hi Jim, is Bonté Maison free from ${fmt(checkIn)} to ${fmt(
      checkOut,
    )}? We're a group of 8.`;

    console.log(`${COLOR.cyan}${COLOR.bold}━━ ${year} ━━${COLOR.reset}`);
    console.log(`  ${COLOR.dim}msg:${COLOR.reset} ${message}`);
    console.log(
      `  ${COLOR.dim}want:${COLOR.reset} ${iso(checkIn)} → ${iso(checkOut)}`,
    );

    // 1. Parser
    let parsedLine = '(parse failed)';
    try {
      const parsed = await withTimeout(parser.parse(message, []), STEP_TIMEOUT_MS, 'parse');
      parsedLine = `intent=${parsed.intent} checkIn=${
        parsed.checkIn ? iso(parsed.checkIn) : 'null'
      } checkOut=${
        parsed.checkOut ? iso(parsed.checkOut) : 'null'
      } monthQuery=${JSON.stringify(parsed.monthQuery)} monthRange=${JSON.stringify(
        parsed.monthRangeQuery,
      )}`;
    } catch (err) {
      parsedLine = `${COLOR.red}${(err as Error).message}${COLOR.reset}`;
    }
    console.log(`  ${COLOR.dim}parse:${COLOR.reset} ${parsedLine}`);

    // 2. Booking rules
    let ruleLine = '';
    try {
      const rule = await withTimeout(
        bookingRules.validate(checkIn, checkOut),
        STEP_TIMEOUT_MS,
        'rules',
      );
      ruleLine = rule.pass ? 'pass' : `BLOCK reason=${rule.reason}`;
    } catch (err) {
      ruleLine = `${COLOR.red}${(err as Error).message}${COLOR.reset}`;
    }
    console.log(`  ${COLOR.dim}rules:${COLOR.reset} ${ruleLine}`);

    // 3. Calendar availability
    let availLine = '';
    try {
      const free = await withTimeout(
        availability.isRangeAvailable(checkIn, checkOut),
        STEP_TIMEOUT_MS,
        'ical',
      );
      availLine = free
        ? `${COLOR.green}FREE${COLOR.reset}`
        : `${COLOR.yellow}reserved${COLOR.reset}`;
    } catch (err) {
      availLine = `${COLOR.red}${(err as Error).message}${COLOR.reset}`;
    }
    console.log(`  ${COLOR.dim}ical:${COLOR.reset}  ${availLine}`);

    // 4. Pricing
    let priceLine = '';
    try {
      const quote = await withTimeout(
        pricing.calculate(checkIn, checkOut),
        STEP_TIMEOUT_MS,
        'price',
      );
      const tag = quote.usedBase
        ? `${COLOR.yellow}base — pricing pending, won't be quoted${COLOR.reset}`
        : quote.label ?? 'no label';
      priceLine = `${COLOR.green}£${quote.total}${COLOR.reset} (${tag})`;
    } catch (err) {
      priceLine = `${COLOR.red}${(err as Error).message}${COLOR.reset}`;
    }
    console.log(`  ${COLOR.dim}price:${COLOR.reset} ${priceLine}`);

    // 5. Full pipeline → captured reply
    const phone = `99990${String(year)}`;
    captured.delete(phone);
    try {
      await withTimeout(
        handler.handle({ from: phone, text: message }),
        STEP_TIMEOUT_MS,
        'handle',
      );
    } catch (err) {
      console.log(
        `  ${COLOR.dim}reply:${COLOR.reset} ${COLOR.red}handler threw: ${
          (err as Error).message
        }${COLOR.reset}`,
      );
      console.log('');
      continue;
    }
    const replies = captured.get(phone) ?? [];
    const reply = replies.join(' | ');
    console.log(
      `  ${COLOR.dim}reply:${COLOR.reset} ${
        reply ? truncate(reply) : `${COLOR.red}(no reply)${COLOR.reset}`
      }`,
    );
    console.log('');
  }

  await app.close();
  // Cron schedulers / IMAP watcher keep the event loop alive — force exit.
  process.exit(0);
}

main().catch((err: Error) => {
  console.error('Year inquiry test failed:', err.message);
  process.exit(1);
});
