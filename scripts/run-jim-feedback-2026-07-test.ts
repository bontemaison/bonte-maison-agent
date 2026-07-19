/**
 * Jim's 2026-07 feedback — reproduction script.
 *
 * Two real conversations Jim flagged (screenshots, 2026-07-19):
 *
 *   1. "what weeks are available in sept/oct?" → bot replied vaguely
 *      ("2026 has limited availability now, some weeks in Sept and Oct are
 *      available. Would that work for you?") instead of listing the actual
 *      open Sunday-to-Sunday weeks from the iCal.
 *
 *   2. Lewis: "availability in the last week of April 2027? Ideally 4/5 days
 *      over April 23rd... cost & if the pool/hot tubs are open?" → bot never
 *      checked the iCal (Jim says those dates are booked), invented two
 *      "Sunday" weeks (19 April 2027 is a Monday), and deferred with "I can
 *      check availability and come back to you".
 *
 * The script fetches the iCal ground truth FIRST, replays each conversation
 * through the live MessageHandlerService, and grades the captured reply
 * against what the calendar actually says. Expected to FAIL on current main —
 * that confirms the repro. After the fix, the same script must PASS.
 *
 * Usage:
 *   npm run test:feedback:jim-jul
 *
 * Notes:
 *   - WhatsappService.sendMessage and NotificationsService are stubbed on the
 *     live instances: no WhatsApp goes out, no owner pings fire. Airtable,
 *     Claude and the iCal feed are hit for real. Expect a small $ spend.
 *   - Parser output and composer scenario are captured per turn so a failure
 *     shows WHERE the pipeline went wrong (parse vs route vs compose).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AvailabilityService } from '../src/availability/availability.service';
import { BookingRulesService } from '../src/booking-rules/booking-rules.service';
import { ComposerService } from '../src/composer/composer.service';
import { MessageHandlerService } from '../src/orchestrator/message-handler.service';
import { ParserService, ParseResult } from '../src/parser/parser.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

type Week = { checkIn: Date; checkOut: Date };

type GroundTruth = {
  /** Available Sunday weeks with check-in in Sept or Oct 2026. */
  septOct2026: Week[];
  year2026Blocked: boolean;
  /** Sun 18 Apr 2027 → Sun 25 Apr 2027 free? (the week containing Apr 23) */
  april18Free: boolean;
  /** Sun 25 Apr 2027 → Sun 2 May 2027 free? (the other "flexible" fit) */
  april25Free: boolean;
};

type Turn = {
  customer: string;
  profileName?: string;
  expectation: string;
  grade: (reply: string, truth: GroundTruth) => string[];
};

type Scenario = { id: string; title: string; turns: Turn[] };

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Does the reply mention this date as "6 September" / "September 6" (ordinals ok)? */
function mentionsDate(reply: string, d: Date): boolean {
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const dayFirst = new RegExp(
    `\\b${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}\\b`,
    'i',
  );
  const monthFirst = new RegExp(
    `\\b${month}\\s+${day}(?:st|nd|rd|th)?\\b`,
    'i',
  );
  return dayFirst.test(reply) || monthFirst.test(reply);
}

/**
 * Every "Sunday <day> <month>" claim in the reply must actually fall on a
 * Sunday. Catches composer date-math hallucinations ("Sunday 19 April 2027"
 * — a Monday). Bare day+months resolve against defaultYear.
 */
function findFakeSundays(reply: string, defaultYear: number): string[] {
  const failures: string[] = [];
  const re =
    /sunday,?\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const day = parseInt(m[1], 10);
    const month = MONTHS.indexOf(m[2].toLowerCase());
    const year = m[3] ? parseInt(m[3], 10) : defaultYear;
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCDay() !== 0) {
      const actual = d.toLocaleDateString('en-GB', {
        weekday: 'long',
        timeZone: 'UTC',
      });
      failures.push(
        `invented date: "Sunday ${day} ${m[2]} ${year}" is actually a ${actual}`,
      );
    }
  }
  return failures;
}

/** Day-numbers mentioned next to Sept/Oct that aren't boundaries of any truly free week. */
function findStraySeptOctDates(reply: string, truth: GroundTruth): string[] {
  const legit = new Set<string>();
  for (const w of truth.septOct2026) {
    legit.add(`${w.checkIn.getUTCDate()}-${w.checkIn.getUTCMonth()}`);
    legit.add(`${w.checkOut.getUTCDate()}-${w.checkOut.getUTCMonth()}`);
  }
  const failures: string[] = [];
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(september|october)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const day = parseInt(m[1], 10);
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (!legit.has(`${day}-${month}`)) {
      failures.push(
        `lists "${m[1]} ${m[2]}" but that is not a boundary of any free week in the iCal`,
      );
    }
  }
  return failures;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'sept-oct-month-list',
    title:
      '"what weeks are available in sept/oct?" → list actual free weeks from iCal',
    turns: [
      {
        customer:
          'Website enquiry\n\nHi there, please could you let me know what weeks are available in sept/oct?',
        expectation:
          'Jim wants the actual open Sunday-to-Sunday weeks listed line by line (or a clear "fully reserved" if none). Not "some weeks are available, would that work?"',
        grade: (reply, truth) => {
          // Jim's spec: the iCal is the truth. If the calendar has free weeks
          // in the asked months they must be listed, even when the (stale)
          // year_2026_fully_booked flag is still on. The redirect is only
          // right when the calendar really has nothing.
          const failures: string[] = [];
          if (truth.septOct2026.length === 0) {
            if (
              !/(fully reserved|fully booked|no weeks|nothing (currently )?available|not have any)/i.test(
                reply,
              )
            ) {
              failures.push(
                'iCal shows NO free Sept/Oct weeks — reply must say so plainly',
              );
            }
            if (/(some weeks|limited availability)/i.test(reply)) {
              failures.push('claims "some weeks available" but iCal has none');
            }
            return failures;
          }
          for (const w of truth.septOct2026) {
            if (!mentionsDate(reply, w.checkIn)) {
              failures.push(
                `missing free week from iCal: ${fmt(w.checkIn)} → ${fmt(w.checkOut)}`,
              );
            }
          }
          failures.push(...findStraySeptOctDates(reply, truth));
          failures.push(...findFakeSundays(reply, 2026));
          if (
            /some weeks (in|are)|limited availability/i.test(reply) &&
            failures.length > 0
          ) {
            failures.push(
              'vague "some weeks available" instead of a concrete list',
            );
          }
          return failures;
        },
      },
    ],
  },
  {
    id: 'lewis-april-2027',
    title:
      'Lewis, last week of April 2027 → must check iCal, real Sundays only, pool answered',
    turns: [
      {
        customer:
          'Hi!\n\nDo you have availability in the last week of April 2027? Ideally 4/5 days over April 23rd. Can be flexible on check in date.\n\nIf so, could you let me know cost & if the pool/hot tubs are open that time of year?\n\nThanks,\nLewis',
        profileName: 'Lewis Bird',
        expectation:
          'Bot must run the availability check for the Sunday weeks around 23 Apr 2027 (18→25 Apr / 25 Apr→2 May) and answer from the iCal — Jim says those dates are booked. No invented "Sunday" dates, no "I can check and come back", pool still answered.',
        grade: (reply, truth) => {
          const failures: string[] = [];
          failures.push(...findFakeSundays(reply, 2027));
          if (
            /(i can check availability|check availability and (come|get) back|come back to you with pricing)/i.test(
              reply,
            )
          ) {
            failures.push(
              'defers the availability check ("I\'ll check and come back") — the iCal was never consulted',
            );
          }
          if (!/pool/i.test(reply)) {
            failures.push('pool question dropped from the reply');
          }
          if (!truth.april18Free && !truth.april25Free) {
            if (
              !/(reserved|unavailable|not available|already booked)/i.test(
                reply,
              )
            ) {
              failures.push(
                'both candidate weeks are reserved in the iCal but the reply never says so',
              );
            }
          } else {
            const free = truth.april18Free
              ? new Date(Date.UTC(2027, 3, 18))
              : new Date(Date.UTC(2027, 3, 25));
            if (!mentionsDate(reply, free)) {
              failures.push(
                `iCal shows ${fmt(free)} week free — reply should offer it with real dates`,
              );
            }
          }
          return failures;
        },
      },
    ],
  },
];

function fakePhone(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `8888${String(h).padStart(8, '0').slice(-8)}`;
}

function indent(text: string, pad = '      '): string {
  return text
    .split('\n')
    .map((l) => `${pad}${l}`)
    .join('\n');
}

async function main(): Promise<void> {
  console.log(
    `${COLOR.bold}Jim's 2026-07 feedback — reproduction suite${COLOR.reset}\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  // ── Stub outbound side effects ─────────────────────────────────────────
  const whatsapp = app.get(WhatsappService);
  const captured = new Map<string, string[]>();

  (
    whatsapp as unknown as {
      sendMessage: (to: string, text: string, o?: unknown) => Promise<void>;
    }
  ).sendMessage =
    // eslint-disable-next-line @typescript-eslint/require-await
    async (to: string, text: string): Promise<void> => {
      const list = captured.get(to) ?? [];
      list.push(text);
      captured.set(to, list);
    };

  const notifications = app.get(NotificationsService);
  const ownerPings: string[] = [];

  (
    notifications as unknown as {
      notifyOwner: (b: string, o?: unknown) => Promise<void>;
    }
  ).notifyOwner =
    // eslint-disable-next-line @typescript-eslint/require-await
    async (body: string): Promise<void> => {
      ownerPings.push(body);
    };
  (
    notifications as unknown as {
      notifyOwnerAboutConversation: (
        p: string,
        r: string,
        o?: unknown,
      ) => Promise<void>;
    }
  ).notifyOwnerAboutConversation =
    // eslint-disable-next-line @typescript-eslint/require-await
    async (phone: string, reason: string): Promise<void> => {
      ownerPings.push(`[${reason}] ${phone}`);
    };

  // ── Capture parser + composer diagnostics ──────────────────────────────
  const parser = app.get(ParserService);
  let lastParse: ParseResult | null = null;
  const origParse = parser.parse.bind(parser);
  (parser as unknown as { parse: typeof parser.parse }).parse = async (
    ...args: Parameters<typeof parser.parse>
  ): Promise<ParseResult> => {
    const res = await origParse(...args);
    lastParse = res;
    return res;
  };

  const composer = app.get(ComposerService);
  let lastScenarioHint: string | null = null;
  const origCompose = composer.compose.bind(composer);
  (composer as unknown as { compose: typeof composer.compose }).compose =
    async (
      ...args: Parameters<typeof composer.compose>
    ): ReturnType<typeof composer.compose> => {
      lastScenarioHint = args[0].scenarioHint ?? null;
      return origCompose(...args);
    };

  // ── Ground truth from the live iCal ────────────────────────────────────
  const availability = app.get(AvailabilityService);
  const bookingRules = app.get(BookingRulesService);

  const septOct2026 = await availability.findAvailableSundayWeeks(
    new Date(Date.UTC(2026, 8, 1)),
    new Date(Date.UTC(2026, 10, 1)),
  );
  const aprilMay2027 = await availability.findAvailableSundayWeeks(
    new Date(Date.UTC(2027, 3, 1)),
    new Date(Date.UTC(2027, 4, 10)),
  );
  const truth: GroundTruth = {
    septOct2026,
    year2026Blocked: await bookingRules.isYearFullyBooked(2026),
    april18Free: aprilMay2027.some((w) => iso(w.checkIn) === '2027-04-18'),
    april25Free: aprilMay2027.some((w) => iso(w.checkIn) === '2027-04-25'),
  };

  console.log(`${COLOR.bold}iCal ground truth${COLOR.reset}`);
  console.log(`  year_2026_fully_booked flag: ${truth.year2026Blocked}`);
  console.log(
    `  Free Sunday weeks Sept–Oct 2026: ${septOct2026.length ? '' : '(none)'}`,
  );
  for (const w of septOct2026)
    console.log(`    ${fmt(w.checkIn)} → ${fmt(w.checkOut)}`);
  console.log(
    `  Week Sun 18 Apr 2027 → Sun 25 Apr 2027 free: ${truth.april18Free}`,
  );
  console.log(
    `  Week Sun 25 Apr 2027 → Sun 2 May 2027 free: ${truth.april25Free}`,
  );

  const handler = app.get(MessageHandlerService);

  let passCount = 0;
  let failCount = 0;

  for (const scenario of SCENARIOS) {
    console.log(
      `\n${COLOR.cyan}── ${scenario.id} ── ${COLOR.bold}${scenario.title}${COLOR.reset}`,
    );
    const phone = fakePhone(`${scenario.id}-${Date.now()}-${Math.random()}`);

    for (const [idx, turn] of scenario.turns.entries()) {
      lastParse = null;
      lastScenarioHint = null;
      const before = (captured.get(phone) ?? []).length;
      const pingsBefore = ownerPings.length;
      try {
        await handler.handle({
          from: phone,
          text: turn.customer,
          profileName: turn.profileName,
        });
      } catch (err) {
        console.error(
          `  ${COLOR.red}✗ handler threw:${COLOR.reset}`,
          (err as Error).message,
        );
      }
      const reply = (captured.get(phone) ?? []).slice(before).join('\n---\n');
      const failures = reply
        ? turn.grade(reply, truth)
        : ['no outbound reply captured'];

      if (failures.length === 0) passCount++;
      else failCount++;

      const tag =
        failures.length === 0
          ? `${COLOR.green}PASS${COLOR.reset}`
          : `${COLOR.red}FAIL${COLOR.reset}`;
      console.log(`\n   turn ${idx + 1} ${tag}`);
      console.log(`   ${COLOR.dim}customer:${COLOR.reset}`);
      console.log(indent(turn.customer));
      if (lastParse) {
        const p: ParseResult = lastParse;
        console.log(
          `   ${COLOR.magenta}parsed:${COLOR.reset} intent=${p.intent} conf=${p.confidence}` +
            ` checkIn=${p.checkIn ? iso(p.checkIn) : 'null'} checkOut=${p.checkOut ? iso(p.checkOut) : 'null'}` +
            ` monthQuery=${JSON.stringify(p.monthQuery)} monthRangeQuery=${JSON.stringify(p.monthRangeQuery)}` +
            ` topicKeys=${JSON.stringify(p.topicKeys)}`,
        );
      }
      console.log(
        `   ${COLOR.magenta}composer scenario:${COLOR.reset} ${lastScenarioHint ?? '(not used — template path)'}`,
      );
      console.log(`   ${COLOR.dim}bot reply:${COLOR.reset}`);
      console.log(indent(reply || '(none)'));
      for (const f of failures)
        console.log(`   ${COLOR.red}- ${f}${COLOR.reset}`);
      console.log(`   ${COLOR.dim}↳ ${turn.expectation}${COLOR.reset}`);
      const pings = ownerPings.slice(pingsBefore);
      if (pings.length) {
        console.log(
          `   ${COLOR.yellow}owner notifications (stubbed): ${pings.join(' | ')}${COLOR.reset}`,
        );
      }
    }
  }

  console.log(
    `\n${COLOR.bold}Summary${COLOR.reset}: ${COLOR.green}${passCount} pass${COLOR.reset}, ${COLOR.red}${failCount} fail${COLOR.reset}`,
  );

  await app.close();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error('feedback repro failed to boot:', err.message);
  process.exit(1);
});
