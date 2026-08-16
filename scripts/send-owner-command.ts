/**
 * Simulate the owner sending a command (or any message) to the bot.
 *
 * Usage:
 *   npm run owner:cmd -- /pause
 *   npm run owner:cmd -- /resume
 *   npm run owner:cmd -- /status
 *   npm run owner:cmd -- /pause 6282227907020 30
 *   npm run owner:cmd -- /status 6282227907020
 *
 *   # Local testing — captures the bot's reply to the terminal and skips
 *   # the real WhatsApp send. Useful when OWNER_PHONE is the same as the
 *   # bot number (which the WhatsApp API rejects with #100 Invalid parameter).
 *   npm run owner:cmd -- --dry-run /status
 *
 * Bootstraps the Nest app context (no HTTP server), dispatches the message
 * through MessageHandlerService with `from = OWNER_PHONE`, and (unless
 * --dry-run) the reply goes out over the configured WhatsApp provider to
 * your real phone.
 *
 * Requires .env with at least: OWNER_PHONE, AIRTABLE_*, WHATSAPP_*, DUALHOOK_LIVE_KEY.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { MessageHandlerService } from '../src/orchestrator/message-handler.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const text = args.filter((a) => a !== '--dry-run').join(' ').trim();

  if (!text) {
    console.error('Usage: npm run owner:cmd -- [--dry-run] <message>');
    console.error('  e.g.  npm run owner:cmd -- /pause');
    console.error('        npm run owner:cmd -- /status');
    console.error('        npm run owner:cmd -- /pause 6282227907020 30');
    console.error('        npm run owner:cmd -- --dry-run /status');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get(ConfigService);
    const handler = app.get(MessageHandlerService);
    const whatsapp = app.get(WhatsappService);

    const ownerPhone = config.get<string>('OWNER_PHONE');
    if (!ownerPhone) {
      throw new Error('OWNER_PHONE is not set in .env');
    }

    const captured: Array<{ to: string; text: string }> = [];
    if (dryRun) {
      whatsapp.sendMessage = async (to: string, body: string) => {
        captured.push({ to, text: body });
      };
      whatsapp.sendTemplate = async (
        to: string,
        templateName: string,
        vars: Record<string, string>,
      ) => {
        captured.push({
          to,
          text: `<template:${templateName}> ${JSON.stringify(vars)}`,
        });
      };
    }

    console.log(
      `Simulating: ${ownerPhone} → bot: "${text}"${dryRun ? '  (dry run)' : ''}`,
    );
    await handler.handle({ from: ownerPhone, text });

    if (dryRun) {
      if (captured.length === 0) {
        console.log('(no outbound messages produced)');
      } else {
        for (const m of captured) {
          console.log(`\n--- Reply to ${m.to} ---`);
          console.log(m.text);
          console.log('-----------------------');
        }
      }
    } else {
      console.log('Command dispatched. Check your WhatsApp for the reply.');
    }
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error('Command failed:', err.message);
  process.exit(1);
});
