import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { MessageHandlerService } from '../orchestrator/message-handler.service';
import { WhatsappService } from './whatsapp.service';

const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEDUP_MAX = 1000;

@Controller('webhook')
export class WebhookController {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly logger: LoggerService,
    private readonly handler: MessageHandlerService,
    private readonly whatsapp: WhatsappService,
  ) {}

  private isDuplicate(id: string): boolean {
    const now = Date.now();
    for (const [key, ts] of this.seen) {
      if (now - ts > DEDUP_TTL_MS) this.seen.delete(key);
      else break;
    }
    if (this.seen.has(id)) return true;
    this.seen.set(id, now);
    if (this.seen.size > DEDUP_MAX) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    return false;
  }

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    try {
      return this.whatsapp.verifyWebhook(mode, token, challenge);
    } catch {
      this.logger.warn('whatsapp', 'webhook verification rejected', { mode });
      throw new ForbiddenException();
    }
  }

  // NOTE: this endpoint is unauthenticated. Meta signs webhooks with the
  // BSP-owned app secret under Dualhook's Webhook Override, which we can never
  // obtain, so HMAC verification is not possible here. Anyone who knows the
  // URL can post a forged payload.
  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ status: 'ok' }> {
    this.logger.debug('whatsapp', 'webhook payload received', { body });

    const message = this.whatsapp.parseWebhook(body);
    if (!message) {
      const echo = this.whatsapp.parseOutboundEcho(body);
      if (echo) {
        if (echo.id && this.whatsapp.wasRecentlySentByBot(echo.id)) {
          this.logger.debug('whatsapp', 'echo is bot-originated; ignoring', {
            to: echo.to,
            id: echo.id,
          });
          return { status: 'ok' };
        }
        if (echo.id && this.isDuplicate(echo.id)) {
          return { status: 'ok' };
        }
        this.logger.info('whatsapp', 'detected owner reply in customer thread', {
          to: echo.to,
          id: echo.id,
        });
        void this.handler.handleOwnerTakeover(echo.to).catch((err: Error) => {
          this.logger.error('whatsapp', 'takeover handler threw; swallowed', {
            to: echo.to,
            error: err.message,
          });
        });
        return { status: 'ok' };
      }
      this.logger.debug('whatsapp', 'webhook ignored: no parseable message', { body });
      return { status: 'ok' };
    }

    if (message.id && this.isDuplicate(message.id)) {
      this.logger.debug('whatsapp', 'duplicate webhook ignored', {
        from: message.from,
        id: message.id,
      });
      return { status: 'ok' };
    }

    this.logger.info('whatsapp', 'received message', {
      from: message.from,
      text: message.text,
      id: message.id,
    });

    void this.handler
      .handle({
        from: message.from,
        text: message.text,
        profileName: message.profileName,
      })
      .catch((err: Error) => {
        this.logger.error('whatsapp', 'handler threw; swallowed to keep 200', {
          from: message.from,
          error: err.message,
        });
      });

    return { status: 'ok' };
  }
}
