import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import { LoggerService } from '../../logger/logger.service';
import {
  IncomingMessage,
  OutboundEcho,
  SendResult,
  SignatureDebug,
  WhatsAppProvider,
} from './provider.interface';

const DEFAULT_GRAPH_VERSION = 'v25.0';
const RETRY_DELAY_MS = 500;

type CloudApiMessage = {
  from?: string;
  to?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
};

type CloudApiPayload = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: CloudApiMessage[];
      };
    }>;
  }>;
};

@Injectable()
export class CloudApiProvider implements WhatsAppProvider {
  private readonly url: string;
  private readonly accessToken: string;
  private readonly appSecret: string;
  private readonly verifyToken: string;
  private readonly skipSignatureCheck: boolean;

  constructor(
    config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const phoneId = config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const token = config.get<string>('WHATSAPP_ACCESS_TOKEN');
    if (!phoneId || !token) {
      throw new Error('WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must be set');
    }
    const version = config.get<string>('WHATSAPP_GRAPH_VERSION') ?? DEFAULT_GRAPH_VERSION;
    this.url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    this.accessToken = token;
    this.appSecret = config.get<string>('WHATSAPP_APP_SECRET') ?? '';
    this.verifyToken = config.get<string>('WHATSAPP_VERIFY_TOKEN') ?? '';
    // Escape hatch for Dualhook-style Webhook Override setups where Meta
    // signs with a BSP-owned app secret we can never obtain. Set this only
    // when you've compensated with a hard-to-guess URL path and ideally an
    // IP allowlist for Meta's webhook ranges — otherwise the endpoint is
    // open to forged payloads.
    this.skipSignatureCheck =
      (config.get<string>('WHATSAPP_SKIP_SIGNATURE_CHECK') ?? '').toLowerCase() === 'true';
    if (this.skipSignatureCheck) {
      this.logger.warn(
        'whatsapp',
        'WHATSAPP_SKIP_SIGNATURE_CHECK=true — webhook HMAC verification is DISABLED',
        {},
      );
    }
  }

  async sendMessage(to: string, text: string): Promise<SendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    };
    try {
      const res = await this.post(payload);
      const id = res.data?.messages?.[0]?.id;
      this.logger.info('whatsapp', 'sent message', { to, id });
      return { id };
    } catch (err) {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      this.logger.error('whatsapp', 'send failed', {
        to,
        status: ax.response?.status,
        error: ax.response?.data?.error?.message ?? ax.message,
      });
      throw err;
    }
  }

  async sendTemplate(
    to: string,
    templateName: string,
    vars: Record<string, string>,
  ): Promise<SendResult> {
    const components = Object.keys(vars).length
      ? [
          {
            type: 'body',
            parameters: Object.values(vars).map((v) => ({ type: 'text', text: v })),
          },
        ]
      : [];
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components,
      },
    };
    try {
      const res = await this.post(payload);
      const id = res.data?.messages?.[0]?.id;
      this.logger.info('whatsapp', 'sent template', { to, templateName, id });
      return { id };
    } catch (err) {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      this.logger.error('whatsapp', 'template send failed', {
        to,
        templateName,
        status: ax.response?.status,
        error: ax.response?.data?.error?.message ?? ax.message,
      });
      throw err;
    }
  }

  parseWebhook(payload: unknown): IncomingMessage | null {
    const body = payload as CloudApiPayload;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // Coexistence delivers owner-sent echoes under `smb_message_echoes`
        // with the same `value.messages[]` shape — skip them here and let
        // parseOutboundEcho handle them.
        if (change.field && change.field !== 'messages') continue;
        const contacts = change.value?.contacts ?? [];
        for (const msg of change.value?.messages ?? []) {
          if (msg.type === 'text' && msg.from && msg.text?.body) {
            const contact = contacts.find((c) => c.wa_id === msg.from);
            const profileName = contact?.profile?.name?.trim() || undefined;
            return {
              from: msg.from,
              text: msg.text.body,
              id: msg.id,
              profileName,
            };
          }
        }
      }
    }
    return null;
  }

  // Coexistence: messages Jim sends from his WhatsApp Business app are mirrored
  // back to us with `field: 'smb_message_echoes'`. `from` is Jim's number,
  // `to` is the customer's. We treat any such echo as a human takeover.
  parseOutboundEcho(payload: unknown): OutboundEcho | null {
    const body = payload as CloudApiPayload;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'smb_message_echoes') continue;
        for (const msg of change.value?.messages ?? []) {
          if (msg.type === 'text' && msg.to && msg.text?.body) {
            return { to: msg.to, text: msg.text.body, id: msg.id };
          }
        }
      }
    }
    return null;
  }

  validateWebhookSignature(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    if (this.skipSignatureCheck) return true;
    const header = headers['x-hub-signature-256'];
    if (!header || !this.appSecret) return false;
    const expected =
      'sha256=' + crypto.createHmac('sha256', this.appSecret).update(raw).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const givenBuf = Buffer.from(header);
    if (expectedBuf.length !== givenBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, givenBuf);
  }

  debugSignature(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): SignatureDebug {
    const received = headers['x-hub-signature-256'];
    const expected = this.appSecret
      ? 'sha256=' + crypto.createHmac('sha256', this.appSecret).update(raw).digest('hex')
      : undefined;
    return {
      received,
      expected,
      bodyLength: raw.length,
      appSecretConfigured: Boolean(this.appSecret),
    };
  }

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode !== 'subscribe' || token !== this.verifyToken) {
      throw new Error('verification failed');
    }
    return challenge;
  }

  private async post(
    payload: unknown,
  ): Promise<{ data: { messages?: Array<{ id?: string }> } }> {
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    try {
      return await axios.post(this.url, payload, { headers });
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status === 429) {
        this.logger.warn('whatsapp', 'rate limited, retrying once', {
          delayMs: RETRY_DELAY_MS,
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return await axios.post(this.url, payload, { headers });
      }
      throw err;
    }
  }
}
