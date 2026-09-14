/**
 * Reproduction — off-Sunday dates snapped to a booked week, then
 * "How much is that please" → "Last time we spoke…" (2026-09-14).
 *
 * Replays the real three-turn thread from +44 7714 287051 on a fake phone
 * against the PRODUCTION Airtable base, the live iCal and Claude.
 *
 * What went wrong:
 *   1. "29/5 to 1/6" was snapped to Sun 30 May–6 Jun 2027 and proposed without
 *      looking at the calendar. That week is booked (ref 32).
 *   2. "How much is that please" parsed as pricing_inquiry, fell out of the
 *      awaiting_dates_confirmation guard, and got date_reconfirmation_check
 *      ("Last time we spoke…") one minute into the conversation.
 *   3. The guest said yes, and only then was told the week was reserved.
 *
 * What this script checks now, on every turn:
 *   - date_reconfirmation_check is never rendered (the conversation is live)
 *   - dates_not_sunday_to_sunday / minimum_stay_not_met never propose a week
 *     that is reserved or held
 *   - every week offered with a price ("11 July to 18 July at £5,995") is open
 *     in the iCal and not held
 *
 * Before the replay it audits May–Aug 2027 through the same AvailabilityService
 * production uses, and dumps the raw 2027 VEVENTs from the feed — so "the bot
 * suggested a booked week" can be checked against what the feed actually says.
 *
 * Safety against production:
 *   - IMAP vars are removed before boot → the SuperControl watcher never starts
 *   - every cron is stopped right after boot (a 09:00 follow-up tick during the
 *     run would mark real follow-ups sent through the stubbed sender)
 *   - WhatsappService.sendMessage / sendTemplate are stubbed — capture only
 *   - NotificationsService.notifyOwner* are stubbed — Jim is never pinged
 *   - Airtable IS written: Conversations / MessageLog rows for the fake phone.
 *     The phone is in Ofcom's reserved drama range, so it can't be a real guest.
 *     State is reset before the replay and follow-ups cancelled after.
 *
 * Run:  npm run repro:reconfirm                 # .env.production
 *       npm run repro:reconfirm -- --phone 447700900002
 */
import { NestFactory } from '@nestjs/core';
import * as ical from 'node-ical';
import { AppModule } from '../src/app.module';
import { AvailabilityService } from '../src/availability/availability.service';
import { ConversationService } from '../src/conversation/conversation.service';
import { ConversationCronService } from '../src/conversation/conversation-cron.service';
import { FollowUpsService } from '../src/follow-ups/follow-ups.service';
import { FollowUpsCronService } from '../src/follow-ups/follow-ups-cron.service';
import { HoldsCronService } from '../src/holds/holds-cron.service';
import { HoldsService } from '../src/holds/holds.service';
import { MessageHandlerService } from '../src/orchestrator/message-handler.service';
import { CoexistenceHeartbeatService } from '../src/notifications/coexistence-heartbeat.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TemplatesService } from '../src/templates/templates.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { addDays, formatIsoDate, parseIsoDate } from '../src/common/dates';

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const DEFAULT_PHONE = '447700900001';

// Verbatim from the screenshot.
const TURNS: Array<{ text: string; expect: string }> = [
  {
    text: 'Hello, I saw your post and looking to come 29/5 to 1/6 is this available? And if so how long is the transfer from the airport? And can you recommend a transfer company?',
    expect:
      'Sunday-to-Sunday rule, 30 May → 6 Jun is reserved, real open weeks offered — no unchecked suggestion',
  },
  {
    text: 'How much is that please',
    expect: 'answers for the dates under discussion — NOT "Last time we spoke"',
  },
  {
    text: 'Yes I could try those dates',
    expect: 'anything offered with a price is open in the iCal',
  },
];

const RECONFIRM_KEY = 'date_reconfirmation_check';
// Both variants of the template, in case the key capture misses.
const RECONFIRM_TEXT = /last time we spoke|just checking back in/i;
const SUGGESTION_KEYS = new Set([
  'dates_not_sunday_to_sunday',
  'minimum_stay_not_met',
]);

const AUDIT_FROM = parseIsoDate('2027-05-01');
const AUDIT_TO = parseIsoDate('2027-09-01');
const WEEKS_IN_QUESTION = ['2027-05-30', '2027-07-11', '2027-07-18'];

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
// "11 July to 18 July 2027", "11 July 2027 to 18 July 2027", "Sunday, 11 July 2027 to …"
const WEEK_RE = new RegExp(
  String.raw`(\d{1,2})\s+(${MONTHS.join('|')})(?:\s+(\d{4}))?\s+(?:to|–|-|until)\s+(?:\w+,\s*)?(\d{1,2})\s+(${MONTHS.join('|')})(?:\s+(\d{4}))?`,
  'gi',
);

function parseArgs(): { phone: string } {
  const args = process.argv.slice(2);
  const i = args.indexOf('--phone');
  return { phone: i >= 0 && args[i + 1] ? args[i + 1] : DEFAULT_PHONE };
}

type Week = { checkIn: string; checkOut: string };

function extractWeeks(text: string, re: RegExp = WEEK_RE): Week[] {
  const out: Week[] = [];
  for (const m of text.matchAll(re)) {
    const [, d1, m1, y1, d2, m2, y2] = m;
    const year2 = y2 ?? y1;
    const year1 = y1 ?? year2;
    if (!year1 || !year2) continue;
    const iso = (d: string, mon: string, y: string) =>
      `${y}-${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
    out.push({ checkIn: iso(d1, m1, year1), checkOut: iso(d2, m2, year2) });
  }
  return out;
}

// Only weeks the bot is *offering* — followed by a price. A reserved week is
// named in the same reply ("30 May to 6 June is reserved") and must not count.
const OFFERED_RE = new RegExp(`${WEEK_RE.source}\\s+at\\s+£`, 'gi');

function indent(s: string, pad = '    '): string {
  return s
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

async function main(): Promise<void> {
  const { phone } = parseArgs();

  // Never start the SuperControl watcher against the production mailbox.
  delete process.env.SUPERCONTROL_IMAP_HOST;
  delete process.env.SUPERCONTROL_IMAP_USER;
  delete process.env.SUPERCONTROL_IMAP_PASS;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  // Stop every cron before anything else can tick.
  for (const Cron of [
    ConversationCronService,
    HoldsCronService,
    FollowUpsCronService,
    CoexistenceHeartbeatService,
  ]) {
    app.get(Cron).onModuleDestroy();
  }

  // ── stubs ──────────────────────────────────────────────────────────────
  const sent: string[] = [];
  const hsm: string[] = [];
  const ownerPings: string[] = [];
  const keysUsed: string[] = [];

  const whatsapp = app.get(WhatsappService);
  // eslint-disable-next-line @typescript-eslint/require-await
  whatsapp.sendMessage = async (_to, text) => {
    sent.push(text);
  };
  // eslint-disable-next-line @typescript-eslint/require-await
  whatsapp.sendTemplate = async (to, name, vars) => {
    hsm.push(`${name} → ${to} ${JSON.stringify(vars)}`);
  };

  const notifications = app.get(NotificationsService);
  // eslint-disable-next-line @typescript-eslint/require-await
  notifications.notifyOwner = async (text) => {
    ownerPings.push(text);
  };
  // eslint-disable-next-line @typescript-eslint/require-await
  notifications.notifyOwnerAboutConversation = async (_p, reason, opts) => {
    ownerPings.push(`${reason} ${JSON.stringify(opts ?? {})}`);
  };

  const templates = app.get(TemplatesService);
  const realRender = templates.render.bind(templates);
  const rendered: Array<{ key: string; vars: Record<string, unknown> }> = [];
  templates.render = async (key, vars) => {
    keysUsed.push(key);
    rendered.push({ key, vars: vars });
    return realRender(key, vars);
  };

  const weekStatus = async (w: Week): Promise<'open' | 'reserved' | 'held'> => {
    const ci = parseIsoDate(w.checkIn);
    const co = parseIsoDate(w.checkOut);
    if (await holds.hasOverlap(ci, co)) return 'held';
    return (await availability.isRangeAvailable(ci, co)) ? 'open' : 'reserved';
  };

  const availability = app.get(AvailabilityService);
  const conversation = app.get(ConversationService);
  const followUps = app.get(FollowUpsService);
  const holds = app.get(HoldsService);
  const handler = app.get(MessageHandlerService);

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.log(`  ${COLOR.red}${COLOR.bold}FAIL${COLOR.reset} ${msg}`);
  };
  const pass = (msg: string) =>
    console.log(`  ${COLOR.green}${COLOR.bold}PASS${COLOR.reset} ${msg}`);

  // ── 1. iCal audit ──────────────────────────────────────────────────────
  console.log(
    `${COLOR.bold}1. iCal audit — May → Aug 2027 via AvailabilityService${COLOR.reset}`,
  );
  console.log(`  ${COLOR.dim}${process.env.ICAL_URL}${COLOR.reset}\n`);

  const raw = await ical.async.fromURL(process.env.ICAL_URL as string);
  const events = Object.values(raw)
    .filter((e) => (e as { type?: string }).type === 'VEVENT')
    .map((e) => e as unknown as { start: Date; end: Date; summary?: string })
    .filter(
      (e) => e.start.getFullYear() === 2027 || e.end.getFullYear() === 2027,
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  console.log(
    `  ${COLOR.dim}raw 2027 VEVENTs (${events.length}):${COLOR.reset}`,
  );
  for (const e of events) {
    console.log(
      `    ${formatIsoDate(e.start)} → ${formatIsoDate(e.end)}  ${e.summary ?? ''}`,
    );
  }

  const open = await availability.findAvailableSundayWeeks(
    AUDIT_FROM,
    AUDIT_TO,
  );
  const openSet = new Set(open.map((w) => formatIsoDate(w.checkIn)));
  console.log(
    `\n  ${COLOR.dim}Sunday weeks, as the bot sees them:${COLOR.reset}`,
  );
  for (let d = parseIsoDate('2027-05-02'); d < AUDIT_TO; d = addDays(d, 7)) {
    const iso = formatIsoDate(d);
    const isOpen = openSet.has(iso);
    const mark = WEEKS_IN_QUESTION.includes(iso) ? '  ◀ in the thread' : '';
    console.log(
      `    ${iso} → ${formatIsoDate(addDays(d, 7))}  ${
        isOpen
          ? `${COLOR.green}OPEN${COLOR.reset}    `
          : `${COLOR.dim}reserved${COLOR.reset}`
      }${mark}`,
    );
  }

  console.log();
  const week3005Open = openSet.has('2027-05-30');
  if (week3005Open)
    fail('30 May → 6 Jun 2027 is OPEN in the feed but the bot said reserved');
  else
    pass(
      '30 May → 6 Jun 2027 is reserved in the feed — bot was right to say so',
    );

  for (const iso of ['2027-07-11', '2027-07-18']) {
    const overlap = await holds.hasOverlap(
      parseIsoDate(iso),
      addDays(parseIsoDate(iso), 7),
    );
    console.log(
      `  ${COLOR.dim}${iso} week: iCal ${openSet.has(iso) ? 'OPEN' : 'reserved'}, hold ${overlap ? 'YES' : 'none'}${COLOR.reset}`,
    );
  }
  console.log(
    `  ${COLOR.yellow}If Jim has 11 → 25 Jul 2027 booked, it is not in the iCal feed — the bot can only offer what the feed shows.${COLOR.reset}\n`,
  );

  // ── 2. conversation replay ────────────────────────────────────────────
  console.log(`${COLOR.bold}2. Replay on ${phone}${COLOR.reset}\n`);

  await conversation.updateContext(phone, {
    lastIntent: '',
    pendingDates: null,
    customerName: null,
  });
  await followUps.cancel(phone);

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    sent.length = 0;
    hsm.length = 0;
    ownerPings.length = 0;
    keysUsed.length = 0;
    rendered.length = 0;

    console.log(`${COLOR.cyan}${COLOR.bold}── turn ${i + 1}${COLOR.reset}`);
    console.log(`  ${COLOR.dim}guest:${COLOR.reset}  ${turn.text}`);
    console.log(`  ${COLOR.dim}expect:${COLOR.reset} ${turn.expect}`);

    try {
      await handler.handle({ from: phone, text: turn.text });
    } catch (err) {
      fail(`handler threw: ${(err as Error).message}`);
      continue;
    }

    const state = await conversation.getState(phone);
    console.log(
      `  ${COLOR.dim}state:${COLOR.reset}  lastIntent=${state.lastIntent} pending=${JSON.stringify(state.pendingDates)}`,
    );
    console.log(
      `  ${COLOR.dim}templates:${COLOR.reset} ${keysUsed.join(', ') || '(composer)'}`,
    );
    if (ownerPings.length) {
      console.log(
        `  ${COLOR.dim}owner ping (suppressed):${COLOR.reset} ${ownerPings.join(' | ')}`,
      );
    }
    if (hsm.length) {
      console.log(
        `  ${COLOR.dim}HSM (suppressed):${COLOR.reset} ${hsm.join(' | ')}`,
      );
    }
    const reply = sent.join('\n---\n');
    console.log(
      `  ${COLOR.dim}reply:${COLOR.reset}\n${indent(reply || '(no reply)')}`,
    );

    // (a) never the "are you still looking at…" template mid-conversation
    if (keysUsed.includes(RECONFIRM_KEY) || RECONFIRM_TEXT.test(reply)) {
      fail(`sent ${RECONFIRM_KEY} ("Last time we spoke…") mid-conversation`);
    } else {
      pass(`no ${RECONFIRM_KEY}`);
    }

    // (b) a Sunday / min-stay suggestion must be for a week that is open
    for (const r of rendered.filter((x) => SUGGESTION_KEYS.has(x.key))) {
      const [w] = extractWeeks(
        `${String(r.vars.suggested_check_in)} to ${String(r.vars.suggested_check_out)}`,
      );
      if (!w) {
        fail(
          `${r.key}: could not parse suggested dates ${JSON.stringify(r.vars)}`,
        );
        continue;
      }
      const status = await weekStatus(w);
      if (status === 'open')
        pass(`${r.key} suggested ${w.checkIn} → ${w.checkOut}, which is open`);
      else
        fail(
          `${r.key} suggested ${w.checkIn} → ${w.checkOut}, but it is ${status}`,
        );
    }

    // (c) every priced week offered in the reply is genuinely open
    const offered = extractWeeks(reply, OFFERED_RE);
    if (offered.length === 0) {
      console.log(
        `  ${COLOR.dim}(no priced weeks offered in this reply)${COLOR.reset}`,
      );
    }
    for (const w of offered) {
      const status = await weekStatus(w);
      if (status === 'open')
        pass(`offered ${w.checkIn} → ${w.checkOut} — open, no hold`);
      else fail(`offered ${w.checkIn} → ${w.checkOut} but it is ${status}`);
    }
    console.log();
  }

  // ── cleanup ────────────────────────────────────────────────────────────
  await followUps.cancel(phone);
  await app.close();

  console.log(
    failures
      ? `${COLOR.red}${COLOR.bold}${failures} failure(s)${COLOR.reset}`
      : `${COLOR.green}${COLOR.bold}all checks passed${COLOR.reset}`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
