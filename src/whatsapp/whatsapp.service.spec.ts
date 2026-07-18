import { ConfigService } from '@nestjs/config';
import { ConversationService } from '../conversation/conversation.service';
import { LoggerService } from '../logger/logger.service';
import { WhatsAppProvider } from './providers/provider.interface';
import { computeTypingDelayMs, WhatsappService } from './whatsapp.service';

const makeProvider = (): jest.Mocked<WhatsAppProvider> => ({
  sendMessage: jest.fn().mockResolvedValue({}),
  sendTemplate: jest.fn().mockResolvedValue({}),
  parseWebhook: jest.fn().mockReturnValue(null),
  parseOutboundEcho: jest.fn().mockReturnValue(null),
  validateWebhookSignature: jest.fn().mockReturnValue(true),
  verifyWebhook: jest.fn().mockReturnValue('challenge'),
  assignToHuman: jest.fn().mockResolvedValue(undefined),
});

const makeConversation = (canSend = true): ConversationService =>
  ({ canSendBot: jest.fn().mockResolvedValue(canSend) }) as unknown as ConversationService;

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeConfig = (verifyToken: string | undefined): ConfigService =>
  ({ get: jest.fn().mockReturnValue(verifyToken) }) as unknown as ConfigService;

const makeService = (
  provider: WhatsAppProvider,
  canSend = true,
  verifyToken: string | undefined = 'tok',
): WhatsappService =>
  new WhatsappService(
    provider,
    makeLogger(),
    makeConversation(canSend),
    makeConfig(verifyToken),
  );

const makeServiceNoToken = (provider: WhatsAppProvider): WhatsappService =>
  new WhatsappService(provider, makeLogger(), makeConversation(), makeConfig(undefined));

describe('WhatsappService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  // sendMessage sleeps through a typing delay before hitting the provider;
  // run all fake timers so the send promise can settle.
  const flushSend = async (p: Promise<void>): Promise<void> => {
    await jest.runAllTimersAsync();
    await p;
  };

  describe('computeTypingDelayMs', () => {
    it('clamps short replies to the minimum delay', () => {
      expect(computeTypingDelayMs('Thanks, Jim')).toBe(2000);
    });

    it('scales with reply length between the clamps', () => {
      expect(computeTypingDelayMs('a'.repeat(100))).toBe(5000);
    });

    it('clamps long replies to the maximum delay', () => {
      expect(computeTypingDelayMs('a'.repeat(1000))).toBe(10000);
    });
  });

  describe('sendMessage', () => {
    it('delegates to the provider when conversation is in bot mode', async () => {
      const provider = makeProvider();
      await flushSend(makeService(provider).sendMessage('628', 'hello'));
      expect(provider.sendMessage).toHaveBeenCalledWith('628', 'hello');
    });

    it('waits a length-scaled typing delay before handing to the provider', async () => {
      const provider = makeProvider();
      const send = makeService(provider).sendMessage('628', 'hello');
      const delay = computeTypingDelayMs('hello');

      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(provider.sendMessage).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await send;
      expect(provider.sendMessage).toHaveBeenCalledWith('628', 'hello');
    });

    it('skips the send when conversation is not in bot mode', async () => {
      const provider = makeProvider();
      const logger = makeLogger();
      const service = new WhatsappService(provider, logger, makeConversation(false), makeConfig('tok'));

      await service.sendMessage('628', 'hi');

      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp',
        expect.stringContaining('skipped'),
        expect.objectContaining({ to: '628' }),
      );
    });

    it('bypasses the pause check when override=true', async () => {
      const provider = makeProvider();
      await flushSend(makeService(provider, false).sendMessage('628', 'hi', { override: true }));
      expect(provider.sendMessage).toHaveBeenCalled();
    });
  });

  describe('sendTemplate', () => {
    it('delegates to the provider when in bot mode', async () => {
      const provider = makeProvider();
      await makeService(provider).sendTemplate('628', 'tmpl', { a: '1' });
      expect(provider.sendTemplate).toHaveBeenCalledWith('628', 'tmpl', { a: '1' });
    });

    it('skips when not in bot mode', async () => {
      const provider = makeProvider();
      await makeService(provider, false).sendTemplate('628', 'tmpl', {});
      expect(provider.sendTemplate).not.toHaveBeenCalled();
    });

    it('bypasses pause check with override=true', async () => {
      const provider = makeProvider();
      await makeService(provider, false).sendTemplate('628', 'tmpl', {}, { override: true });
      expect(provider.sendTemplate).toHaveBeenCalled();
    });
  });

  describe('assignToHuman', () => {
    it('delegates to the provider', async () => {
      const provider = makeProvider();
      await makeService(provider).assignToHuman('conv-1');
      expect(provider.assignToHuman).toHaveBeenCalledWith('conv-1');
    });

    it('is a no-op when the provider does not support assignToHuman', async () => {
      const provider = makeProvider();
      delete (provider as Partial<typeof provider>).assignToHuman;
      await expect(makeService(provider).assignToHuman('conv-1')).resolves.not.toThrow();
    });
  });

  describe('parseWebhook', () => {
    it('delegates to the provider', () => {
      const provider = makeProvider();
      const msg = { from: '628', text: 'hi', id: '1' };
      provider.parseWebhook.mockReturnValue(msg);
      expect(makeService(provider).parseWebhook({ raw: true })).toBe(msg);
    });
  });

  describe('parseOutboundEcho', () => {
    it('delegates to the provider when supported', () => {
      const provider = makeProvider();
      const echo = { to: '628', text: 'hi', id: 'e1' };
      (provider.parseOutboundEcho as jest.Mock).mockReturnValue(echo);
      expect(makeService(provider).parseOutboundEcho({})).toBe(echo);
    });

    it('returns null when the provider does not support echoes', () => {
      const provider = makeProvider();
      delete (provider as Partial<typeof provider>).parseOutboundEcho;
      expect(makeService(provider).parseOutboundEcho({})).toBeNull();
    });
  });

  describe('wasRecentlySentByBot', () => {
    it('returns true for an id the bot just sent', async () => {
      const provider = makeProvider();
      provider.sendMessage.mockResolvedValue({ id: 'msg-1' });
      const service = makeService(provider);

      await flushSend(service.sendMessage('628', 'hi'));

      expect(service.wasRecentlySentByBot('msg-1')).toBe(true);
    });

    it('returns false for an unknown id', () => {
      expect(makeService(makeProvider()).wasRecentlySentByBot('nope')).toBe(false);
    });

    it('tracks ids from sendTemplate too', async () => {
      const provider = makeProvider();
      provider.sendTemplate.mockResolvedValue({ id: 'tmpl-1' });
      const service = makeService(provider);

      await service.sendTemplate('628', 'k', {});

      expect(service.wasRecentlySentByBot('tmpl-1')).toBe(true);
    });
  });

  describe('validateWebhookSignature', () => {
    it('delegates to the provider', () => {
      const provider = makeProvider();
      provider.validateWebhookSignature.mockReturnValue(false);
      expect(makeService(provider).validateWebhookSignature(Buffer.from('{}'), {})).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    it('returns the challenge when mode and token match the env var', () => {
      expect(makeService(makeProvider(), true, 'tok').verifyWebhook('subscribe', 'tok', 'xyz')).toBe(
        'xyz',
      );
    });

    it('throws when the token does not match', () => {
      expect(() =>
        makeService(makeProvider(), true, 'tok').verifyWebhook('subscribe', 'wrong', 'c'),
      ).toThrow();
    });

    it('throws when mode is not subscribe', () => {
      expect(() =>
        makeService(makeProvider(), true, 'tok').verifyWebhook('unsubscribe', 'tok', 'c'),
      ).toThrow();
    });

    it('throws when WHATSAPP_VERIFY_TOKEN is not configured', () => {
      expect(() =>
        makeServiceNoToken(makeProvider()).verifyWebhook('subscribe', 'tok', 'c'),
      ).toThrow();
    });
  });
});
