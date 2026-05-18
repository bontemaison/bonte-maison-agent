/**
 * Jim's 2026-05 feedback — reproduction script.
 *
 * Each scenario below replays a customer conversation through the live
 * MessageHandlerService and grades the captured outbound reply against the
 * per-turn expectations. Goal: confirm we reproduce the bugs Jim flagged
 * BEFORE making any code/template changes. Every scenario here is expected
 * to FAIL on the current main branch.
 *
 * Usage:
 *   npm run test:feedback:jim
 *
 * Notes:
 *   - WhatsappService.sendMessage is replaced with a capture function on the
 *     live instance, so the bot never actually sends WhatsApp messages — but
 *     Airtable / Claude / iCal are hit for real. Expect a small $ spend.
 *   - Each scenario uses its own fake phone (`8888<rand>`) so prior turns
 *     build conversation state the same way they did in Jim's real threads.
 *   - Scenarios mirror Jim's six feedback items:
 *       1. Unavailable dates should capture email + send priority form link
 *       2. Date re-confirmation follow-up after N days (not yet built — skipped)
 *       3. `year_2026_redirect` wording: no comma in "for June, I'm afraid"
 *       4. After bot suggests Sunday-to-Sunday, "yes please" should run
 *          availability — NOT booking confirmation.
 *       5. "with exclusive use of the villa" should NOT appear in the
 *          availability-no-with-alternative reply.
 *       6. "can you help me book" should NOT ask for "preferred card" /
 *          "card details" — only email + phone + website link.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MessageHandlerService } from '../src/orchestrator/message-handler.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';

type Turn = {
  customer: string;
  mustInclude?: RegExp[];
  mustNotInclude?: RegExp[];
  notes?: string;
  /** Set when this turn isn't expected to produce a captured reply (e.g.
   *  context-priming turns before the assertion turn). */
  skipGrade?: boolean;
};

type Scenario = {
  id: string;
  title: string;
  feedbackRef: string;
  turns: Turn[];
  /** Set when the scenario can't be exercised by message replay yet
   *  (e.g. background scheduler not built). It'll be reported as SKIP. */
  skip?: { reason: string };
};

const SCENARIOS: Scenario[] = [
  // ── Feedback 1 + 5: unavailable dates → priority list capture, no "exclusive use of the villa" ──
  {
    id: 'priority-list-on-unavailable',
    title: 'Unavailable week offers priority list + no "exclusive use of the villa"',
    feedbackRef: 'Feedbacks #1 and #5',
    turns: [
      {
        customer: 'Hi, is the week of Sunday 8th August 2027 available?',
        mustInclude: [
          /reserved/i,
          /priority/i,
          /bontemaison\.com\/priority/i,
        ],
        mustNotInclude: [
          /exclusive use of the villa/i,
          /villa reserved exclusively for your group/i,
        ],
        notes:
          'When the requested week is reserved, bot should give priority-list link (Typeform) and avoid "exclusive use of the villa" copy.',
      },
    ],
  },

  // ── Feedback 2: date re-confirmation follow-up ────────────────────────
  // This is exercised by running the cron (`npm run trigger:follow-ups`)
  // against a conversation whose `last_activity` is 3-14 days ago and which
  // has `dates_requested` stored. The replay below covers the *reply* half
  // of the loop: after the cron parks dates as `awaiting_dates_confirmation`,
  // a customer "yes please" must run availability for the parked dates.
  {
    id: 'date-reconfirmation-yes',
    title: 'After cron parks dates, "yes please" runs availability (not booking handoff)',
    feedbackRef: 'Feedback #2',
    turns: [
      {
        customer: 'ok is the week saturday 7th august 2027 available ?',
        skipGrade: true,
        notes:
          'Priming: triggers dates_not_sunday_to_sunday template, which parks Sun 8 → Sun 15 Aug 2027 via the same `awaiting_dates_confirmation` path the cron will use.',
      },
      {
        customer: 'yes please',
        mustInclude: [/(available|reserved|already booked|free)/i],
        mustNotInclude: [
          /25\s?%|deposit/i,
          /book directly online|select booking from the menu/i,
        ],
        notes:
          'Same routing as the cron-driven reconfirmation: "yes please" with parked dates should run availability for those dates.',
      },
    ],
  },

  // ── Feedback 3: year_2026_redirect wording ────────────────────────────
  {
    id: 'year-2026-redirect-comma',
    title: '2026 redirect must read "for June I\'m afraid" (no comma after "June")',
    feedbackRef: 'Feedback #3',
    turns: [
      {
        customer: 'Hi, what weeks do you have in June 2026?',
        mustInclude: [
          /2026/,
          /(fully (booked|reserved))/i,
          /june i'?m afraid/i,
        ],
        mustNotInclude: [
          /for june, i'?m afraid/i,
        ],
        notes:
          'year_2026_redirect template currently renders "fully booked for June, I\'m afraid" — remove the comma before "I\'m afraid".',
      },
    ],
  },

  // ── Feedback 4: Sunday-to-Sunday confirmation handled as availability, not booking ──
  {
    id: 'sunday-confirm-not-booking',
    title: '"yes please" after Sunday-to-Sunday suggestion → availability check, not booking',
    feedbackRef: 'Feedback #4',
    turns: [
      {
        customer: 'ok is the week saturday 7th august 2027 available ?',
        skipGrade: true,
        notes:
          'Priming turn: bot should reply with dates_not_sunday_to_sunday, suggesting Sun 8 → Sun 15 August 2027.',
      },
      {
        customer: 'yes please',
        mustInclude: [
          /(available|reserved|already booked|free)/i,
          /(8|eighth)[\s,]+(august|aug)|(15|fifteenth)[\s,]+(august|aug)/i,
        ],
        mustNotInclude: [
          /25\s?%|deposit/i,
          /book directly online|select booking from the menu/i,
          /balance is due 8 weeks/i,
        ],
        notes:
          'Bot misclassifies "yes please" as booking_confirmation and sends booking_confirmed_handoff. Should instead run availability for the pending Sun 8 → Sun 15 Aug 2027 dates and reply with quote / reserved / alt.',
      },
    ],
  },

  // ── Feedback 6: "can you help me book" shouldn't ask for card details ──
  {
    id: 'book-no-card-details',
    title: '"can you help me book" → no "preferred card" / "card details"',
    feedbackRef: 'Feedback #6',
    turns: [
      {
        customer: 'is the week of Sunday 25th July 2027 available?',
        skipGrade: true,
        notes: 'Priming turn: gives the bot a quoted week so the next message has context.',
      },
      {
        customer: 'can you help me book',
        mustInclude: [
          /www\.bontemaison\.com/i,
        ],
        mustNotInclude: [
          /preferred card/i,
          /card details/i,
          /share your (contact details and )?(preferred )?card/i,
        ],
        notes:
          'Bot must not ask for card details. Allowed asks: email + phone + website link. (Cards are taken on the booking website, not over WhatsApp.)',
      },
    ],
  },
];

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

type Verdict = {
  status: 'pass' | 'fail' | 'no_reply' | 'skipped';
  failures: string[];
};

function grade(reply: string, turn: Turn): Verdict {
  if (turn.skipGrade) return { status: 'skipped', failures: [] };
  if (!reply || reply.trim().length === 0) {
    return { status: 'no_reply', failures: ['no outbound reply captured'] };
  }
  const failures: string[] = [];
  for (const re of turn.mustInclude ?? []) {
    if (!re.test(reply)) failures.push(`missing: ${re}`);
  }
  for (const re of turn.mustNotInclude ?? []) {
    if (re.test(reply)) failures.push(`forbidden present: ${re}`);
  }
  return { status: failures.length ? 'fail' : 'pass', failures };
}

function truncate(s: string, max = 220): string {
  const flat = s.replace(/\n+/g, ' ⏎ ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function fakePhone(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `8888${String(h).padStart(8, '0').slice(-8)}`;
}

async function main(): Promise<void> {
  console.log(
    `${COLOR.bold}Jim's 2026-05 feedback — regression suite${COLOR.reset}`,
  );
  console.log(
    `${COLOR.dim}Every scenario must PASS. Any failure means a Jim-flagged bug has regressed.${COLOR.reset}\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  // Capture outbound WhatsApp messages instead of sending them.
  const whatsapp = app.get(WhatsappService);
  const captured = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/require-await
  (
    whatsapp as unknown as {
      sendMessage: (
        to: string,
        text: string,
        options?: unknown,
      ) => Promise<void>;
    }
  ).sendMessage = async (to: string, text: string): Promise<void> => {
    const list = captured.get(to) ?? [];
    list.push(text);
    captured.set(to, list);
  };

  const handler = app.get(MessageHandlerService);

  let passCount = 0;
  let failCount = 0;
  let noReplyCount = 0;
  let skippedScenarios = 0;

  for (const scenario of SCENARIOS) {
    console.log(
      `\n${COLOR.cyan}── ${scenario.id} ── ${COLOR.bold}${scenario.title}${COLOR.reset}`,
    );
    console.log(`${COLOR.dim}   ${scenario.feedbackRef}${COLOR.reset}`);

    if (scenario.skip) {
      skippedScenarios++;
      console.log(
        `   ${COLOR.magenta}SKIP${COLOR.reset} — ${scenario.skip.reason}`,
      );
      continue;
    }

    const phone = fakePhone(`${scenario.id}-${Date.now()}-${Math.random()}`);

    for (const [idx, turn] of scenario.turns.entries()) {
      const beforeCount = (captured.get(phone) ?? []).length;
      try {
        await handler.handle({ from: phone, text: turn.customer });
      } catch (err) {
        console.error(
          `  ${COLOR.red}✗ handler threw on "${truncate(turn.customer, 60)}":${COLOR.reset}`,
          (err as Error).message,
        );
      }
      const allReplies = captured.get(phone) ?? [];
      const newReplies = allReplies.slice(beforeCount);
      const reply = newReplies.join('\n---\n');
      const verdict = grade(reply, turn);

      if (verdict.status === 'pass') passCount++;
      else if (verdict.status === 'fail') failCount++;
      else if (verdict.status === 'no_reply') noReplyCount++;

      const tag =
        verdict.status === 'pass'
          ? `${COLOR.green}PASS${COLOR.reset}`
          : verdict.status === 'fail'
            ? `${COLOR.red}FAIL${COLOR.reset}`
            : verdict.status === 'no_reply'
              ? `${COLOR.yellow}NO REPLY${COLOR.reset}`
              : `${COLOR.dim}context${COLOR.reset}`;

      console.log(
        `   turn ${idx + 1} ${tag}  Q: ${truncate(turn.customer, 80)}`,
      );
      console.log(
        `              A: ${COLOR.dim}${truncate(reply, 200)}${COLOR.reset}`,
      );
      if (verdict.failures.length) {
        for (const f of verdict.failures) {
          console.log(`              ${COLOR.red}- ${f}${COLOR.reset}`);
        }
      }
      if (turn.notes) {
        console.log(`              ${COLOR.dim}↳ ${turn.notes}${COLOR.reset}`);
      }
    }
  }

  console.log(
    `\n${COLOR.bold}Summary${COLOR.reset}: ` +
      `${COLOR.green}${passCount} pass${COLOR.reset}, ` +
      `${COLOR.red}${failCount} fail${COLOR.reset}, ` +
      `${COLOR.yellow}${noReplyCount} no-reply${COLOR.reset}, ` +
      `${COLOR.magenta}${skippedScenarios} skipped scenarios${COLOR.reset}`,
  );

  await app.close();

  process.exit(failCount > 0 || noReplyCount > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error('Jim feedback test failed to boot:', err.message);
  process.exit(1);
});
