import { ConfigService } from '@nestjs/config';
import { AvailabilityService } from '../availability/availability.service';
import {
  BookingRulesService,
  RulesValidation,
} from '../booking-rules/booking-rules.service';
import { ComposerService } from '../composer/composer.service';
import { ConversationService } from '../conversation/conversation.service';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { FragmentsService } from '../fragments/fragments.service';
import { HelpersService } from '../helpers/helpers.service';
import { GuestContext, GuestsService } from '../guests/guests.service';
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
  result:
    | { ok: true; text: string }
    | { ok: false; reason: string; raw: string } = {
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
    nearbyAvailabilitySummary: jest.fn().mockResolvedValue([]),
    nearestAvailableWeeks: jest.fn().mockResolvedValue([]),
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
    statusCounts: jest.fn().mockResolvedValue({ bot: 0, human: 0, paused: 0 }),
    ...overrides,
  }) as unknown as ConversationService;

const makeMessageLog = (): MessageLogService =>
  ({
    log: jest.fn().mockResolvedValue(undefined),
    recent: jest.fn().mockResolvedValue([]),
  }) as unknown as MessageLogService;

const makeConfig = (overrides: { owner?: string } = {}): ConfigService => {
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

// Guest recognition defaults to "unrecognised number" so every pre-existing
// assertion in this file keeps describing the prospect funnel exactly as it was.
const PROSPECT_CTX: GuestContext = {
  mode: 'prospect',
  guest: null,
  previousStays: 0,
  lastStay: null,
  hold: null,
};

const guestRecord = (fields: Record<string, unknown>) =>
  ({ id: 'recG', fields }) as unknown as GuestContext['guest'];

const makeGuests = (ctx: GuestContext = PROSPECT_CTX) =>
  ({
    resolveContext: jest.fn().mockResolvedValue(ctx),
  }) as unknown as GuestsService;

type Overrides = {
  parser?: ParserService;
  availability?: AvailabilityService;
  pricing?: PricingService;
  bookingRules?: BookingRulesService;
  holds?: HoldsService;
  guests?: GuestsService;
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
    over.guests ?? makeGuests(),
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

    expect(conversation.setStatus).toHaveBeenCalledWith(CUSTOMER, 'human', {
      pauseForMinutes: expect.any(Number),
    });
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

  it('composes an unavailable reply with nearby alternatives when dates are taken', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const availability = makeAvailability(false);
    const composer = makeComposer();
    const helpers = makeHelpers();
    (helpers.nearbyAvailabilitySummary as jest.Mock).mockResolvedValue([
      {
        checkIn: new Date('2025-08-03'),
        checkOut: new Date('2025-08-10'),
        total: 2100,
        weeklyRate: 2100,
        usedBase: false,
      },
    ]);
    const handler = build({ parser, availability, composer, helpers });

    await handler.handle({ from: CUSTOMER, text: 'is Jul 6-13 free?' });

    const pkg = composerCalls(composer)[0];
    expect(pkg.scenarioHint).toBe('dates_unavailable');
    const altFact = pkg.facts.find(
      (f: { key: string }) => f.key === 'nearby_alternatives',
    );
    expect(altFact.text).toContain('3 August');
  });

  it('widens to the nearest open weeks when the couple-of-months window is fully booked', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const availability = makeAvailability(false);
    const composer = makeComposer();
    const helpers = makeHelpers();
    (helpers.nearbyAvailabilitySummary as jest.Mock).mockResolvedValue([]);
    (helpers.nearestAvailableWeeks as jest.Mock).mockResolvedValue([
      {
        checkIn: new Date('2025-12-07'),
        checkOut: new Date('2025-12-14'),
        total: 1800,
        weeklyRate: 1800,
        usedBase: false,
      },
    ]);
    const handler = build({ parser, availability, composer, helpers });

    await handler.handle({ from: CUSTOMER, text: 'is Jul 6-13 free?' });

    const pkg = composerCalls(composer)[0];
    const altFact = pkg.facts.find(
      (f: { key: string }) => f.key === 'nearby_alternatives',
    );
    expect(helpers.nearestAvailableWeeks).toHaveBeenCalled();
    expect(altFact.text).toContain('7 December');
    expect(altFact.text).toContain('further out than usual');
  });

  it('falls back to availability_no_priority when the composer fails', async () => {
    const parser = makeParser({
      intent: 'availability_inquiry',
      checkIn: SUN_CHECK_IN,
      checkOut: SUN_CHECK_OUT,
    });
    const availability = makeAvailability(false);
    const composer = makeComposer({
      ok: false,
      reason: 'forbidden_term:sold',
      raw: 'sold',
    });
    const templates = makeTemplates();
    const handler = build({ parser, availability, composer, templates });

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

    await handler.handle({
      from: CUSTOMER,
      text: 'is that week free in 2031?',
    });

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
    const parser = makeParser({
      intent: 'general_info',
      topicKeys: ['unknown'],
    });
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

  it('polite_close is silently dropped when previous intent was acknowledgment', async () => {
    const parser = makeParser({ intent: 'polite_close' });
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

    await handler.handle({ from: CUSTOMER, text: 'bye' });

    expect(composer.compose).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('acknowledgment is silently dropped when previous intent was polite_close', async () => {
    const parser = makeParser({ intent: 'acknowledgment' });
    const composer = makeComposer();
    const whatsapp = makeWhatsapp();
    const conversation = makeConversation({
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'polite_close',
        pendingDates: null,
        customerName: null,
      }),
    });
    const handler = build({ parser, composer, whatsapp, conversation });

    await handler.handle({ from: CUSTOMER, text: 'thanks, bye' });

    expect(composer.compose).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('farewell polite_close composes a plain acknowledgment, not a hold-offer close', async () => {
    const parser = makeParser({ intent: 'polite_close' });
    const composer = makeComposer();
    const handler = build({ parser, composer });

    await handler.handle({ from: CUSTOMER, text: "that's it, bye, thanks" });

    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('acknowledgment');
  });

  it('farewell closer after a date suggestion does not re-run availability', async () => {
    const parser = makeParser({ intent: 'acknowledgment' });
    const availability = makeAvailability();
    const composer = makeComposer();
    const conversation = makeConversation({
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'awaiting_dates_confirmation',
        pendingDates: {
          checkIn: '2027-09-05',
          checkOut: '2027-09-12',
          guests: null,
        },
        customerName: null,
      }),
    });
    const handler = build({ parser, availability, composer, conversation });

    await handler.handle({ from: CUSTOMER, text: 'ok thanks, bye' });

    expect(availability.isRangeAvailable).not.toHaveBeenCalled();
    const [pkg] = composerCalls(composer);
    expect(pkg.scenarioHint).toBe('acknowledgment');
  });

  it('short affirmative after a date suggestion still re-runs availability', async () => {
    const parser = makeParser({ intent: 'acknowledgment' });
    const availability = makeAvailability();
    const conversation = makeConversation({
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'awaiting_dates_confirmation',
        pendingDates: {
          checkIn: '2027-09-05',
          checkOut: '2027-09-12',
          guests: null,
        },
        customerName: null,
      }),
    });
    const handler = build({ parser, availability, conversation });

    await handler.handle({ from: CUSTOMER, text: 'yes please' });

    expect(availability.isRangeAvailable).toHaveBeenCalled();
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
    const composer = makeComposer();
    const handler = build({ parser, holds, availability, composer });

    await handler.handle({ from: CUSTOMER, text: 'are those dates free?' });

    const pkg = composerCalls(composer)[0];
    expect(pkg.scenarioHint).toBe('dates_unavailable');
    const unavailableFact = pkg.facts.find(
      (f: { key: string }) => f.key === 'requested_unavailable',
    );
    expect(unavailableFact.text).toContain('held for another guest');
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

describe('MessageHandlerService.handle — partial dates (target date, no full range)', () => {
  const TARGET_PARSE = {
    intent: 'availability_inquiry' as const,
    checkIn: new Date('2027-04-23'), // Friday — guest said "4/5 days over the 23rd"
    checkOut: null,
  };

  it('checks the containing + following Sunday weeks against the iCal', async () => {
    const parser = makeParser(TARGET_PARSE);
    const availability = makeAvailability(false);
    const composer = makeComposer();
    const handler = build({ parser, availability, composer });

    await handler.handle({ from: CUSTOMER, text: '4/5 days over April 23rd?' });

    const calls = (availability.isRangeAvailable as jest.Mock).mock.calls.map(
      (c: [Date, Date]) => c[0].toISOString().slice(0, 10),
    );
    expect(calls).toEqual(['2027-04-18', '2027-04-25']);
  });

  it('composes partial_dates with RESERVED facts and notifies Jim when both weeks are booked', async () => {
    const parser = makeParser(TARGET_PARSE);
    const availability = makeAvailability(false);
    const composer = makeComposer();
    const notifications = makeNotifications();
    const handler = build({ parser, availability, composer, notifications });

    await handler.handle({ from: CUSTOMER, text: '4/5 days over April 23rd?' });

    const pkg = (composer.compose as jest.Mock).mock.calls[0][0];
    expect(pkg.scenarioHint).toBe('partial_dates');
    const fact = pkg.facts.find(
      (f: { key: string }) => f.key === 'requested_week_availability',
    );
    expect(fact.text).toContain('18 April 2027');
    expect(fact.text).toContain('RESERVED');
    expect(fact.text).not.toContain('AVAILABLE at');
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'dates_unavailable',
      expect.objectContaining({
        extra: expect.objectContaining({ partialDates: true }),
      }),
    );
  });

  it('offers the priced week and parks it for a "yes please" when free', async () => {
    const parser = makeParser(TARGET_PARSE);
    const availability = makeAvailability(true);
    const helpers = makeHelpers();
    (helpers.getPricingForDateRange as jest.Mock).mockResolvedValue({
      weeks: 1,
      nights: 7,
      weeklyRate: 2400,
      subtotal: 2400,
      total: 2400,
      usedBase: false,
    });
    const composer = makeComposer();
    const conversation = makeConversation();
    const followUps = makeFollowUps();
    const handler = build({
      parser,
      availability,
      helpers,
      composer,
      conversation,
      followUps,
    });

    await handler.handle({ from: CUSTOMER, text: '4/5 days over April 23rd?' });

    const pkg = (composer.compose as jest.Mock).mock.calls[0][0];
    const fact = pkg.facts.find(
      (f: { key: string }) => f.key === 'requested_week_availability',
    );
    expect(fact.text).toContain('AVAILABLE at £2,400');
    const parked = (conversation.updateContext as jest.Mock).mock.calls.find(
      (c: [string, { lastIntent?: string }]) =>
        c[1].lastIntent === 'awaiting_dates_confirmation',
    );
    expect(parked[1].pendingDates).toEqual({
      checkIn: '2027-04-18',
      checkOut: '2027-04-25',
      guests: null,
    });
    expect(followUps.schedule).toHaveBeenCalledWith(CUSTOMER);
  });
});

describe('MessageHandlerService.handle — guest recognition', () => {
  const futureBooking = {
    booking_ref: '33',
    guest_name: 'Abigail Johns',
    check_in: '2027-05-23',
    check_out: '2027-05-30',
    adults: 4,
    children: 2,
    infants: 2,
  };

  const futureGuest: GuestContext = {
    mode: 'future_guest',
    guest: guestRecord(futureBooking),
    previousStays: 0,
    lastStay: null,
    hold: null,
  };

  const currentGuest: GuestContext = {
    ...futureGuest,
    mode: 'current_guest',
  };

  const pastGuest: GuestContext = {
    mode: 'past_guest',
    guest: guestRecord({ ...futureBooking, check_in: '2026-06-07', check_out: '2026-06-14' }),
    previousStays: 2,
    lastStay: { checkIn: '2026-06-07', checkOut: '2026-06-14' },
    hold: null,
  };

  it('leaves an unrecognised number with no guest facts at all', async () => {
    const composer = makeComposer();
    const handler = build({
      composer,
      parser: makeParser({ intent: 'general_info', topicKeys: ['pool_heated'] }),
    });

    await handler.handle({ from: CUSTOMER, text: 'is the pool heated?' });

    const keys = composerCalls(composer)[0].facts.map(
      (f: { key: string }) => f.key,
    );
    expect(keys).not.toContain('guest_context');
    expect(keys).not.toContain('guest_mode_guidance');
  });

  it('passes the booking details to the composer for a confirmed guest', async () => {
    const composer = makeComposer();
    const handler = build({
      composer,
      guests: makeGuests(futureGuest),
      parser: makeParser({ intent: 'general_info', topicKeys: ['arrival_time'] }),
    });

    await handler.handle({ from: CUSTOMER, text: 'what time can we arrive?' });

    const facts = composerCalls(composer)[0].facts;
    const context = facts.find(
      (f: { key: string }) => f.key === 'guest_context',
    ).text;
    expect(context).toContain('Abigail Johns');
    expect(context).toContain('23 May 2027');
    expect(context).toContain('30 May 2027');
    expect(context).toContain('7 nights');
    expect(context).toContain('4 adults');
    expect(context).toContain('Booking reference 33');
    expect(
      facts.find((f: { key: string }) => f.key === 'guest_mode_guidance').text,
    ).toContain('confirmed guest');
  });

  it('uses the booking name when the chat never gave one', async () => {
    const composer = makeComposer();
    const handler = build({
      composer,
      guests: makeGuests(futureGuest),
      parser: makeParser({ intent: 'general_info', topicKeys: ['arrival_time'] }),
    });

    await handler.handle({ from: CUSTOMER, text: 'what time can we arrive?' });

    expect(composerCalls(composer)[0].guestName).toBe('Abigail');
  });

  // The three guardrails that stop a paid guest being sold to.
  it('never nudges a confirmed guest toward booking', async () => {
    const composer = makeComposer();
    const handler = build({
      composer,
      guests: makeGuests(currentGuest),
      parser: makeParser({
        intent: 'general_info',
        topicKeys: ['bin_day'],
        highIntentSignal: true,
      }),
    });

    await handler.handle({ from: CUSTOMER, text: 'when do the bins go out?' });

    expect(composerCalls(composer)[0].toneFlags.needsNudgeToBook).toBe(false);
  });

  it('does not append the website link for a confirmed guest', async () => {
    const whatsapp = makeWhatsapp();
    const handler = build({
      whatsapp,
      guests: makeGuests(currentGuest),
      composer: makeComposer({ ok: true, text: 'The bins go out on Tuesday.' }),
      parser: makeParser({ intent: 'general_info', topicKeys: ['bin_day'] }),
    });

    await handler.handle({ from: CUSTOMER, text: 'when do the bins go out?' });

    expect(whatsapp.sendMessage).toHaveBeenCalledWith(
      CUSTOMER,
      expect.not.stringContaining('bontemaison.com'),
    );
  });

  it('never chases a confirmed guest with a follow-up', async () => {
    const followUps = makeFollowUps();
    const handler = build({
      followUps,
      guests: makeGuests(futureGuest),
      parser: makeParser({
        intent: 'availability_inquiry',
        checkIn: SUN_CHECK_IN,
        checkOut: SUN_CHECK_OUT,
      }),
    });

    await handler.handle({ from: CUSTOMER, text: 'is that week free?' });

    expect(followUps.schedule).not.toHaveBeenCalled();
  });

  // A prospect must still get the full funnel — this is the regression guard.
  it('still schedules a follow-up for a prospect', async () => {
    const followUps = makeFollowUps();
    const handler = build({
      followUps,
      parser: makeParser({
        intent: 'availability_inquiry',
        checkIn: SUN_CHECK_IN,
        checkOut: SUN_CHECK_OUT,
      }),
    });

    await handler.handle({ from: CUSTOMER, text: 'is that week free?' });

    expect(followUps.schedule).toHaveBeenCalledWith(CUSTOMER);
  });

  it('opens sensitive knowledge only to a guest in residence', async () => {
    const knowledgeBase = makeKnowledgeBase();
    const handler = build({
      knowledgeBase,
      guests: makeGuests(currentGuest),
      parser: makeParser({ intent: 'general_info', topicKeys: ['wifi_password'] }),
    });

    await handler.handle({ from: CUSTOMER, text: "what's the wifi password?" });

    expect(knowledgeBase.render).toHaveBeenCalledWith(
      'wifi_password',
      expect.anything(),
      ['all', 'pre_stay', 'in_stay', 'sensitive'],
    );
  });

  it('keeps sensitive knowledge shut for a prospect', async () => {
    const knowledgeBase = makeKnowledgeBase();
    const handler = build({
      knowledgeBase,
      parser: makeParser({ intent: 'general_info', topicKeys: ['wifi_password'] }),
    });

    await handler.handle({ from: CUSTOMER, text: "what's the wifi password?" });

    expect(knowledgeBase.render).toHaveBeenCalledWith(
      'wifi_password',
      expect.anything(),
      ['all'],
    );
    expect(knowledgeBase.listTopics).toHaveBeenCalledWith(['all']);
  });

  it('tells the composer a past guest has stayed before', async () => {
    const composer = makeComposer();
    const handler = build({
      composer,
      guests: makeGuests(pastGuest),
      parser: makeParser({ intent: 'greeting' }),
    });

    await handler.handle({ from: CUSTOMER, text: 'hi again' });

    const facts = composerCalls(composer)[0].facts;
    expect(
      facts.find((f: { key: string }) => f.key === 'guest_context').text,
    ).toContain('Previous stays: 2');
    expect(
      facts.find((f: { key: string }) => f.key === 'guest_mode_guidance').text,
    ).toContain('stayed before');
  });

  // A hold is not a booking: the bot should still be closing.
  it('still nudges someone who only has dates held', async () => {
    const composer = makeComposer();
    const handler = build({
      composer,
      guests: makeGuests({
        mode: 'hold',
        guest: null,
        previousStays: 0,
        lastStay: null,
        hold: {
          id: 'h1',
          fields: {
            phone: CUSTOMER,
            check_in: '2027-07-04',
            check_out: '2027-07-11',
            hold_expires_at: new Date('2027-01-06').toISOString(),
          },
        } as unknown as GuestContext['hold'],
      }),
      parser: makeParser({ intent: 'general_info', highIntentSignal: true }),
    });

    await handler.handle({ from: CUSTOMER, text: 'is there a highchair?' });

    const pkg = composerCalls(composer)[0];
    expect(pkg.toneFlags.needsNudgeToBook).toBe(true);
    expect(
      pkg.facts.find((f: { key: string }) => f.key === 'guest_context').text,
    ).toContain('4 July 2027');
  });

  it('falls back to prospect behaviour if recognition is unavailable', async () => {
    const composer = makeComposer();
    const guests = {
      resolveContext: jest.fn().mockResolvedValue(PROSPECT_CTX),
    } as unknown as GuestsService;
    const handler = build({ composer, guests, parser: makeParser({ intent: 'greeting' }) });

    await handler.handle({ from: CUSTOMER, text: 'hello' });

    expect(composerCalls(composer)[0].facts).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ key: 'guest_context' })]),
    );
  });
});
