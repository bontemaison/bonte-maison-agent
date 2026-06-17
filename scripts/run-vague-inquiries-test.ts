/**
 * Vague-inquiry guard test (before / after).
 *
 * Sends availability inquiries that name NO concrete dates (often just a year,
 * like the real "we may need to wait to 2028" message). These route to the
 * composer's `dates_unclear` scenario. The bot has NOT checked the calendar,
 * so it must NOT claim anything about availability — it should simply ask for
 * the specific week/dates.
 *
 * Each reply is scanned for "unchecked availability claims" (released / not
 * open / fully booked / already reserved …). Any match is a FAIL.
 *
 * Run it on the OLD code, note the FAILs, then on the NEW code:
 *   git stash && npm run test:vague   # before
 *   git stash pop && npm run test:vague   # after
 *
 * Notes:
 *   - WhatsappService.sendMessage is stubbed to capture replies. Airtable,
 *     Claude and the iCal feed are hit for real (expect API spend).
 *   - Each message runs on its own fake phone (no cross-message state).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MessageHandlerService } from '../src/orchestrator/message-handler.service';
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

// Messages with NO concrete dates. The bot cannot have checked availability,
// so any availability claim in the reply is invented.
const MESSAGES: string[] = [
  'Hi Jim. We may need to have to wait to 2028 - please let me know when the earliest is we can book for then. Thank you',
  'Are you taking bookings for 2029?',
  'Do you have any availability?',
  "We'd love to come and stay sometime, what have you got free?",
  'Is the villa available next year?',
  'Thinking about a holiday in 2030, is that something we can book?',
];

// If any of these appear, the bot asserted availability it never checked.
const UNCHECKED_CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\breleased?\b/i, label: 'claims dates "released" / "not released"' },
  { re: /\bnot (yet )?(been )?open(ed)?\b/i, label: 'claims "not yet open"' },
  { re: /availability open/i, label: '"availability open just yet" framing' },
  { re: /\bfully booked\b/i, label: 'claims "fully booked"' },
  { re: /\balready reserved\b/i, label: 'claims "already reserved"' },
  { re: /\bnot (yet )?available\b/i, label: 'claims "not available"' },
  { re: /\bkeep an eye on\b/i, label: '"keep an eye on the website" deflection' },
  { re: /\bnot (yet )?taking bookings\b/i, label: 'claims "not taking bookings"' },
];

// Soft signal: a good reply for these asks for the specific dates/week.
const ASKS_FOR_DATES = /\b(which|what)\b[^.?!]*\b(week|dates?|month)\b|\b(dates?|week)\b[^.?!]*\b(in mind|you.?re thinking|works for you)\b|share[^.?!]*\b(dates?|week)\b/i;

function truncate(s: string, max = 320): string {
  const flat = s.replace(/\n+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

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

  const handler = app.get(MessageHandlerService);

  console.log(
    `${COLOR.bold}Vague-inquiry guard test — no reply should claim availability${COLOR.reset}\n`,
  );

  let pass = 0;
  let fail = 0;
  let noReply = 0;

  for (let i = 0; i < MESSAGES.length; i++) {
    const message = MESSAGES[i];
    const phone = `99988${String(i).padStart(3, '0')}`;
    captured.delete(phone);

    console.log(`${COLOR.cyan}${COLOR.bold}── #${i + 1}${COLOR.reset}`);
    console.log(`  ${COLOR.dim}msg:${COLOR.reset} ${message}`);

    try {
      await handler.handle({ from: phone, text: message });
    } catch (err) {
      console.log(
        `  ${COLOR.red}handler threw: ${(err as Error).message}${COLOR.reset}\n`,
      );
      fail++;
      continue;
    }

    const reply = (captured.get(phone) ?? []).join(' | ');
    if (!reply) {
      console.log(`  ${COLOR.yellow}(no reply)${COLOR.reset}\n`);
      noReply++;
      continue;
    }
    console.log(`  ${COLOR.dim}reply:${COLOR.reset} ${truncate(reply)}`);

    const violations = UNCHECKED_CLAIM_PATTERNS.filter((p) => p.re.test(reply));
    const asks = ASKS_FOR_DATES.test(reply);

    if (violations.length > 0) {
      fail++;
      console.log(`  ${COLOR.red}${COLOR.bold}FAIL${COLOR.reset} — unchecked availability claim:`);
      for (const v of violations) {
        console.log(`    ${COLOR.red}• ${v.label}${COLOR.reset}`);
      }
    } else {
      pass++;
      console.log(
        `  ${COLOR.green}${COLOR.bold}PASS${COLOR.reset} — no unchecked claim` +
          (asks
            ? `, and it asks for dates ${COLOR.green}✓${COLOR.reset}`
            : ` ${COLOR.yellow}(note: did not clearly ask for dates)${COLOR.reset}`),
      );
    }
    console.log('');
  }

  console.log(
    `${COLOR.bold}Summary:${COLOR.reset} ${COLOR.green}${pass} pass${COLOR.reset}, ${COLOR.red}${fail} fail${COLOR.reset}, ${COLOR.yellow}${noReply} no-reply${COLOR.reset} (of ${MESSAGES.length})`,
  );

  await app.close();
  // Cron schedulers / IMAP watcher keep the event loop alive — force exit.
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error('Vague inquiry test failed:', err.message);
  process.exit(1);
});
