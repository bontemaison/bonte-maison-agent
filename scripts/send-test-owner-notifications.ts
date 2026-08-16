/**
 * Send every owner-notification variant to a single phone number as session
 * messages (sendMessage), so Jim (or whoever owns OWNER_PHONE)
 * can preview the wording end-to-end without burning HSM template billing.
 *
 * IMPORTANT — session-message window:
 *   WhatsApp only allows free-form session messages within 24h of the
 *   recipient's last inbound message. Before running this, send any text
 *   from the target number → the business number so the 24h window is open.
 *
 * Usage:
 *   npm run test:owner-notifications -- 6287878642956
 *   npm run test:owner-notifications --                  # phone = OWNER_PHONE
 *
 * Notes:
 * - Uses `override: true` to bypass conversation pause state.
 * - Spaces sends by 3s so all variants land in order without rate-limit hits.
 * - Reuses NotificationsService.renderReason via a typed cast so wording
 *   stays in sync with production (no template duplication).
 * - Customer phone / name / quote / dates are fixed sample values so each
 *   variant has realistic substitutions.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { NotificationsService } from '../src/notifications/notifications.service';

type ReasonContext = {
  guestName: string;
  phoneFormatted: string;
  message?: string;
  email?: string;
  datesFormatted?: string;
  nightsLabel?: string;
  priceQuoted?: number;
};

type NotificationsServicePrivate = {
  renderReason: (reason: string, ctx: ReasonContext) => string[];
};

const SAMPLE_CTX: ReasonContext = {
  guestName: 'Sarah Walker',
  phoneFormatted: '+44 7911 123456',
  email: 'sarah.walker@example.com',
  datesFormatted: 'Sun 18 — Sun 25 July 2027',
  nightsLabel: '7 nights',
  priceQuoted: 4200,
};

const VARIANTS: Array<{ reason: string; message?: string }> = [
  {
    reason: 'discount_request',
    message: 'Any chance of a small discount if we book this week?',
  },
  { reason: 'booking_confirmation' },
  {
    reason: 'faq_unknown',
    message: 'Is there a barbecue we can use in the evenings?',
  },
  { reason: 'hold_conflict' },
  { reason: 'dates_unavailable' },
  {
    reason: 'complaint',
    message: "The wifi has been dropping out all morning, it's really annoying.",
  },
  {
    reason: 'human_request',
    message: 'Could I speak to Jim directly please?',
  },
  {
    reason: 'long_stay_manual_pricing',
    message: 'We were hoping to stay six weeks through October and November.',
  },
  {
    reason: 'unclear_or_off_topic',
    message: 'Hi! Just checking on the thing we discussed.',
  },
  { reason: 'orchestrator_error' },
  {
    reason: 'composer_fallback',
    message: 'Could you tell me more about the property?',
  },
];

const SEND_SPACING_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const [phoneArg] = process.argv.slice(2);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get(ConfigService);
    const whatsapp = app.get(WhatsappService);
    const notifications = app.get(
      NotificationsService,
    ) as unknown as NotificationsServicePrivate;

    const phone = phoneArg ?? config.get<string>('OWNER_PHONE');
    if (!phone) {
      throw new Error('No phone provided and OWNER_PHONE is not set in .env');
    }

    console.log(
      `sending ${VARIANTS.length} owner-notification variants as session messages`,
      {
        to: phone,
        sampleGuest: SAMPLE_CTX.guestName,
        spacingMs: SEND_SPACING_MS,
      },
    );

    for (let i = 0; i < VARIANTS.length; i++) {
      const { reason, message } = VARIANTS[i];
      const ctx: ReasonContext = { ...SAMPLE_CTX, message };
      const lines = notifications.renderReason(reason, ctx);
      const body = `${lines.join('\n')}`;

      console.log(`\n[${i + 1}/${VARIANTS.length}] ${reason}`);
      try {
        await whatsapp.sendMessage(phone, body, { override: true });
        console.log('  → dispatched');
      } catch (err) {
        console.error('  ✗ failed:', (err as Error).message);
      }

      if (i < VARIANTS.length - 1) {
        await sleep(SEND_SPACING_MS);
      }
    }

    console.log(
      '\nAll sends dispatched. If any failed with a "session" or "131047" error,',
    );
    console.log(
      'the 24h customer service window is closed — send a WhatsApp from the',
    );
    console.log('target number to the business number first, then re-run.');
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error('test:owner-notifications failed:', err.message);
  process.exit(1);
});
