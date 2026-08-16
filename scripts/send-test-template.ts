/**
 * Send a single WhatsApp Business Template directly, bypassing the email
 * watcher. Use this to verify the Meta-side template send works (auth,
 * billing, template approval, phone-number registration, etc.) independent
 * of the SuperControl ingestion path.
 *
 * Usage:
 *   npm run test:template -- nudge_pre_arrival
 *   npm run test:template -- nudge_pre_arrival 6287878642956
 *   npm run test:template -- nudge_pre_arrival 6287878642956 Nico
 *   npm run test:template -- pre_arrival                          # short-key alias
 *
 * Defaults:
 *   phone -> OWNER_PHONE
 *   name  -> "there"  (substituted into {{1}})
 *
 * Notes:
 * - Uses `override: true` so it ignores conversation pause state.
 * - Routes through WhatsappService → Dualhook, so this is the exact same code
 *   path as the email dispatcher.
 * - On error 131000 / 131047 / 132xxx: check the dashboard. 131000 family is
 *   usually billing / payment method on the WABA. 132xxx is template approval
 *   status or template-language mismatch.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { SUPERCONTROL_CONFIG } from '../src/email-integration/subject-matcher';

const SHORT_KEYS: Record<string, keyof typeof SUPERCONTROL_CONFIG.subjects> = {
  booking_confirmation: 'nudge_booking_confirmation',
  weeks_4:              'nudge_4_weeks_anticipation',
  weeks_1:              'nudge_1_week_practical',
  pre_arrival:          'nudge_pre_arrival',
  mid_stay:             'nudge_mid_stay',
  before_departure:     'nudge_before_departure',
  thank_you:            'nudge_thank_you',
  re_engagement:        'nudge_re_engagement',
};

async function main(): Promise<void> {
  const [rawTemplate, phoneArg, nameArg] = process.argv.slice(2);
  if (!rawTemplate) {
    console.error('Usage: npm run test:template -- <template_name> [phone] [name]');
    console.error('Known templates:');
    for (const key of Object.keys(SUPERCONTROL_CONFIG.subjects)) {
      console.error(`  - ${key}`);
    }
    console.error('Short-key aliases:', Object.keys(SHORT_KEYS).join(', '));
    process.exit(1);
  }

  const templateName = SHORT_KEYS[rawTemplate] ?? rawTemplate;
  const name = (nameArg ?? 'there').trim() || 'there';

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

    console.log(`sending template:`, { templateName, to: phone, vars: { '1': name } });

    await whatsapp.sendTemplate(
      phone,
      templateName,
      { '1': name },
      { override: true },
    );

    console.log('\nsend dispatched. Check your phone — and the app logs for the message id.');
    console.log('If you see no message arrive, check:');
    console.log('  1. Meta Business Suite → Billing → payment method status');
    console.log('  2. Template status is "Active – Quality pending" (not Rejected)');
    console.log('  3. Template name matches exactly (case-sensitive)');
    console.log('  4. Phone number is in E.164 without "+", e.g. 6287878642956');
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error('test:template failed:', err.message);
  process.exit(1);
});
