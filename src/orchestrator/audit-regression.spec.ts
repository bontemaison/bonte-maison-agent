/**
 * Regression spec covering the 11 problems documented in
 * `.claude/plans/002-bot-conversations.md`.
 *
 * Each test names the audit problem it pins down. The shared mocks live in
 * `message-handler.service.spec.ts`; here we reach into the same construction
 * pattern but assert on the orchestration-level fix.
 */

import { ConfigService } from '@nestjs/config';
import { AvailabilityService } from '../availability/availability.service';
import { BookingRulesService } from '../booking-rules/booking-rules.service';
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

const CUSTOMER = '447777';

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const baseParsed = (over: Partial<ParseResult> = {}): ParseResult => ({
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
  ...over,
});

type Wires = {
  parser?: ParserService;
  templates?: TemplatesService;
  composer?: ComposerService;
  fragments?: FragmentsService;
  knowledgeBase?: KnowledgeBaseService;
  helpers?: HelpersService;
  conversation?: ConversationService;
  notifications?: NotificationsService;
  bookingRules?: BookingRulesService;
  holds?: HoldsService;
  availability?: AvailabilityService;
  pricing?: PricingService;
  followUps?: FollowUpsService;
  whatsapp?: WhatsappService;
  messageLog?: MessageLogService;
};

const buildHandler = (w: Wires = {}): MessageHandlerService => {
  const parser =
    w.parser ??
    ({
      parse: jest.fn().mockResolvedValue(baseParsed()),
    } as unknown as ParserService);
  const templates =
    w.templates ??
    ({
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService);
  const composer =
    w.composer ??
    ({
      compose: jest.fn().mockResolvedValue({ ok: true, text: 'composed' }),
    } as unknown as ComposerService);
  const fragments =
    w.fragments ??
    ({
      listAll: jest.fn().mockResolvedValue([]),
      listByCategory: jest.fn().mockResolvedValue([]),
      fetchByTopicKeys: jest.fn().mockResolvedValue([]),
    } as unknown as FragmentsService);
  const knowledgeBase =
    w.knowledgeBase ??
    ({
      listTopics: jest.fn().mockResolvedValue([]),
      render: jest.fn().mockResolvedValue(null),
    } as unknown as KnowledgeBaseService);
  const helpers =
    w.helpers ??
    ({
      findClosestAvailableWeek: jest.fn().mockResolvedValue(null),
      monthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      multiMonthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      getPricingForDateRange: jest.fn().mockResolvedValue(null),
      checkExistingHold: jest.fn().mockResolvedValue(null),
    } as unknown as HelpersService);
  const conversation =
    w.conversation ??
    ({
      parseCommand: jest.fn().mockReturnValue(null),
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'New',
        lastIntent: null,
        pendingDates: null,
        customerName: null,
      }),
      updateContext: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
      setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
      recordQuote: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConversationService);
  const notifications =
    w.notifications ??
    ({
      notifyOwner: jest.fn().mockResolvedValue(undefined),
      notifyOwnerAboutConversation: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService);
  const bookingRules =
    w.bookingRules ??
    ({
      validate: jest.fn().mockResolvedValue({ pass: true }),
      isYearFullyBooked: jest.fn().mockResolvedValue(false),
      isInstantBookEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as BookingRulesService);
  const holds =
    w.holds ??
    ({
      hasOverlap: jest.fn().mockResolvedValue(false),
      createHold: jest.fn().mockResolvedValue({
        id: 'h1',
        fields: { hold_expires_at: new Date('2027-01-01').toISOString() },
      }),
    } as unknown as HoldsService);
  const availability =
    w.availability ??
    ({
      isRangeAvailable: jest.fn().mockResolvedValue(true),
      findAvailableSundayWeeks: jest.fn().mockResolvedValue([]),
    } as unknown as AvailabilityService);
  const pricing =
    w.pricing ??
    ({
      calculate: jest.fn().mockResolvedValue({
        weeks: 1,
        nights: 7,
        weeklyRate: 4500,
        subtotal: 4500,
        total: 4500,
        minWeeks: 0,
        meetsMinWeeks: true,
      }),
    } as unknown as PricingService);
  const followUps =
    w.followUps ??
    ({
      schedule: jest.fn().mockResolvedValue({ id: 'fu', fields: {} }),
      cancel: jest.fn().mockResolvedValue(undefined),
    } as unknown as FollowUpsService);
  const whatsapp =
    w.whatsapp ??
    ({
      sendMessage: jest.fn().mockResolvedValue(undefined),
    } as unknown as WhatsappService);
  const messageLog =
    w.messageLog ??
    ({
      log: jest.fn().mockResolvedValue(undefined),
      recent: jest.fn().mockResolvedValue([]),
    } as unknown as MessageLogService);

  const config = {
    get: (k: string) =>
      (
        ({
          OWNER_PHONE: '447000000',
          INSTANT_BOOK_ENABLED: 'false',
        }) as Record<string, string>
      )[k],
  } as ConfigService;

  return new MessageHandlerService(
    parser,
    availability,
    pricing,
    bookingRules,
    holds,
    followUps,
    templates,
    composer,
    fragments,
    knowledgeBase,
    helpers,
    whatsapp,
    conversation,
    messageLog,
    notifications,
    makeLogger(),
    config,
  );
};

describe('audit regression — bot conversation problems', () => {
  it('Problem 2: multi-intent (kids + dog) → composer receives both topic fragments', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'general_info',
          topicKeys: ['cot_highchair', 'dogs'],
        }),
      ),
    } as unknown as ParserService;
    const fragments = {
      listAll: jest.fn().mockResolvedValue([]),
      listByCategory: jest.fn().mockResolvedValue([]),
      fetchByTopicKeys: jest.fn().mockResolvedValue([
        {
          key: 'cots_highchairs',
          category: 'knowledge',
          text: 'Two cots and two highchairs at the house.',
          topicKeys: ['cot_highchair'],
        },
        {
          key: 'dogs_allowed',
          category: 'knowledge',
          text: 'Dogs are very welcome with no limit.',
          topicKeys: ['dogs'],
        },
      ]),
    } as unknown as FragmentsService;
    const compose = jest
      .fn()
      .mockResolvedValue({ ok: true, text: 'cots and dogs welcome' });
    const composer = { compose } as unknown as ComposerService;
    const handler = buildHandler({ parser, fragments, composer });

    await handler.handle({
      from: CUSTOMER,
      text: 'Ok. And I bring kids and a dog, is that fine?',
    });

    expect(compose).toHaveBeenCalledTimes(1);
    const pkg = compose.mock.calls[0][0];
    const factKeys = pkg.facts.map((f: { key: string }) => f.key);
    expect(factKeys).toEqual(
      expect.arrayContaining(['cots_highchairs', 'dogs_allowed']),
    );
  });

  it('Problem 4: correction is NOT misclassified as complaint', async () => {
    const parser = {
      parse: jest
        .fn()
        .mockResolvedValue(
          baseParsed({ intent: 'correction', isCorrection: true }),
        ),
    } as unknown as ParserService;
    const composer = {
      compose: jest.fn().mockResolvedValue({
        ok: true,
        text: 'sorry, what would you like to know?',
      }),
    } as unknown as ComposerService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({ parser, composer, templates });

    await handler.handle({
      from: CUSTOMER,
      text: "I didn't ask about the heated pool",
    });

    const composeCall = (composer.compose as jest.Mock).mock.calls[0];
    expect(composeCall[0].scenarioHint).toBe('correction');
    expect(templates.render).not.toHaveBeenCalledWith(
      'complaint_handoff',
      expect.any(Object),
    );
  });

  it('Problem 5: polite close is NOT routed to unclear_handoff', async () => {
    const parser = {
      parse: jest
        .fn()
        .mockResolvedValue(baseParsed({ intent: 'polite_close' })),
    } as unknown as ParserService;
    const composer = {
      compose: jest
        .fn()
        .mockResolvedValue({ ok: true, text: 'Thanks, no rush.' }),
    } as unknown as ComposerService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({ parser, composer, templates });

    await handler.handle({ from: CUSTOMER, text: "Cool, I'll think about it" });

    const composeCall = (composer.compose as jest.Mock).mock.calls[0];
    expect(composeCall[0].scenarioHint).toBe('polite_close');
    expect(templates.render).not.toHaveBeenCalledWith(
      'unclear_handoff',
      expect.any(Object),
    );
  });

  it('Problem 6: parser nulls do NOT silently override stored pendingDates with carryover', async () => {
    // The parser MUST return null for dates absent from the current message.
    // The orchestrator merges with pendingDates from state intentionally — but
    // a fresh new-month message should produce fresh dates from the parser.
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'availability_inquiry',
          checkIn: new Date('2026-06-07'),
          checkOut: new Date('2026-06-14'),
        }),
      ),
    } as unknown as ParserService;
    const conversation = {
      parseCommand: jest.fn().mockReturnValue(null),
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'availability_inquiry',
        pendingDates: {
          checkIn: '2027-09-05',
          checkOut: '2027-09-12',
          guests: null,
        },
        customerName: null,
      }),
      updateContext: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
      setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
      recordQuote: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConversationService;
    const bookingRules = {
      validate: jest
        .fn()
        .mockReturnValue({ pass: false, reason: 'year_2026_redirect' }),
    } as unknown as BookingRulesService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({
      parser,
      conversation,
      bookingRules,
      templates,
    });

    await handler.handle({
      from: CUSTOMER,
      text: 'is the villa available in June 2026?',
    });

    // The booking-rules validator must be called with the JUNE 2026 dates from
    // the new message — NOT the September 2027 pending dates from state.
    expect(bookingRules.validate).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
    );
    const [ci] = (bookingRules.validate as jest.Mock).mock.calls[0];
    expect((ci as Date).toISOString().slice(0, 7)).toBe('2026-06');
  });

  it('Problem 8: greeting after history present sets needsGreeting=false in composition package', async () => {
    const parser = {
      parse: jest
        .fn()
        .mockResolvedValue(
          baseParsed({ intent: 'greeting', needsGreeting: false }),
        ),
    } as unknown as ParserService;
    const messageLog = {
      log: jest.fn().mockResolvedValue(undefined),
      recent: jest.fn().mockResolvedValue([
        { role: 'customer', text: 'hi' },
        { role: 'assistant', text: 'hi! how can I help?' },
        { role: 'customer', text: 'what about september?' },
        { role: 'assistant', text: 'September is a great month.' },
      ]),
    } as unknown as MessageLogService;
    const composer = {
      compose: jest.fn().mockResolvedValue({ ok: true, text: 'hi again' }),
    } as unknown as ComposerService;
    const handler = buildHandler({ parser, messageLog, composer });

    await handler.handle({ from: CUSTOMER, text: 'Hi' });

    const pkg = (composer.compose as jest.Mock).mock.calls[0][0];
    expect(pkg.toneFlags.needsGreeting).toBe(false);
    expect(pkg.isFirstMessage).toBe(false);
  });

  it('2026 month query short-circuits to year_2026_redirect (full year booked)', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'availability_inquiry',
          monthQuery: { year: 2026, month: 9 },
        }),
      ),
    } as unknown as ParserService;
    const bookingRules = {
      validate: jest.fn().mockResolvedValue({ pass: true }),
      isYearFullyBooked: jest
        .fn()
        .mockImplementation(async (y: number) => y === 2026),
      isInstantBookEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as BookingRulesService;
    const helpers = {
      findClosestAvailableWeek: jest.fn().mockResolvedValue(null),
      monthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      multiMonthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      getPricingForDateRange: jest.fn().mockResolvedValue(null),
      checkExistingHold: jest.fn().mockResolvedValue(null),
    } as unknown as HelpersService;
    const composer = {
      compose: jest.fn(),
    } as unknown as ComposerService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({
      parser,
      bookingRules,
      helpers,
      composer,
      templates,
    });

    await handler.handle({
      from: CUSTOMER,
      text: "i'd like to rent the house around september",
    });

    expect(templates.render).toHaveBeenCalledWith(
      'year_2026_redirect',
      expect.any(Object),
    );
    // The iCal is consulted first — the redirect only fires because the
    // summary came back empty (the flag alone is not trusted).
    expect(helpers.monthAvailabilitySummary).toHaveBeenCalledWith(2026, 9);
    expect(composer.compose).not.toHaveBeenCalled();
  });

  it('2026 month query lists weeks from iCal even when the year flag is stale', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'availability_inquiry',
          monthQuery: { year: 2026, month: 9 },
        }),
      ),
    } as unknown as ParserService;
    const bookingRules = {
      validate: jest.fn().mockResolvedValue({ pass: true }),
      isYearFullyBooked: jest
        .fn()
        .mockImplementation(async (y: number) => y === 2026),
      isInstantBookEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as BookingRulesService;
    const helpers = {
      findClosestAvailableWeek: jest.fn().mockResolvedValue(null),
      monthAvailabilitySummary: jest.fn().mockResolvedValue([
        {
          checkIn: new Date('2026-09-20'),
          checkOut: new Date('2026-09-27'),
          total: 3495,
          weeklyRate: 3495,
          usedBase: false,
        },
      ]),
      multiMonthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      getPricingForDateRange: jest.fn().mockResolvedValue(null),
      checkExistingHold: jest.fn().mockResolvedValue(null),
    } as unknown as HelpersService;
    const composer = {
      compose: jest.fn().mockResolvedValue({ ok: true, text: 'weeks list' }),
    } as unknown as ComposerService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({
      parser,
      bookingRules,
      helpers,
      composer,
      templates,
    });

    await handler.handle({
      from: CUSTOMER,
      text: 'what weeks are available in september?',
    });

    expect(templates.render).not.toHaveBeenCalledWith(
      'year_2026_redirect',
      expect.any(Object),
    );
    const pkg = (composer.compose as jest.Mock).mock.calls[0][0];
    const weeksFact = pkg.facts.find(
      (f: { key: string }) => f.key === 'available_weeks',
    );
    expect(weeksFact.text).toContain('20 September');
  });

  it('Problem 11: month query routes through helpers.monthAvailabilitySummary', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'availability_inquiry',
          monthQuery: { year: 2027, month: 9 },
        }),
      ),
    } as unknown as ParserService;
    const helpers = {
      findClosestAvailableWeek: jest.fn().mockResolvedValue(null),
      monthAvailabilitySummary: jest.fn().mockResolvedValue([
        {
          checkIn: new Date('2027-09-05'),
          checkOut: new Date('2027-09-12'),
          total: 4500,
          weeklyRate: 4500,
        },
      ]),
      multiMonthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      getPricingForDateRange: jest.fn().mockResolvedValue(null),
      checkExistingHold: jest.fn().mockResolvedValue(null),
    } as unknown as HelpersService;
    const composer = {
      compose: jest
        .fn()
        .mockResolvedValue({ ok: true, text: 'available weeks: ...' }),
    } as unknown as ComposerService;
    const handler = buildHandler({ parser, helpers, composer });

    await handler.handle({
      from: CUSTOMER,
      text: 'any availability in September 2027?',
    });

    expect(helpers.monthAvailabilitySummary).toHaveBeenCalledWith(2027, 9);
    const pkg = (composer.compose as jest.Mock).mock.calls[0][0];
    expect(pkg.scenarioHint).toBe('month_query');
    const factKeys = pkg.facts.map((f: { key: string }) => f.key);
    expect(factKeys).toContain('available_weeks');
  });

  it('Problem 10: wine harvest is appended once via the fixed-template path (no LLM duplication)', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'availability_inquiry',
          checkIn: new Date('2027-09-05'),
          checkOut: new Date('2027-09-12'),
        }),
      ),
    } as unknown as ParserService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const composer = {
      compose: jest.fn(),
    } as unknown as ComposerService;
    const handler = buildHandler({ parser, templates, composer });

    await handler.handle({ from: CUSTOMER, text: '5-12 Sep 2027?' });

    const renderKeys = (templates.render as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    // Quote fires once; harvest note fires once. No composer call (fixed path).
    expect(
      renderKeys.filter((k) => k === 'availability_yes_quote').length,
    ).toBe(1);
    expect(
      renderKeys.filter((k) => k === 'september_wine_harvest_note').length,
    ).toBe(1);
    expect(composer.compose).not.toHaveBeenCalled();
  });

  it('September month query injects season_september fact for the composer', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'availability_inquiry',
          monthQuery: { year: 2027, month: 9 },
        }),
      ),
    } as unknown as ParserService;
    const helpers = {
      findClosestAvailableWeek: jest.fn().mockResolvedValue(null),
      monthAvailabilitySummary: jest.fn().mockResolvedValue([
        {
          checkIn: new Date('2027-09-05'),
          checkOut: new Date('2027-09-12'),
          total: 4500,
          weeklyRate: 4500,
        },
      ]),
      multiMonthAvailabilitySummary: jest.fn().mockResolvedValue([]),
      getPricingForDateRange: jest.fn().mockResolvedValue(null),
      checkExistingHold: jest.fn().mockResolvedValue(null),
    } as unknown as HelpersService;
    const composer = {
      compose: jest.fn().mockResolvedValue({ ok: true, text: 'composed' }),
    } as unknown as ComposerService;
    const handler = buildHandler({ parser, helpers, composer });

    await handler.handle({
      from: CUSTOMER,
      text: 'any availability in September 2027?',
    });

    const pkg = (composer.compose as jest.Mock).mock.calls[0][0];
    const factKeys = pkg.facts.map((f: { key: string }) => f.key);
    expect(factKeys).toContain('season_september');
  });

  it('Customer providing email after booking ask routes to booking_email_received_handoff and persists email', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'booking_confirmation',
          guestEmail: 'guest@example.com',
        }),
      ),
    } as unknown as ParserService;
    const conversation = {
      parseCommand: jest.fn().mockReturnValue(null),
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'booking_confirmation',
        pendingDates: null,
        customerName: 'Nico',
      }),
      updateContext: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
      setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
      recordQuote: jest.fn().mockResolvedValue(undefined),
      recordEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConversationService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({ parser, conversation, templates });

    await handler.handle({
      from: CUSTOMER,
      text: 'and here is my email address for the booking, guest@example.com',
    });

    expect(conversation.recordEmail).toHaveBeenCalledWith(
      CUSTOMER,
      'guest@example.com',
    );
    expect(templates.render).toHaveBeenCalledWith(
      'booking_email_received_handoff',
      expect.objectContaining({ email: 'guest@example.com' }),
    );
    expect(templates.render).not.toHaveBeenCalledWith(
      'booking_confirmed_handoff',
      expect.any(Object),
    );
  });

  it('Email-bearing message after a booking ask is treated as booking_confirmation even if parser misclassifies', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(
        baseParsed({
          intent: 'off_topic_or_unclear',
          guestEmail: 'guest@example.com',
        }),
      ),
    } as unknown as ParserService;
    const conversation = {
      parseCommand: jest.fn().mockReturnValue(null),
      getState: jest.fn().mockResolvedValue({
        status: 'bot',
        lifecycleStatus: 'Responded',
        lastIntent: 'booking_confirmation',
        pendingDates: null,
        customerName: 'Nico',
      }),
      updateContext: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
      setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
      recordQuote: jest.fn().mockResolvedValue(undefined),
      recordEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConversationService;
    const templates = {
      render: jest.fn().mockResolvedValue('rendered'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const handler = buildHandler({ parser, conversation, templates });

    await handler.handle({
      from: CUSTOMER,
      text: 'guest@example.com',
    });

    expect(templates.render).toHaveBeenCalledWith(
      'booking_email_received_handoff',
      expect.objectContaining({ email: 'guest@example.com' }),
    );
  });

  it('Composer fallback path: invalid LLM output falls back to template + notifies owner', async () => {
    const parser = {
      parse: jest.fn().mockResolvedValue(baseParsed({ intent: 'greeting' })),
    } as unknown as ParserService;
    const composer = {
      compose: jest.fn().mockResolvedValue({
        ok: false,
        reason: 'forbidden_term:sold',
        raw: 'sold',
      }),
    } as unknown as ComposerService;
    const templates = {
      render: jest.fn().mockResolvedValue('greeting fallback'),
      fetchRaw: jest.fn().mockResolvedValue([]),
    } as unknown as TemplatesService;
    const notifications = {
      notifyOwner: jest.fn().mockResolvedValue(undefined),
      notifyOwnerAboutConversation: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const handler = buildHandler({
      parser,
      composer,
      templates,
      notifications,
    });

    await handler.handle({ from: CUSTOMER, text: 'hello' });

    expect(templates.render).toHaveBeenCalledWith(
      'greeting_ask_dates',
      expect.any(Object),
    );
    expect(notifications.notifyOwnerAboutConversation).toHaveBeenCalledWith(
      CUSTOMER,
      'composer_fallback',
      expect.any(Object),
    );
  });
});
