import axios from 'axios';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger/logger.service';
import { CloudApiProvider } from './cloud-api.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeConfig = (overrides: Record<string, string | undefined> = {}): ConfigService =>
  ({
    get: (key: string) => {
      const defaults: Record<string, string> = {
        WHATSAPP_PHONE_NUMBER_ID: 'phone-id-123',
        WHATSAPP_ACCESS_TOKEN: 'access-token',
        WHATSAPP_APP_SECRET: 'app-secret',
        WHATSAPP_VERIFY_TOKEN: 'verify-token',
      };
      return key in overrides ? overrides[key] : defaults[key];
    },
  }) as unknown as ConfigService;

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const sign = (raw: Buffer, secret = 'app-secret') =>
  'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

describe('CloudApiProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('construction', () => {
    it('throws when WHATSAPP_PHONE_NUMBER_ID is missing', () => {
      expect(
        () => new CloudApiProvider(makeConfig({ WHATSAPP_PHONE_NUMBER_ID: undefined }), makeLogger()),
      ).toThrow();
    });

    it('throws when WHATSAPP_ACCESS_TOKEN is missing', () => {
      expect(
        () => new CloudApiProvider(makeConfig({ WHATSAPP_ACCESS_TOKEN: undefined }), makeLogger()),
      ).toThrow();
    });
  });

  describe('sendMessage', () => {
    it('POSTs text payload with auth header', async () => {
      mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
      const provider = new CloudApiProvider(makeConfig(), makeLogger());

      await provider.sendMessage('628123456789', 'hello');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('phone-id-123/messages'),
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '628123456789',
          type: 'text',
          text: { body: 'hello' },
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        }),
      );
    });

    it('logs the sent message id', async () => {
      mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.abc' }] } });
      const logger = makeLogger();
      const provider = new CloudApiProvider(makeConfig(), logger);

      await provider.sendMessage('628', 'hi');

      expect(logger.info).toHaveBeenCalledWith(
        'whatsapp',
        expect.stringContaining('sent'),
        expect.objectContaining({ to: '628', id: 'wamid.abc' }),
      );
    });

    it('retries once on 429 and succeeds', async () => {
      const err = Object.assign(new Error('rate limited'), {
        response: { status: 429 },
        isAxiosError: true,
      });
      mockedAxios.post
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.retry' }] } });
      jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);
      const logger = makeLogger();
      const provider = new CloudApiProvider(makeConfig(), logger);

      await provider.sendMessage('628', 'hi');

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp',
        expect.stringContaining('retry'),
        expect.any(Object),
      );
    });

    it('logs and rethrows non-retryable errors', async () => {
      const err = Object.assign(new Error('bad token'), {
        response: { status: 401, data: { error: { message: 'unauthorized' } } },
        isAxiosError: true,
      });
      mockedAxios.post.mockRejectedValue(err);
      const logger = makeLogger();
      const provider = new CloudApiProvider(makeConfig(), logger);

      await expect(provider.sendMessage('628', 'hi')).rejects.toThrow('bad token');
      expect(logger.error).toHaveBeenCalledWith(
        'whatsapp',
        expect.stringContaining('send failed'),
        expect.objectContaining({ to: '628', status: 401 }),
      );
    });
  });

  describe('sendTemplate', () => {
    it('POSTs a template payload with body parameters', async () => {
      mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.t1' }] } });
      const provider = new CloudApiProvider(makeConfig(), makeLogger());

      await provider.sendTemplate('628', 'availability_yes', { dates: '15-20 June', price: '£1400' });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('phone-id-123/messages'),
        expect.objectContaining({
          type: 'template',
          template: expect.objectContaining({
            name: 'availability_yes',
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: '15-20 June' },
                  { type: 'text', text: '£1400' },
                ],
              },
            ],
          }),
        }),
        expect.any(Object),
      );
    });

    it('sends template with no components when vars is empty', async () => {
      mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.t2' }] } });
      const provider = new CloudApiProvider(makeConfig(), makeLogger());

      await provider.sendTemplate('628', 'greeting', {});

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: expect.objectContaining({ components: [] }),
        }),
        expect.any(Object),
      );
    });
  });

  describe('parseWebhook', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  { from: '628123456789', id: 'wamid.abc', type: 'text', text: { body: 'hello' } },
                ],
              },
            },
          ],
        },
      ],
    };

    it('extracts the first text message', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      expect(provider.parseWebhook(payload)).toEqual({
        from: '628123456789',
        text: 'hello',
        id: 'wamid.abc',
      });
    });

    it('returns null for non-message events (status callbacks)', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const statusPayload = { entry: [{ changes: [{ value: { statuses: [{}] } }] }] };
      expect(provider.parseWebhook(statusPayload)).toBeNull();
    });

    it('returns null for non-text messages', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const audioPayload = {
        entry: [{ changes: [{ value: { messages: [{ from: '628', type: 'audio' }] } }] }],
      };
      expect(provider.parseWebhook(audioPayload)).toBeNull();
    });

    it('ignores Coexistence smb_message_echoes events (owner-sent)', () => {
      // Without the field filter, the bot would misread Jim's own outbound
      // reply as a fresh customer inbound from Jim's number.
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const echoPayload = {
        entry: [
          {
            changes: [
              {
                field: 'smb_message_echoes',
                value: {
                  message_echoes: [
                    {
                      from: '447111222333',
                      to: '628123456789',
                      id: 'wamid.echo',
                      type: 'text',
                      text: { body: 'hi, this is jim' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      expect(provider.parseWebhook(echoPayload)).toBeNull();
    });
  });

  describe('parseOutboundEcho', () => {
    it('extracts the owner echo from an smb_message_echoes event', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'smb_message_echoes',
                value: {
                  message_echoes: [
                    {
                      from: '447111222333',
                      to: '628123456789',
                      id: 'wamid.echo',
                      type: 'text',
                      text: { body: 'hi, this is jim' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      expect(provider.parseOutboundEcho(payload)).toEqual({
        to: '628123456789',
        text: 'hi, this is jim',
        id: 'wamid.echo',
      });
    });

    it('returns null for a normal inbound messages event', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    { from: '628', id: 'wamid.in', type: 'text', text: { body: 'hi' } },
                  ],
                },
              },
            ],
          },
        ],
      };
      expect(provider.parseOutboundEcho(payload)).toBeNull();
    });

    it('returns null for a non-text echo (image, etc.)', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'smb_message_echoes',
                value: { message_echoes: [{ from: '447', to: '628', id: 'wamid.img', type: 'image' }] },
              },
            ],
          },
        ],
      };
      expect(provider.parseOutboundEcho(payload)).toBeNull();
    });

    it('returns null for an unrecognised payload shape', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      expect(provider.parseOutboundEcho({})).toBeNull();
    });
  });

  describe('Graph API version', () => {
    it('defaults to v25.0 when WHATSAPP_GRAPH_VERSION is unset', async () => {
      mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.v' }] } });
      const provider = new CloudApiProvider(makeConfig(), makeLogger());

      await provider.sendMessage('628', 'hi');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/v25.0/phone-id-123/messages'),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('honours WHATSAPP_GRAPH_VERSION override', async () => {
      mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.v' }] } });
      const provider = new CloudApiProvider(
        makeConfig({ WHATSAPP_GRAPH_VERSION: 'v23.0' }),
        makeLogger(),
      );

      await provider.sendMessage('628', 'hi');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/v23.0/phone-id-123/messages'),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('validateWebhookSignature', () => {
    it('accepts a valid HMAC signature', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const raw = Buffer.from('{"test":1}');
      expect(
        provider.validateWebhookSignature(raw, { 'x-hub-signature-256': sign(raw) }),
      ).toBe(true);
    });

    it('rejects an incorrect signature', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      const raw = Buffer.from('{"test":1}');
      expect(
        provider.validateWebhookSignature(raw, { 'x-hub-signature-256': sign(raw, 'wrong') }),
      ).toBe(false);
    });

    it('rejects when the signature header is missing', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      expect(provider.validateWebhookSignature(Buffer.from('{}'), {})).toBe(false);
    });

    it('returns true unconditionally when WHATSAPP_SKIP_SIGNATURE_CHECK=true', () => {
      const logger = makeLogger();
      const provider = new CloudApiProvider(
        makeConfig({ WHATSAPP_SKIP_SIGNATURE_CHECK: 'true' }),
        logger,
      );
      expect(provider.validateWebhookSignature(Buffer.from('{}'), {})).toBe(true);
      expect(provider.validateWebhookSignature(Buffer.from('{}'), {
        'x-hub-signature-256': 'sha256=wrong',
      })).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp',
        expect.stringContaining('WHATSAPP_SKIP_SIGNATURE_CHECK'),
        expect.any(Object),
      );
    });
  });

  describe('verifyWebhook', () => {
    it('returns the challenge when mode and token match', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      expect(provider.verifyWebhook('subscribe', 'verify-token', 'challenge-xyz')).toBe(
        'challenge-xyz',
      );
    });

    it('throws when the token does not match', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      expect(() => provider.verifyWebhook('subscribe', 'wrong', 'c')).toThrow();
    });

    it('throws when the mode is not subscribe', () => {
      const provider = new CloudApiProvider(makeConfig(), makeLogger());
      expect(() => provider.verifyWebhook('unsubscribe', 'verify-token', 'c')).toThrow();
    });
  });
});
