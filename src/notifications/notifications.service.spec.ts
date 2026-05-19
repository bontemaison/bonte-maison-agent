import { ConfigService } from '@nestjs/config';
import { BookingRulesService } from '../booking-rules/booking-rules.service';
import {
  ConversationService,
  CrmSnapshot,
} from '../conversation/conversation.service';
import { LoggerService } from '../logger/logger.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from './email.service';
import { NotificationsService } from './notifications.service';

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeWhatsapp = (
  templateImpl?: jest.Mock,
  messageImpl?: jest.Mock,
): WhatsappService =>
  ({
    sendMessage: messageImpl ?? jest.fn().mockResolvedValue(undefined),
    sendTemplate: templateImpl ?? jest.fn().mockResolvedValue(undefined),
  }) as unknown as WhatsappService;

const makeEmail = (impl?: jest.Mock): EmailService =>
  ({
    isConfigured: jest.fn().mockReturnValue(true),
    send: impl ?? jest.fn().mockResolvedValue(undefined),
  }) as unknown as EmailService;

const DEFAULT_CONFIG = { OWNER_WHATSAPP_TEMPLATE: 'owner_notification' };

const makeConfig = (
  values: Record<string, string | undefined>,
): ConfigService =>
  ({
    get: (key: string) => ({ ...DEFAULT_CONFIG, ...values })[key],
  }) as unknown as ConfigService;

const makeBookingRules = (
  overrides: { phoneEnabled?: boolean; emailEnabled?: boolean } = {},
): BookingRulesService =>
  ({
    isOwnerPhoneNotifyEnabled: jest
      .fn()
      .mockResolvedValue(overrides.phoneEnabled ?? true),
    isOwnerEmailNotifyEnabled: jest
      .fn()
      .mockResolvedValue(overrides.emailEnabled ?? true),
  }) as unknown as BookingRulesService;

const makeConversation = (
  snapshot: CrmSnapshot | null = null,
): ConversationService =>
  ({
    getCrmSnapshot: jest.fn().mockResolvedValue(snapshot),
  }) as unknown as ConversationService;

describe('NotificationsService', () => {
  it('sends to both WhatsApp (via template) and email when both are configured', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000', OWNER_EMAIL: 'jim@example.com' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules(),
      makeLogger(),
    );

    await svc.notifyOwner('discount asked', {
      reason: 'discount_request',
      from: '447111',
      message: 'any chance of 10% off?',
    });

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '447000',
      'owner_notification',
      { '1': 'discount asked' },
      { override: true },
    );
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jim@example.com',
        subject: expect.stringContaining('discount_request'),
        body: expect.stringContaining('any chance of 10% off?'),
      }),
    );
  });

  it('skips WhatsApp when owner_notify_phone_enabled is false (email still fires)', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000', OWNER_EMAIL: 'jim@example.com' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules({ phoneEnabled: false }),
      makeLogger(),
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
  });

  it('skips email when owner_notify_email_enabled is false (WhatsApp still fires)', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000', OWNER_EMAIL: 'jim@example.com' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules({ emailEnabled: false }),
      makeLogger(),
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('skips WhatsApp when OWNER_PHONE env is not set', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({ OWNER_EMAIL: 'jim@example.com' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules(),
      makeLogger(),
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
  });

  it('skips email when OWNER_EMAIL env is not set', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules(),
      makeLogger(),
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('skips WhatsApp when OWNER_WHATSAPP_TEMPLATE is not configured', async () => {
    const whatsapp = makeWhatsapp();
    const logger = makeLogger();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000', OWNER_WHATSAPP_TEMPLATE: undefined }),
      whatsapp,
      makeEmail(),
      makeConversation(),
      makeBookingRules(),
      logger,
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'notifications',
      'OWNER_WHATSAPP_TEMPLATE not configured; skipping WhatsApp delivery',
    );
  });

  it('does nothing when neither channel is configured', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({}),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules(),
      makeLogger(),
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not throw if WhatsApp delivery fails — email still sent', async () => {
    const whatsapp = makeWhatsapp(
      jest.fn().mockRejectedValue(new Error('whatsapp down')),
    );
    const email = makeEmail();
    const logger = makeLogger();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000', OWNER_EMAIL: 'jim@example.com' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules(),
      logger,
    );

    await expect(svc.notifyOwner('hi')).resolves.toBeUndefined();
    expect(email.send).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'notifications',
      'whatsapp delivery failed',
      expect.any(Object),
    );
  });

  it('does not throw if email delivery fails — WhatsApp still sent', async () => {
    const whatsapp = makeWhatsapp();
    const email = makeEmail(
      jest.fn().mockRejectedValue(new Error('smtp down')),
    );
    const logger = makeLogger();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000', OWNER_EMAIL: 'jim@example.com' }),
      whatsapp,
      email,
      makeConversation(),
      makeBookingRules(),
      logger,
    );

    await expect(svc.notifyOwner('hi')).resolves.toBeUndefined();
    expect(whatsapp.sendTemplate).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'notifications',
      'email delivery failed',
      expect.any(Object),
    );
  });

  it('defaults to enabled and warns when the enable-flag read throws', async () => {
    const whatsapp = makeWhatsapp();
    const bookingRules = {
      isOwnerPhoneNotifyEnabled: jest
        .fn()
        .mockRejectedValue(new Error('airtable down')),
      isOwnerEmailNotifyEnabled: jest.fn().mockResolvedValue(true),
    } as unknown as BookingRulesService;
    const logger = makeLogger();
    const svc = new NotificationsService(
      makeConfig({ OWNER_PHONE: '447000' }),
      whatsapp,
      makeEmail(),
      makeConversation(),
      bookingRules,
      logger,
    );

    await svc.notifyOwner('hi');

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '447000',
      'owner_notification',
      { '1': 'hi' },
      { override: true },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'notifications',
      'phone-enable flag read failed; defaulting to enabled',
      expect.any(Object),
    );
  });

  it('includes context fields in the email body', async () => {
    const email = makeEmail();
    const svc = new NotificationsService(
      makeConfig({ OWNER_EMAIL: 'jim@example.com' }),
      makeWhatsapp(),
      email,
      makeConversation(),
      makeBookingRules(),
      makeLogger(),
    );

    await svc.notifyOwner('hold conflict', {
      reason: 'hold_conflict',
      from: '447111',
      intent: 'availability_inquiry',
      extra: { dates: '2027-07-11 → 2027-07-18' },
    });

    const call = (email.send as jest.Mock).mock.calls[0][0];
    expect(call.body).toContain('hold conflict');
    expect(call.body).toContain('From: 447111');
    expect(call.body).toContain('Intent: availability_inquiry');
    expect(call.body).toContain('dates: 2027-07-11 → 2027-07-18');
  });

  describe('notifyOwnerAboutConversation', () => {
    const snapshot: CrmSnapshot = {
      customerName: 'Sarah Jenkins',
      email: 'sarah@example.com',
      status: 'bot',
      lifecycleStatus: 'Responded',
      lastIntent: 'pricing_inquiry',
      datesRequested: '2027-07-11 → 2027-07-18',
      priceQuoted: 3400,
      availabilityResult: 'available',
      followUpCount: 0,
    };

    it('composes a structured block from the CRM snapshot', async () => {
      const whatsapp = makeWhatsapp();
      const email = makeEmail();
      const svc = new NotificationsService(
        makeConfig({ OWNER_PHONE: '447000', OWNER_EMAIL: 'jim@example.com' }),
        whatsapp,
        email,
        makeConversation(snapshot),
        makeBookingRules(),
        makeLogger(),
      );

      await svc.notifyOwnerAboutConversation('447111', 'discount_request', {
        message: 'any chance of a discount?',
      });

      const waText = (whatsapp.sendTemplate as jest.Mock).mock.calls[0][2]['1'];
      expect(waText).toContain('Discount request');
      expect(waText).toContain('Sarah Jenkins (447111)');
      expect(waText).toContain('Status: Responded');
      expect(waText).toContain('Last intent: pricing_inquiry');
      expect(waText).toContain('Dates: 2027-07-11 → 2027-07-18');
      expect(waText).toContain('Quote: £3,400');
      expect(waText).toContain('available');
      expect(waText).toContain('Email: sarah@example.com');
      expect(waText).toContain('Message: "any chance of a discount?"');

      const call = (email.send as jest.Mock).mock.calls[0][0];
      expect(call.subject).toContain('Sarah Jenkins');
    });

    it('falls back to phone-only when CRM has no row', async () => {
      const whatsapp = makeWhatsapp();
      const svc = new NotificationsService(
        makeConfig({ OWNER_PHONE: '447000' }),
        whatsapp,
        makeEmail(),
        makeConversation(null),
        makeBookingRules(),
        makeLogger(),
      );

      await svc.notifyOwnerAboutConversation('447111', 'unclear_or_off_topic');

      const waText = (whatsapp.sendTemplate as jest.Mock).mock.calls[0][2]['1'];
      expect(waText).toContain('Guest: 447111');
      expect(waText).toContain('Unclear / off-topic');
    });

    it('still delivers when CRM read throws', async () => {
      const whatsapp = makeWhatsapp();
      const conversation = {
        getCrmSnapshot: jest.fn().mockRejectedValue(new Error('airtable down')),
      } as unknown as ConversationService;
      const logger = makeLogger();
      const svc = new NotificationsService(
        makeConfig({ OWNER_PHONE: '447000' }),
        whatsapp,
        makeEmail(),
        conversation,
        makeBookingRules(),
        logger,
      );

      await svc.notifyOwnerAboutConversation('447111', 'discount_request');

      expect(whatsapp.sendTemplate).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'notifications',
        'CRM snapshot fetch failed',
        expect.any(Object),
      );
    });
  });
});
