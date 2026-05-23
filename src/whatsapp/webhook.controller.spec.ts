import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { LoggerService } from '../logger/logger.service';
import { MessageHandlerService } from '../orchestrator/message-handler.service';
import { WhatsappService } from './whatsapp.service';
import { WebhookController } from './webhook.controller';

const makeHandler = (): MessageHandlerService =>
  ({
    handle: jest.fn().mockResolvedValue(undefined),
    handleOwnerTakeover: jest.fn().mockResolvedValue(undefined),
  }) as unknown as MessageHandlerService;

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeWhatsapp = (
  overrides: Partial<{
    verifyWebhook: (mode: string, token: string, challenge: string) => string;
    validateWebhookSignature: () => boolean;
    parseWebhook: (p: unknown) => { from: string; text: string; id?: string } | null;
    parseOutboundEcho: (p: unknown) => { to: string; text: string; id?: string } | null;
    wasRecentlySentByBot: (id: string) => boolean;
  }> = {},
): WhatsappService =>
  ({
    verifyWebhook: overrides.verifyWebhook ?? ((_m, _t, c) => c),
    validateWebhookSignature: overrides.validateWebhookSignature ?? (() => true),
    debugSignature: () => null,
    parseWebhook: overrides.parseWebhook ?? (() => null),
    parseOutboundEcho: overrides.parseOutboundEcho ?? (() => null),
    wasRecentlySentByBot: overrides.wasRecentlySentByBot ?? (() => false),
  }) as unknown as WhatsappService;

const asReq = (raw?: Buffer): Request => ({ rawBody: raw } as unknown as Request);

const samplePayload = {
  entry: [
    {
      changes: [
        {
          value: {
            messages: [{ from: '628123456789', id: 'wamid.abc', type: 'text', text: { body: 'hello' } }],
          },
        },
      ],
    },
  ],
};

describe('WebhookController (verification)', () => {
  it('returns the challenge when provider accepts', () => {
    const ctrl = new WebhookController(makeLogger(), makeHandler(), makeWhatsapp());
    expect(ctrl.verify('subscribe', 'tok', 'challenge-123')).toBe('challenge-123');
  });

  it('throws ForbiddenException when provider rejects', () => {
    const whatsapp = makeWhatsapp({ verifyWebhook: () => { throw new Error('bad token'); } });
    const ctrl = new WebhookController(makeLogger(), makeHandler(), whatsapp);
    expect(() => ctrl.verify('subscribe', 'wrong', 'c')).toThrow(ForbiddenException);
  });
});

describe('WebhookController (incoming POST)', () => {
  it('returns ok and dispatches the parsed message', async () => {
    const raw = Buffer.from(JSON.stringify(samplePayload));
    const handler = makeHandler();
    const logger = makeLogger();
    const whatsapp = makeWhatsapp({
      parseWebhook: () => ({ from: '628123456789', text: 'hello', id: 'wamid.abc' }),
    });
    const ctrl = new WebhookController(logger, handler, whatsapp);

    const out = await ctrl.receive(asReq(raw), 'sha256=valid', undefined, samplePayload);

    expect(out).toEqual({ status: 'ok' });
    expect(logger.info).toHaveBeenCalledWith(
      'whatsapp',
      expect.stringContaining('received'),
      expect.objectContaining({ from: '628123456789', text: 'hello' }),
    );
    expect(handler.handle).toHaveBeenCalledWith({ from: '628123456789', text: 'hello' });
  });

  it('returns ok without dispatching when signature is invalid', async () => {
    const raw = Buffer.from('{}');
    const handler = makeHandler();
    const logger = makeLogger();
    const whatsapp = makeWhatsapp({ validateWebhookSignature: () => false });
    const ctrl = new WebhookController(logger, handler, whatsapp);

    const out = await ctrl.receive(asReq(raw), 'sha256=bad', undefined, {});

    expect(out).toEqual({ status: 'ok' });
    expect(handler.handle).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp',
      expect.stringContaining('signature'),
      expect.any(Object),
    );
  });

  it('returns ok without dispatching when rawBody is missing', async () => {
    const handler = makeHandler();
    const ctrl = new WebhookController(makeLogger(), handler, makeWhatsapp());

    const out = await ctrl.receive(asReq(undefined), 'sha256=x', undefined, {});

    expect(out).toEqual({ status: 'ok' });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('returns ok and does not dispatch when parseWebhook returns null (status callback)', async () => {
    const raw = Buffer.from('{}');
    const handler = makeHandler();
    const ctrl = new WebhookController(makeLogger(), handler, makeWhatsapp({ parseWebhook: () => null }));

    const out = await ctrl.receive(asReq(raw), 'sha256=x', undefined, {});

    expect(out).toEqual({ status: 'ok' });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('dispatches a takeover when the echo is not bot-originated', async () => {
    const raw = Buffer.from('{}');
    const handler = makeHandler();
    const whatsapp = makeWhatsapp({
      parseWebhook: () => null,
      parseOutboundEcho: () => ({ to: '628777', text: 'hi', id: 'echo-1' }),
      wasRecentlySentByBot: () => false,
    });
    const ctrl = new WebhookController(makeLogger(), handler, whatsapp);

    const out = await ctrl.receive(asReq(raw), undefined, 'wati-token', {});

    expect(out).toEqual({ status: 'ok' });
    expect(handler.handleOwnerTakeover).toHaveBeenCalledWith('628777');
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('ignores echo when the bot itself sent the message', async () => {
    const raw = Buffer.from('{}');
    const handler = makeHandler();
    const whatsapp = makeWhatsapp({
      parseWebhook: () => null,
      parseOutboundEcho: () => ({ to: '628777', text: 'hi', id: 'echo-1' }),
      wasRecentlySentByBot: (id: string) => id === 'echo-1',
    });
    const ctrl = new WebhookController(makeLogger(), handler, whatsapp);

    await ctrl.receive(asReq(raw), undefined, 'wati-token', {});

    expect(handler.handleOwnerTakeover).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('swallows handler errors to always return 200', async () => {
    const raw = Buffer.from('{}');
    const handler = makeHandler();
    (handler.handle as jest.Mock).mockRejectedValue(new Error('boom'));
    const whatsapp = makeWhatsapp({
      parseWebhook: () => ({ from: '628', text: 'hi' }),
    });
    const ctrl = new WebhookController(makeLogger(), handler, whatsapp);

    await expect(ctrl.receive(asReq(raw), undefined, undefined, {})).resolves.toEqual({
      status: 'ok',
    });
  });
});
