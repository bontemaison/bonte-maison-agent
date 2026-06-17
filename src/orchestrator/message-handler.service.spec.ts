import { ConfigService } from '@nestjs/config';
import { AvailabilityService } from '../availability/availability.service';
import { BookingRulesService, RulesValidation } from '../booking-rules/booking-rules.service';
import { ComposerService } from '../composer/composer.service';
import { ConversationService } from '../conversation/conversation.service';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { FragmentsService } from '../fragments/fragments.service';
import { HelpersService } from '../helpers/helpers.service';
import { HoldsService } from '../holds/holds.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { LoggerService } from '../logger/logger.service';
import { MessageLogService } from '../messagelog/messagelog.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ParseResult, ParserService } from '../parser/parser.service';
import { PricingService } from '../pricing/pricing.service';
import { TemplatesService } from '../templates/templates.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MessageHandlerService } from './message-handler.service';

const OWNER = '628999000';
const CUSTOMER = '628777';

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const defaultParsed = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  intent: 'off_topic_or_unclear',
  confidence: 0.9,
  customerName: null,
  guestEmail: null,
  checkIn: null,
  checkOut: null,
  guests: null,
  mentionsDiscount: false,
  highIntentSignal: false,
  topicKeys: [],
  monthQuery: null,
  monthRangeQuery: null,
  needsGreeting: false,
  needsAcknowledgment: false,
  isCorrection: false,
  isClarificationOfPrevious: false,
  ...overrides,
});

const makeParser = (result: Partial<ParseResult> = {}): ParserService =>
  ({
    parse: jest.fn().mockResolvedValue(defaultParsed(result)),
  }) as unknown as ParserService;

const makeAvailability = (available = true): AvailabilityService =>
  ({
    isRangeAvailable: jest.fn().mockResolvedValue(available),
    findAvailableSundayWeeks: jest.fn().mockResolvedValue([]),
  }) as unknown as AvailabilityService;

const makePricing = (
  quote: unknown = {
    weeks: 1,
    nights: 7,
    weeklyRate: 2100,
    subtotal: 2100,
    total: 2100,
    minWeeks: 0,
    meetsMinWeeks: true,
  },
): PricingService =>
  ({
    calculate: jest.fn().mockResolvedValue(quote),
  }) as unknown as PricingService;

const makeTemplates = (text = 'rendered'): TemplatesService =>
  ({
    render: jest.fn().mockResolvedValue(text),
    fetchRaw: jest.fn().mockResolvedValue([]),
  }) as unknown as TemplatesService;

const makeComposer = (
  result: { ok: true; text: string } | { ok: false; reason: string; raw: string } = {
    ok: true,
    text: 'composed reply',
  },
): ComposerService =>
  ({
    compose: jest.fn().mockResolvedValue(result),
  }) as unknown as ComposerService;

const makeFragments = (): FragmentsService =>
  ({
    listAll: jest.fn().mockResolvedValue([]),
    listByCategory: jest.fn().mockResolvedValue([]),
    fetchByTopicKeys: jest.fn().mockResolvedValue([]),
  }) as unknown as FragmentsService;

const makeKnowledgeBase = (): KnowledgeBaseService =>
  ({
    listTopics: jest.fn().mockResolvedValue([]),
    render: jest.fn().mockResolvedValue(null),
  }) as unknown as KnowledgeBaseService;

const makeHelpers = (): HelpersService =>
  ({
    findClosestAvailableWeek: jest.fn().mockResolvedValue(null),
    monthAvailabilitySummary: jest.fn().mockResolvedValue([]),
    multiMonthAvailabilitySummary: jest.fn().mockResolvedValue([]),
    getPricingForDateRange: jest.fn().mockResolvedValue(null),
    checkExistingHold: jest.fn().mockResolvedValue(null),
  }) as unknown as HelpersService;

const makeWhatsapp = (): WhatsappService =>
  ({
    sendMessage: jest.fn().mockResolvedValue(undefined),
  }) as unknown as WhatsappService;

const makeConversation = (
  overrides: Partial<ConversationService> = {},
): ConversationService =>
  ({
    parseCommand: jest.fn().mockReturnValue(null),
    setStatus: jest.fn().mockResolvedValue(undefined),
    setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue({
      status: 'bot',
      lifecycleStatus: 'New',
      lastIntent: null,
      pendingDates: null,
      customerName: null,
    }),
    updateContext: jest.fn().mockResolvedValue(undefined),
    recordQuote: jest.fn().mockResolvedValue(undefined),
    getGlobalPaused: jest.fn().mockResolvedValue(false),
    setGlobalPaused: jest.fn().mockResolvedValue(undefined),
    statusCounts: jest
      .fn()
      .mockResolvedValue({ bot: 0, human: 0, paused: 0 }),
    ...overrides,
  }) as unknown as ConversationService;

const makeMessageLog = (): MessageLogService =>
  ({
    log: jest.fn().mockResolvedValue(undefined),
    recent: jest.fn().mockResolvedValue([]),
  }) as unknown as MessageLogService;

const makeConfig = (
  overrides: { owner?: string } = {},
): ConfigService => {
  const owner = 'owner' in overrides ? overrides.owner : OWNER;
  const values: Record<string, string | undefined> = {
    OWNER_PHONE: owner,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
};

const makeNotifications = (): NotificationsService =>
  ({
    notifyOwner: jest.fn().mockResolvedValue(undefined),
    notifyOwnerAboutConversation: jest.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationsService;

const makeBookingRules = (
  result: RulesValidation = { pass: true },
): BookingRulesService =>
  ({
    validate: jest.fn().mockResolvedValue(result),
    isYearFullyBooked: jest.fn().mockResolvedValue(false),
    isInstantBookEnabled: jest.fn().mockResolvedValue(false),
    recordOwnerEchoSeen: jest.fn().mockResolvedValue(undefined),
  }) as unknown as BookingRulesService;

const makeHolds = (hasOverlap = false): HoldsService =>
  ({
    hasOverlap: jest.fn().mockResolvedValue(hasOverlap),
    createHold: jest.fn().mockResolvedValue({
      id: 'rec1',
      fields: { hold_expires_at: new Date('2027-01-01').toISOString() },
    }),
  }) as unknown as HoldsService;

const makeFollowUps = (): FollowUpsService =>
  ({
    schedule: jest.fn().mockResolvedValue({ id: 'fu1', fields: {} }),
    cancel: jest.fn().mockResolvedValue(undefined),
  }) as unknown as FollowUpsService;

type Overrides = {
  parser?: ParserService;
  availability?: AvailabilityService;
  pricing?: PricingService;
  bookingRules?: BookingRulesService;
  holds?: HoldsService;
  followUps?: FollowUpsService;
  templates?: TemplatesService;
  composer?: ComposerService;
  fragments?: FragmentsService;
  knowledgeBase?: KnowledgeBaseService;
  helpers?: HelpersService;
  whatsapp?: WhatsappService;
  conversation?: ConversationService;
  messageLog?: MessageLogService;
  notifications?: NotificationsService;
  logger?: LoggerService;
  config?: ConfigService;
};

const build = (over: Overrides = {}) =>
  new MessageHandlerService(
    over.parser ?? makeParser(),
    over.availability ?? makeAvailability(),
    over.pricing ?? makePricing(),
    over.bookingRules ?? makeBookingRules(),
    over.holds ?? makeHolds(),
    over.followUps ?? makeFollowUps(),
    over.templates ?? makeTemplates(),
    over.composer ?? makeComposer(),
    over.fragments ?? makeFragments(),
    over.knowledgeBase ?? makeKnowledgeBase(),
    over.helpers ?? makeHelpers(),
    over.whatsapp ?? makeWhatsapp(),
    over.conversation ?? makeConversation(),
    over.messageLog ?? makeMessageLog(),
    over.notifications ?? makeNotifications(),
    over.logger ?? makeLogger(),
    over.config ?? makeConfig(),
  );

const SUN_CHECK_IN = new Date('2025-07-06');
const SUN_CHECK_OUT = new Date('2025-07-13');

const composerCalls = (composer: ComposerService) =>
  (composer.compose as jest.Mock).mock.calls.map((c) => c[0]);

const templateCalls = (templates: TemplatesService) =>
  (templates.render as jest.Mock).mock.calls.map((c) => c[0]);

describe('MessageHandlerService.handle — inbound logging', () => {
  it('logs every incoming message to MessageLog', async () => {
    const messageLog = makeMessageLog();
    const handler = build({ messageLog });

    await handler.handle({ from: CUSTOMER, text: 'hello' });

    expect(messageLog.log).toHaveBeenCalledWith(CUSTOMER, 'in', 'hello');
  });

  it('logs the composed outbound message', async () => {
    const parser = makeParser({ intent: 'greeting' });
    const composer = makeComposer({ ok: true, text: 'hi, what dates?' });
    const messageLog = makeMessageLog();
    const handler = build({ parser, composer, messageLog });

    await handler.handle({ from: CUSTOMER, text: 'hello' });

    expect(messageLog.log).toHaveBeenCalledWith(
      CUSTOMER,
      'out',
      'hi, what dates?',
    );
  });
});

describe('MessageHandlerService.handle — owner commands', () => {
  it('toggles global pause ON for /pause with no phone', async () => {
    const conversation = makeConversation({
      parseCommand: jest.fn().mockReturnValue({ command: 'pause' }),
      setGlobalPaused: jest.fn().mockResolvedValue(undefined),
    });
    const notifications = makeNotifications();
    const handler = build({ conversation, notifications });

    await handler.handle({ from: OWNER, text: '/pause' });

    expect(conversation.setGlobalPaused).toHaveBeenCalledWith(true);
    expect(conversation.setStatus).not.toHaveBeenCalled();
    expect(notifications.notifyOwner).toHaveBeenCalledWith(
      expect.stringContaining('Bot paused'),
      expect.objectContaining({ reason: 'owner_command' }),
    );
  });

  it('pauses a single conversation for /pause +phone', async () => {
    const conversation = makeConversation({
      parseCommand: jest
        .fn()
        .mockReturnValue({ command: 'pause', phone: '628777', minutes: 30 }),
      setGlobalPaused: jest.fn().mockResolvedValue(undefined),
    });
    const notifications = makeNotifications();
    const handler = build({ conversation, notifications });

    await handler.handle({ from: OWNER, text: '/pause 628777 30' });

    expect(conversation.setStatus).toHaveBeenCalledWith('628777', 'paused', {
      pauseForMinutes: 30,
    });
    expect(conversation.setGlobalPaused).not.toHaveBeenCalled();
    expect(notifications.notifyOwner).toHaveBeenCalledWith(
      expect.stringContaining('Paused +628777 for 30 minutes'),
      expect.objectContaining({ reason: 'owner_command' }),
    );
  });

  it('toggles global pause OFF for /resume with no phone', async () => {
    const conversation = makeConversation({
      parseCommand: jest.fn().mockReturnValue({ command: 'resume' }),
      setGlobalPaused: jest.fn().mockResolvedValue(undefined),
    });
    const notifications = makeNotifications();
    const handler = build({ conversation, notifications });

    await handler.handle({ from: OWNER, text: '/resume' });

    expect(conversation.setGlobalPaused).toHaveBeenCalledWith(false);
    expect(notifications.notifyOwner).toHaveBeenCalledWith(
      expect.stringContaining('Bot back on'),
      expect.objectContaining({ reason: 'owner_command' }),
    );
  });

  it('reports global state and counts for /status with no phone', async () => {
    const conversation = makeConversation({
      parseCommand: jest.fn().mockReturnValue({ command: 'status' }),
      getGlobalPaused: jest.fn().mockResolvedValue(true),
      statusCounts: jest
        .fn()
        .mockResolvedValue({ bot: 3, human: 1, paused: 2 }),
    });
    const notifications = makeNotifications();
    const handler = build({ conversation, notifications });

    await handler.handle({ from: OWNER, text: '/status' });

    const message = (notifications.notifyOwner as jest.Mock).mock.calls[0][0];
    expect(message).toContain('Bot is paused');
    expect(message).toContain('3 waiting');
    expect(message).toContain('1 with you');
    expect(message).toContain('2 paused');
  });

  it('translates internal intent labels in /status +phone', async () => {
    const conversation = makeConversation({
      parseCommand: jest
        .fn()
        .mockReturnValue({ command: 'status', phone: '628777' }),
      getState: jest.fn().mockResolvedValue({
        status: 'human',
        lifecycleStatus: 'Responded',
        lastIntent: 'general_info',
        pendingDates: null,
        customerName: 'Maria',
      }),
    });
    const notifications = makeNotifications();
    const handler = build({ conversation, notifications });

    await handler.handle({ from: OWNER, text: '/status 628777' });

    const message = (notifications.notifyOwner as jest.Mock).mock.calls[0][0];
    expect(message).toContain('+628777');
    expect(message).toContain('with you');
    expect(message).toContain('Name: Maria');
    expect(message).toContain('Last topic: general question');
    expect(message).not.toContain('general_info');
  });

  it('rejects /release with no phone argument', async () => {
    const conversation = makeConversation({
      parseCommand: jest.fn().mockReturnValue({ command: 'release' }),
    });
    const notifications = makeNotifications();
    const handler = build({ conversation, notifications });

    await handler.handle({ from: OWNER, text: '/release' });

    expect(conversation.setStatus).not.toHaveBeenCalled();
    expect(notifications.notifyOwner).toHaveBeenCalledWith(
      expect.stringContaining('needs a phone number'),
      expect.any(Object),
    );
  });

  it('ignores commands from anyone other than the owner', async () => {
    const conversation = makeConversation({
      parseCommand: jest.fn().mockReturnValue({ command: 'pause' }),
      setGlobalPaused: jest.fn().mockResolvedValue(undefined),
    });
    const handler = build({ conversation });

    await handler.handle({ from: '628111', text: '/pause' });

    expect(conversation.setStatus).not.toHaveBeenCalled();
    expect(conversation.setGlobalPaused).not.toHaveBeenCalled();
  });
});

describe('MessageHandlerService.handleOwnerTakeover', () => {
  it('marks the conversation as human and cancels any follow-ups', async () => {
    const conversation = makeConversation();
    const followUps = makeFollowUps();
    const handler = build({ conversation, followUps });

    await handler.handleOwnerTakeover(CUSTOMER);

    expect(conversation.setStatus).toHaveBeenCalledWith(CUSTOMER, 'human');
    expect(followUps.cancel).toHaveBeenCalledWith(CUSTOMER);
  });

  it('records the owner echo to reset the Coexistence heartbeat', async () => {
    const bookingRules = makeBookingRules();
    const handler = build({ bookingRules });

    await handler.handleOwnerTakeover(CUSTOMER);

    expect(bookingRules.recordOwnerEchoSeen).toHaveBeenCalledTimes(1);
  });

  it('ignores echoes addressed to the owner phone (Jim messaging himself)', async () => {
    const conversation = makeConversation();
    const followUps = makeFollowUps();
    const bookingRules = makeBookingRules();
    const handler = build({ conversation, followUps, bookingRules });

    await handler.handleOwnerTakeover(OWNER);

    expect(conversation.setStatus).not.toHaveBeenCalled();
    expect(followUps.cancel).not.toHaveBeenCalled();
    expect(bookingRules.recordOwnerEchoSeen).not.toHaveBeenCalled();
  });
});

describe('MessageHandlerService.handle — pause gate', () => {
  it('silently drops messages when the conversation is paused', async () => {
    const conversation = makeConversation({
      getState: jest.fn().mockResolvedValue({
        status: 'paused',
        lifecycleStatus: 'New',
        lastIntent: null,
        pendingDates: null,
        customerName: null,
      }),
    });
    const parser = makeParser({ intent: 'greeting' });
    const whatsapp = makeWhatsapp();
    const handler = build({ conversation, parser, whatsapp });

    await handler.handle({ from: CUSTOMER, text: 'hi' });

    expect(parser.parse).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });
});

describe('MessageHandlerService.handle — availability flow (fixed templates)', () => {
  it('renders availability_yes_quote when dates are free', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const templates = makeTemplates('quote text');
    const handler = build({ parser, templates });

    await handler.handle({ from: CUSTOMER, text: 'is Jul 6-13 free?' });

    expect(templates.render).toHaveBeenCalledWith(
      'availability_yes_quote',
      expect.objectContaining({ nights: 7, price: '£2,100' }),
    );
  });

  it('renders availability_no_priority when dates are taken', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const availability = makeAvailability(false);
    const templates = makeTemplates();
    const handler = build({ parser, availability, templates });

    await handler.handle({ from: CUSTOMER, text: 'is Jul 6-13 free?' });

    expect(templateCalls(templates)).toContain('availability_no_priority');
  });

  it('sends availability_pending_pricing (not a firm quote) when only the base rate matched', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const pricing = makePricing({
      weeks: 1,
      nights: 7,
      weeklyRate: 2495,
      subtotal: 2495,
      total: 2495,
      minWeeks: 0,
      meetsMinWeeks: true,
      usedBase: true,
    });
    const templates = makeTemplates();
    const notifications = makeNotifications();
    const handler = build({ parser, pricing, templates, notifications });

    await handler.handle({ from: CUSTOMER, text: 'is that week free in 2031?' });

    const calls = templateCalls(templates);
    expect(calls).toContain('availability_pending_pricing');
    expect(calls).not.toContain('availability_yes_quote');
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'pricing_pending',
      expect.anything(),
    );
  });

  it('appends the September wine-harvest note when check-in falls in September', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: new Date('2025-09-07'),
      checkOut: new Date('2025-09-14'),
    });
    const templates = makeTemplates('rendered');
    const handler = build({ parser, templates });

    await handler.handle({ from: CUSTOMER, text: '7-14 sep?' });

    const calls = templateCalls(templates);
    expect(calls).toContain('availability_yes_quote');
    expect(calls).toContain('september_wine_harvest_note');
  });

  it('asks for clarification via composer when dates are missing', async () => {
    const parser = makeParser({ intent: 'availability_inquiry' });
    const composer = makeComposer();
    const handler = build({ parser, composer });

    await handler.handle({ from: CUSTOMER, text: 'free this summer?' });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('dates_unclear');
  });

  it('falls back to dates_unclear_ask_clarify template when composer fails', async () => {
    const parser = makeParser({ intent: 'availability_inquiry' });
    const composer = makeComposer({
      ok: false,
      reason: 'forbidden_term',
      raw: 'sold',
    });
    const templates = makeTemplates();
    const handler = build({ parser, composer, templates });

    await handler.handle({ from: CUSTOMER, text: 'free this summer?' });

    expect(templateCalls(templates)).toContain('dates_unclear_ask_clarify');
  });
});

describe('MessageHandlerService.handle — booking rules', () => {
  it('renders year_2026_redirect template when booking rules block with that reason', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const bookingRules = makeBookingRules({
      pass: false,
      reason: 'year_2026_redirect',
    });
    const templates = makeTemplates();
    const handler = build({ parser, bookingRules, templates });

    await handler.handle({ from: CUSTOMER, text: 'available in 2026?' });

    expect(templates.render).toHaveBeenCalledWith(
      'year_2026_redirect',
      expect.any(Object),
    );
  });

  it('hands off via long_stay_manual_pricing on Oct-May long stay', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: new Date('2025-11-02'),
      checkOut: new Date('2025-11-30'),
    });
    const bookingRules = makeBookingRules({
      pass: false,
      reason: 'long_stay_manual',
    });
    const templates = makeTemplates();
    const handler = build({ parser, bookingRules, templates });

    await handler.handle({ from: CUSTOMER, text: 'can I rent for November?' });

    expect(templates.render).toHaveBeenCalledWith(
      'long_stay_manual_pricing',
      expect.any(Object),
    );
  });
});

describe('MessageHandlerService.handle — discount detection', () => {
  it('intercepts discount requests and hands off to Jim', async () => {
    const parser = makeParser({
      intent: 'pricing_inquiry',
      mentionsDiscount: true,
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const templates = makeTemplates();
    const notifications = makeNotifications();
    const handler = build({ parser, templates, notifications });

    await handler.handle({ from: CUSTOMER, text: 'can I get a better rate?' });

    expect(templates.render).toHaveBeenCalledWith(
      'discount_request',
      expect.any(Object),
    );
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'discount_request',
      expect.any(Object),
    );
  });
});

describe('MessageHandlerService.handle — composer-driven intents', () => {
  it('greeting (no dates) calls composer with scenario greeting', async () => {
    const parser = makeParser({ intent: 'greeting' });
    const composer = makeComposer();
    const handler = build({ parser, composer });

    await handler.handle({ from: CUSTOMER, text: 'hi' });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('greeting');
  });

  it('general_info with no fragments calls composer with faq_unknown scenario', async () => {
    const parser = makeParser({ intent: 'general_info', topicKeys: ['unknown'] });
    const composer = makeComposer();
    const fragments = makeFragments();
    (fragments.fetchByTopicKeys as jest.Mock).mockResolvedValue([]);
    const notifications = makeNotifications();
    const handler = build({ parser, composer, fragments, notifications });

    await handler.handle({ from: CUSTOMER, text: 'do you have a hairdryer?' });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('faq_unknown');
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'faq_unknown',
      expect.any(Object),
    );
  });

  it('general_info with fragments calls composer with knowledge facts', async () => {
    const parser = makeParser({
      intent: 'general_info',
      topicKeys: ['dogs'],
    });
    const composer = makeComposer();
    const fragments = makeFragments();
    (fragments.fetchByTopicKeys as jest.Mock).mockResolvedValue([
      {
        key: 'dogs_allowed',
        category: 'knowledge',
        text: 'Dogs are very welcome.',
        topicKeys: ['dogs'],
      },
    ]);
    const handler = build({ parser, composer, fragments });

    await handler.handle({ from: CUSTOMER, text: 'can I bring my dog?' });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('general_info');
    expect(pkg.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'dogs_allowed' }),
      ]),
    );
  });

  it('correction intent calls composer with correction scenario', async () => {
    const parser = makeParser({
      intent: 'correction',
      isCorrection: true,
    });
    const composer = makeComposer();
    const handler = build({ parser, composer });

    await handler.handle({
      from: CUSTOMER,
      text: "I didn't ask about that",
    });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('correction');
  });

  it('polite_close intent calls composer with polite_close scenario', async () => {
    const parser = makeParser({ intent: 'polite_close' });
    const composer = makeComposer();
    const handler = build({ parser, composer });

    await handler.handle({ from: CUSTOMER, text: "I'll think about it" });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('polite_close');
  });

  it('off_topic_or_unclear calls composer with unclear scenario', async () => {
    const parser = makeParser({ intent: 'off_topic_or_unclear' });
    const composer = makeComposer();
    const handler = build({ parser, composer });

    await handler.handle({ from: CUSTOMER, text: 'glarg' });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('unclear');
  });

  it('falls back to template + notifies owner when composer rejects output', async () => {
    const parser = makeParser({ intent: 'greeting' });
    const composer = makeComposer({
      ok: false,
      reason: 'forbidden_term',
      raw: 'sold',
    });
    const templates = makeTemplates();
    const notifications = makeNotifications();
    const handler = build({ parser, composer, templates, notifications });

    await handler.handle({ from: CUSTOMER, text: 'hi' });

    expect(templateCalls(templates)).toContain('greeting_ask_dates');
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'composer_fallback',
      expect.any(Object),
    );
  });

  it('acknowledgment is silently dropped when previous intent was also acknowledgment', async () => {
    const parser = makeParser({ intent: 'acknowledgment' });
    const composer = makeComposer();
    const whatsapp = makeWhatsapp();
    const conversation = makeConversation({
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'acknowledgment',
        pendingDates: null,
        customerName: null,
      }),
    });
    const handler = build({ parser, composer, whatsapp, conversation });

    await handler.handle({ from: CUSTOMER, text: 'thanks again' });

    expect(composer.compose).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });
});

describe('MessageHandlerService.handle — month query', () => {
  it('routes month query to helpers and composer', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      monthQuery: { year: 2027, month: 9 },
    });
    const helpers = makeHelpers();
    (helpers.monthAvailabilitySummary as jest.Mock).mockResolvedValue([
      {
        checkIn: new Date('2027-09-05'),
        checkOut: new Date('2027-09-12'),
        total: 4500,
        weeklyRate: 4500,
      },
    ]);
    const composer = makeComposer();
    const handler = build({ parser, helpers, composer });

    await handler.handle({
      from: CUSTOMER,
      text: 'any availability in september?',
    });

    expect(helpers.monthAvailabilitySummary).toHaveBeenCalledWith(2027, 9);
    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('month_query');
    expect(pkg.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'available_weeks' }),
      ]),
    );
  });
});

describe('MessageHandlerService.handle — fail-safe paths', () => {
  it('falls back to unclear_handoff template when a downstream service throws', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const availability = {
      isRangeAvailable: jest.fn().mockRejectedValue(new Error('ical down')),
      findAvailableSundayWeeks: jest.fn().mockResolvedValue([]),
    } as unknown as AvailabilityService;
    const templates = makeTemplates();
    const notifications = makeNotifications();
    const handler = build({
      parser,
      availability,
      templates,
      notifications,
    });

    await handler.handle({ from: CUSTOMER, text: 'is Jul 6-13 free?' });

    expect(templateCalls(templates)).toContain('unclear_handoff');
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'orchestrator_error',
      expect.objectContaining({
        extra: expect.objectContaining({ error: 'ical down' }),
      }),
    );
  });
});

describe('MessageHandlerService.handle — context persistence', () => {
  it('updates lastIntent, customerName, and pendingDates on the conversation', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      customerName: 'Maria',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
      guests: 2,
    });
    const conversation = makeConversation();
    const handler = build({ parser, conversation });

    await handler.handle({ from: CUSTOMER, text: "I'm Maria, Jul 6-13" });

    expect(conversation.updateContext).toHaveBeenCalledWith(
      CUSTOMER,
      expect.objectContaining({
        lastIntent: 'availability_inquiry',
        customerName: 'Maria',
        pendingDates: expect.objectContaining({
          checkIn: '2025-07-06',
          checkOut: '2025-07-13',
          guests: 2,
        }),
      }),
    );
  });
});

describe('MessageHandlerService.handle — hold flows', () => {
  it('does NOT send a separate hold_offer_post_quote — the hold offer lives in the quote template', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
      highIntentSignal: true,
    });
    const templates = makeTemplates();
    const whatsapp = makeWhatsapp();
    const handler = build({ parser, templates, whatsapp });

    await handler.handle({
      from: CUSTOMER,
      text: 'those dates look great, can I book?',
    });

    expect(templateCalls(templates)).not.toContain('hold_offer_post_quote');
    expect(templateCalls(templates)).toContain('availability_yes_quote');
    // Single bubble: one outbound message even though wine-harvest may concat.
    expect((whatsapp.sendMessage as jest.Mock).mock.calls.length).toBe(1);
  });

  it('treats held dates as unavailable', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const holds = makeHolds(true);
    const availability = makeAvailability(true);
    const templates = makeTemplates();
    const handler = build({ parser, holds, availability, templates });

    await handler.handle({ from: CUSTOMER, text: 'are those dates free?' });

    expect(templateCalls(templates)).toContain('availability_no_priority');
    expect(availability.isRangeAvailable).not.toHaveBeenCalled();
  });

  it('creates a hold and sends hold_confirmed on hold_request intent', async () => {
    const parser = makeParser({
      intent: 'hold_request',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const holds = makeHolds(false);
    const templates = makeTemplates();
    const handler = build({ parser, holds, templates });

    await handler.handle({ from: CUSTOMER, text: 'please hold those dates' });

    expect(holds.createHold).toHaveBeenCalledWith(
      CUSTOMER,
      SUN_CHECK_IN,
      SUN_CHECK_OUT,
    );
    expect(templateCalls(templates)).toContain('hold_confirmed');
  });

  it('asks for dates on hold_request when no dates provided', async () => {
    const parser = makeParser({ intent: 'hold_request' });
    const templates = makeTemplates();
    const holds = makeHolds(false);
    const handler = build({ parser, templates, holds });

    await handler.handle({
      from: CUSTOMER,
      text: 'can you hold dates for me?',
    });

    expect(templateCalls(templates)).toContain('dates_unclear_ask_clarify');
    expect(holds.createHold).not.toHaveBeenCalled();
  });
});

describe('MessageHandlerService.handle — follow-up sequence wiring', () => {
  it('schedules a follow-up after sending availability_yes_quote', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const followUps = makeFollowUps();
    const handler = build({ parser, followUps });

    await handler.handle({ from: CUSTOMER, text: 'is Jul 6-13 free?' });

    expect(followUps.schedule).toHaveBeenCalledWith(CUSTOMER);
  });

  it('cancels open follow-up sequences on every inbound customer message', async () => {
    const followUps = makeFollowUps();
    const handler = build({ followUps });

    await handler.handle({ from: CUSTOMER, text: 'hi' });

    expect(followUps.cancel).toHaveBeenCalledWith(CUSTOMER);
  });
});
