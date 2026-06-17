import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AvailabilityService } from '../availability/availability.service';
import { BookingRulesService } from '../booking-rules/booking-rules.service';
import {
  ComposerService,
  CompositionFact,
  CompositionPackage,
} from '../composer/composer.service';
import {
  ConversationService,
  ParsedCommand,
  PendingDates,
} from '../conversation/conversation.service';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { Fragment, FragmentsService } from '../fragments/fragments.service';
import { HelpersService, WeekWithPrice } from '../helpers/helpers.service';
import { HoldsService } from '../holds/holds.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { LoggerService } from '../logger/logger.service';
import { MessageLogService } from '../messagelog/messagelog.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  HistoryMessage,
  Intent,
  ParseResult,
  ParserService,
} from '../parser/parser.service';
import { PricingService } from '../pricing/pricing.service';
import { TemplatesService, TemplateVars } from '../templates/templates.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const PAUSE_ON_HANDOFF_MIN = 60;
const HISTORY_LIMIT = 10;
const SEPTEMBER = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEBSITE_URL = 'www.bontemaison.com';
const SCENARIOS_WITH_WEBSITE = new Set(['general_info']);
const SCENARIOS_SKIP_WEBSITE_LINK = new Set(['greeting']);

type IncomingMessage = { from: string; text: string; profileName?: string };

type MergedIntent = {
  checkIn: Date | null;
  checkOut: Date | null;
  guests: number | null;
  customerName: string | null;
};

@Injectable()
export class MessageHandlerService {
  private readonly ownerPhone: string | undefined;

  constructor(
    private readonly parser: ParserService,
    private readonly availability: AvailabilityService,
    private readonly pricing: PricingService,
    private readonly bookingRules: BookingRulesService,
    private readonly holds: HoldsService,
    private readonly followUps: FollowUpsService,
    private readonly templates: TemplatesService,
    private readonly composer: ComposerService,
    private readonly fragments: FragmentsService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly helpers: HelpersService,
    private readonly whatsapp: WhatsappService,
    private readonly conversation: ConversationService,
    private readonly messageLog: MessageLogService,
    private readonly notifications: NotificationsService,
    private readonly logger: LoggerService,
    config: ConfigService,
  ) {
    this.ownerPhone = config.get<string>('OWNER_PHONE');
  }

  async handleOwnerTakeover(phone: string): Promise<void> {
    if (phone === this.ownerPhone) return; // owner messaging themselves — ignore

    this.logger.info('conversation', 'human takeover detected — pausing bot for conversation', {
      phone,
    });

    try {
      await this.conversation.setStatus(phone, 'human');
    } catch (err) {
      this.logger.error('conversation', 'takeover setStatus failed', {
        phone,
        error: (err as Error).message,
      });
    }

    try {
      await this.followUps.cancel(phone);
    } catch (err) {
      this.logger.warn('follow-ups', 'cancel on takeover failed', {
        phone,
        error: (err as Error).message,
      });
    }

    // Coexistence heartbeat: any owner echo proves Jim's WhatsApp Business
    // app is alive, so reset the 13-day timer. Best-effort — never throws.
    try {
      await this.bookingRules.recordOwnerEchoSeen();
    } catch (err) {
      this.logger.warn('booking-rules', 'recordOwnerEchoSeen failed', {
        phone,
        error: (err as Error).message,
      });
    }
  }

  async handle(msg: IncomingMessage): Promise<void> {
    await this.messageLog.log(msg.from, 'in', msg.text);

    const cmd = this.conversation.parseCommand(msg.text);
    if (cmd) {
      if (msg.from !== this.ownerPhone) {
        this.logger.warn('conversation', 'ignoring command from non-owner', {
          from: msg.from,
        });
        return;
      }
      await this.runOwnerCommand(cmd);
      return;
    }

    try {
      await this.followUps.cancel(msg.from);
    } catch (err) {
      this.logger.warn('follow-ups', 'cancel on inbound failed', {
        from: msg.from,
        error: (err as Error).message,
      });
    }

    const state = await this.conversation.getState(msg.from);
    if (state.status !== 'bot') {
      this.logger.info('conversation', 'silent drop: not in bot mode', {
        from: msg.from,
        status: state.status,
      });
      return;
    }

    const storedName = state.customerName ?? msg.profileName ?? null;
    const previousIntent = state.lastIntent;

    try {
      const history = await this.messageLog.recent(msg.from, HISTORY_LIMIT);
      const kbTopics = await this.fetchTopicHintsSafe();
      const parsed = await this.parser.parse(msg.text, history, kbTopics);
      const merged = this.mergeWithPending(
        {
          checkIn: parsed.checkIn,
          checkOut: parsed.checkOut,
          guests: parsed.guests,
          customerName: parsed.customerName,
        },
        state.pendingDates,
        storedName,
      );

      await this.conversation.updateContext(msg.from, {
        lastIntent: parsed.intent,
        customerName: merged.customerName ?? undefined,
        pendingDates: this.serializePending(merged),
      });

      if (parsed.guestEmail) {
        try {
          await this.conversation.recordEmail(msg.from, parsed.guestEmail);
        } catch (err) {
          this.logger.warn('conversation', 'recordEmail failed', {
            from: msg.from,
            error: (err as Error).message,
          });
        }
      }

      if (parsed.mentionsDiscount) {
        await this.handoffTemplate(msg.from, msg.text, 'discount_request', {
          name: merged.customerName ?? '',
        });
        return;
      }

      await this.route(msg.from, parsed, merged, history, previousIntent);
    } catch (err) {
      const error = (err as Error).message;
      this.logger.error('conversation', 'message handling failed', {
        from: msg.from,
        error,
      });
      await this.handoffTemplate(
        msg.from,
        msg.text,
        'unclear_handoff',
        { name: storedName ?? '' },
        { reason: 'orchestrator_error', extra: { error } },
      );
    }
  }

  private async route(
    from: string,
    parsed: ParseResult,
    merged: MergedIntent,
    history: HistoryMessage[],
    previousIntent: string | null,
  ): Promise<void> {
    const name = merged.customerName ?? '';

    // After the bot suggested Sunday-to-Sunday dates via dates_not_sunday_to_sunday
    // (or minimum_stay_not_met), a short affirmative ("yes please", "ok", "yes is
    // it available then") is the customer confirming those suggested dates. Run
    // availability for the pending Sun dates — not booking_confirmed_handoff,
    // not the same not-Sunday template again.
    if (
      previousIntent === 'awaiting_dates_confirmation' &&
      merged.checkIn &&
      merged.checkOut &&
      (parsed.intent === 'acknowledgment' ||
        parsed.intent === 'booking_confirmation' ||
        parsed.intent === 'availability_inquiry' ||
        parsed.intent === 'polite_close')
    ) {
      await this.handleAvailability(from, merged);
      return;
    }

    const intent =
      parsed.guestEmail && previousIntent === 'booking_confirmation'
        ? 'booking_confirmation'
        : parsed.intent;

    switch (intent) {
      case 'greeting':
        if (merged.checkIn && merged.checkOut) {
          await this.handleAvailability(from, merged);
          return;
        }
        await this.composeOrFallback(from, parsed, merged, history, {
          scenario: 'greeting',
          fallbackKey: 'greeting_ask_dates',
        });
        return;

      case 'availability_inquiry':
      case 'pricing_inquiry':
        if (parsed.monthQuery || parsed.monthRangeQuery) {
          await this.handleMonthQuery(from, parsed, merged, history);
          return;
        }
        // Customer asked for availability without giving fresh dates this turn.
        // If we have dates carried over from a previous turn (pendingDates), don't
        // silently re-run availability on the old dates — confirm them first so
        // the customer can either re-affirm ("yes please" → handled by the
        // awaiting_dates_confirmation guard above) or share new dates.
        if (!parsed.checkIn && !parsed.checkOut && merged.checkIn && merged.checkOut) {
          await this.sendDateReconfirmation(from, merged);
          return;
        }
        if (!merged.checkIn || !merged.checkOut) {
          await this.composeOrFallback(from, parsed, merged, history, {
            scenario: 'dates_unclear',
            fallbackKey: 'dates_unclear_ask_clarify',
          });
          return;
        }
        await this.handleAvailability(from, merged);
        return;

      case 'general_info':
        await this.handleGeneralInfo(from, parsed, merged, history);
        return;

      case 'booking_confirmation': {
        const templateKey = parsed.guestEmail
          ? 'booking_email_received_handoff'
          : 'booking_confirmed_handoff';
        const vars: TemplateVars = parsed.guestEmail
          ? { name, email: parsed.guestEmail }
          : { name };
        await this.handoffTemplate(from, '', templateKey, vars);
        try {
          await this.conversation.setLifecycleStatus(from, 'Booked');
        } catch (err) {
          this.logger.warn('conversation', 'set Booked failed', {
            from,
            error: (err as Error).message,
          });
        }
        return;
      }

      case 'hold_request':
        await this.handleHoldRequest(from, merged);
        return;

      case 'human_request':
        await this.handoffTemplate(
          from,
          '',
          'human_request_handoff',
          { name },
          undefined,
          { pause: true },
        );
        return;

      case 'acknowledgment':
        if (previousIntent === 'acknowledgment') {
          this.logger.info('conversation', 'silent drop: repeat acknowledgment', {
            from,
          });
          return;
        }
        await this.composeOrFallback(from, parsed, merged, history, {
          scenario: 'acknowledgment',
          fallbackKey: 'acknowledgment_reply',
        });
        return;

      case 'polite_close':
        await this.composeOrFallback(from, parsed, merged, history, {
          scenario: 'polite_close',
          fallbackKey: 'acknowledgment_reply',
        });
        return;

      case 'correction':
        await this.composeOrFallback(from, parsed, merged, history, {
          scenario: 'correction',
          fallbackKey: 'unclear_handoff',
        });
        return;

      case 'complaint_or_frustration':
        await this.handoffTemplate(
          from,
          '',
          'complaint_handoff',
          { name },
          undefined,
          { pause: true },
        );
        return;

      case 'off_topic_or_unclear':
      default:
        await this.composeOrFallback(from, parsed, merged, history, {
          scenario: 'unclear',
          fallbackKey: 'unclear_handoff',
        });
        return;
    }
  }

  private async handleAvailability(
    from: string,
    merged: MergedIntent,
  ): Promise<void> {
    if (!merged.checkIn || !merged.checkOut) return;
    const name = merged.customerName ?? '';

    const rule = await this.bookingRules.validate(merged.checkIn, merged.checkOut);
    if (!rule.pass) {
      switch (rule.reason) {
        case 'year_2026_redirect':
          await this.sendTemplate(from, 'year_2026_redirect', {
            name,
            month_phrase: this.monthPhraseForDate(merged.checkIn),
          });
          return;
        case 'not_sunday':
          await this.sendTemplate(from, 'dates_not_sunday_to_sunday', {
            name,
            suggested_check_in: this.formatDate(new Date(rule.suggestedCheckIn)),
            suggested_check_out: this.formatDate(
              new Date(rule.suggestedCheckOut),
            ),
          });
          await this.parkSuggestedDates(
            from,
            rule.suggestedCheckIn,
            rule.suggestedCheckOut,
          );
          return;
        case 'min_stay':
          await this.sendTemplate(from, 'minimum_stay_not_met', {
            name,
            suggested_check_in: this.formatDate(new Date(rule.suggestedCheckIn)),
            suggested_check_out: this.formatDate(
              new Date(rule.suggestedCheckOut),
            ),
          });
          await this.parkSuggestedDates(
            from,
            rule.suggestedCheckIn,
            rule.suggestedCheckOut,
          );
          return;
        case 'long_stay_manual':
          await this.handoffTemplate(from, '', 'long_stay_manual_pricing', {
            name,
          });
          return;
      }
    }

    const held = await this.holds.hasOverlap(merged.checkIn, merged.checkOut);
    const icalOk = held
      ? false
      : await this.availability.isRangeAvailable(merged.checkIn, merged.checkOut);

    const datesLabel = `${this.isoDate(merged.checkIn)} → ${this.isoDate(merged.checkOut)}`;

    if (!icalOk) {
      await this.sendTemplate(from, 'availability_no_priority', {
        name,
        name_comma: name ? `, ${name}` : '',
        check_in: this.formatDate(merged.checkIn),
        check_out: this.formatDate(merged.checkOut),
        month: this.monthName(merged.checkIn),
      });
      await this.recordQuoteSafe(from, datesLabel, 0, 'unavailable');
      await this.notifications.notifyOwnerAboutConversation(
        from,
        held ? 'hold_conflict' : 'dates_unavailable',
        { intent: 'availability_inquiry', extra: { held } },
      );
      return;
    }

    const quote = await this.pricing.calculate(merged.checkIn, merged.checkOut);

    // The week is free, but it falls in a period Jim hasn't priced yet (no
    // seasonal band — only the base/fallback rate matched). Don't quote the
    // base rate as a firm price; confirm it's open, say the rate will follow,
    // and flag it to Jim.
    if (quote.usedBase) {
      await this.sendTemplate(from, 'availability_pending_pricing', {
        name,
        name_comma: name ? `, ${name}` : '',
        check_in: this.formatDate(merged.checkIn),
        check_out: this.formatDate(merged.checkOut),
        year: String(merged.checkIn.getUTCFullYear()),
      });
      await this.recordQuoteSafe(from, datesLabel, 0, 'pending');
      await this.notifications.notifyOwnerAboutConversation(
        from,
        'pricing_pending',
        {
          intent: 'availability_inquiry',
          extra: { year: merged.checkIn.getUTCFullYear() },
        },
      );
      try {
        await this.followUps.schedule(from);
      } catch (err) {
        this.logger.warn('follow-ups', 'schedule after pending-pricing failed', {
          from,
          error: (err as Error).message,
        });
      }
      return;
    }

    const quoteText = await this.templates.render('availability_yes_quote', {
      name,
      check_in: this.formatDate(merged.checkIn),
      check_out: this.formatDate(merged.checkOut),
      nights: quote.nights,
      price: this.formatPrice(quote.total),
    });

    let combined = quoteText;
    if (this.shouldAppendHarvest(merged.checkIn, merged.checkOut)) {
      try {
        const note = await this.templates.render('september_wine_harvest_note', {});
        combined = this.insertBeforeSignOff(combined, note);
      } catch (err) {
        this.logger.warn('templates', 'wine harvest append failed', {
          error: (err as Error).message,
        });
      }
    }

    const finalCombined = this.ensureWebsiteLink(combined);
    await this.whatsapp.sendMessage(from, finalCombined);
    await this.messageLog.log(from, 'out', finalCombined);
    await this.markResponded(from);

    await this.recordQuoteSafe(from, datesLabel, quote.total, 'available');

    try {
      await this.followUps.schedule(from);
    } catch (err) {
      this.logger.warn('follow-ups', 'schedule after quote failed', {
        from,
        error: (err as Error).message,
      });
    }
  }

  private async handleHoldRequest(
    from: string,
    merged: MergedIntent,
  ): Promise<void> {
    const name = merged.customerName ?? '';

    if (!merged.checkIn || !merged.checkOut) {
      await this.sendTemplate(from, 'dates_unclear_ask_clarify', { name });
      return;
    }

    const rule = await this.bookingRules.validate(merged.checkIn, merged.checkOut);
    if (!rule.pass) {
      switch (rule.reason) {
        case 'year_2026_redirect':
          await this.sendTemplate(from, 'year_2026_redirect', {
            name,
            month_phrase: this.monthPhraseForDate(merged.checkIn),
          });
          return;
        case 'not_sunday':
          await this.sendTemplate(from, 'dates_not_sunday_to_sunday', {
            name,
            suggested_check_in: this.formatDate(new Date(rule.suggestedCheckIn)),
            suggested_check_out: this.formatDate(new Date(rule.suggestedCheckOut)),
          });
          await this.parkSuggestedDates(
            from,
            rule.suggestedCheckIn,
            rule.suggestedCheckOut,
          );
          return;
        case 'min_stay':
          await this.sendTemplate(from, 'minimum_stay_not_met', {
            name,
            suggested_check_in: this.formatDate(new Date(rule.suggestedCheckIn)),
            suggested_check_out: this.formatDate(new Date(rule.suggestedCheckOut)),
          });
          await this.parkSuggestedDates(
            from,
            rule.suggestedCheckIn,
            rule.suggestedCheckOut,
          );
          return;
        case 'long_stay_manual':
          await this.handoffTemplate(from, '', 'long_stay_manual_pricing', {
            name,
          });
          return;
      }
    }

    const held = await this.holds.hasOverlap(merged.checkIn, merged.checkOut);
    const icalOk = held
      ? false
      : await this.availability.isRangeAvailable(merged.checkIn, merged.checkOut);

    if (!icalOk) {
      const datesLabel = `${this.isoDate(merged.checkIn)} → ${this.isoDate(merged.checkOut)}`;
      await this.sendTemplate(from, 'availability_no_priority', {
        name,
        name_comma: name ? `, ${name}` : '',
        check_in: this.formatDate(merged.checkIn),
        check_out: this.formatDate(merged.checkOut),
        month: this.monthName(merged.checkIn),
      });
      await this.recordQuoteSafe(from, datesLabel, 0, 'unavailable');
      await this.notifications.notifyOwnerAboutConversation(
        from,
        held ? 'hold_conflict' : 'dates_unavailable',
        { intent: 'hold_request', extra: { held } },
      );
      return;
    }

    const hold = await this.holds.createHold(from, merged.checkIn, merged.checkOut);
    await this.sendTemplate(from, 'hold_confirmed', {
      name,
      check_in: this.formatDate(merged.checkIn),
      check_out: this.formatDate(merged.checkOut),
      hold_expiry: this.formatDate(new Date(hold.fields.hold_expires_at)),
    });
  }

  private async handleGeneralInfo(
    from: string,
    parsed: ParseResult,
    merged: MergedIntent,
    history: HistoryMessage[],
  ): Promise<void> {
    const knowledgeFacts = await this.assembleKnowledgeFacts(
      parsed.topicKeys,
      merged.customerName,
    );

    if (knowledgeFacts.length === 0) {
      await this.composeOrFallback(from, parsed, merged, history, {
        scenario: 'faq_unknown',
        fallbackKey: 'faq_unknown_handoff',
      });
      await this.notifications.notifyOwnerAboutConversation(
        from,
        'faq_unknown',
        { intent: 'general_info' },
      );
      return;
    }

    await this.composeOrFallback(from, parsed, merged, history, {
      scenario: 'general_info',
      fallbackKey: 'faq_unknown_handoff',
      knowledgeFragments: [],
      extraFacts: knowledgeFacts,
    });
  }

  private async handleMonthQuery(
    from: string,
    parsed: ParseResult,
    merged: MergedIntent,
    history: HistoryMessage[],
  ): Promise<void> {
    const name = merged.customerName ?? '';
    const years = this.monthQueryYears(parsed);
    const yearBlocks = await Promise.all(
      years.map((y) => this.bookingRules.isYearFullyBooked(y)),
    );
    const allBlocked = years.length > 0 && yearBlocks.every(Boolean);
    if (allBlocked) {
      await this.sendTemplate(from, 'year_2026_redirect', {
        name,
        month_phrase: this.monthQueryPhrase(parsed),
      });
      return;
    }

    const facts: CompositionFact[] = [];
    let summary: WeekWithPrice[] = [];
    let periodLabel = '';
    let periodPreposition = 'in';
    if (parsed.monthQuery) {
      summary = await this.helpers.monthAvailabilitySummary(
        parsed.monthQuery.year,
        parsed.monthQuery.month,
      );
      periodLabel = this.formatMonthYear(parsed.monthQuery);
    } else if (parsed.monthRangeQuery) {
      summary = await this.helpers.multiMonthAvailabilitySummary(
        parsed.monthRangeQuery.start,
        parsed.monthRangeQuery.end,
      );
      periodLabel = `${this.formatMonthYear(parsed.monthRangeQuery.start)}–${this.formatMonthYear(parsed.monthRangeQuery.end)}`;
      periodPreposition = 'across';
    }

    if (summary.length === 0) {
      facts.push({
        key: 'available_weeks',
        text: `No Sunday-to-Sunday weeks are available ${periodPreposition} ${periodLabel}.`,
      });
    } else {
      facts.push({
        key: 'available_weeks',
        text: summary
          .map((w) =>
            w.usedBase
              ? `${this.formatDate(w.checkIn)} to ${this.formatDate(w.checkOut)} (rate to be confirmed)`
              : `${this.formatDate(w.checkIn)} to ${this.formatDate(w.checkOut)} at ${this.formatPrice(w.total)}`,
          )
          .join('\n'),
      });
      // Weeks marked "(rate to be confirmed)" fall in a period Jim hasn't
      // priced yet. The composer must not invent a price for them.
      if (summary.some((w) => w.usedBase)) {
        facts.push({
          key: 'pricing_pending',
          text: "Some weeks above show '(rate to be confirmed)' because we haven't finalised rates for that period yet. List those weeks as open, but NEVER state or invent a price for them — say the exact rate will be confirmed and you'll come back with it. Only quote a price for weeks that already show one.",
        });
      }
    }

    await this.composeOrFallback(from, parsed, merged, history, {
      scenario: 'month_query',
      fallbackKey: 'dates_unclear_ask_clarify',
      extraFacts: facts,
    });
  }

  private async composeOrFallback(
    from: string,
    parsed: ParseResult,
    merged: MergedIntent,
    history: HistoryMessage[],
    options: {
      scenario: string;
      fallbackKey: string;
      knowledgeFragments?: Fragment[];
      extraFacts?: CompositionFact[];
    },
  ): Promise<void> {
    const pkg = await this.buildCompositionPackage(
      parsed,
      merged,
      history,
      options,
    );
    const result = await this.composer.compose(pkg);
    const skipWebsiteLink = SCENARIOS_SKIP_WEBSITE_LINK.has(options.scenario);

    if (result.ok) {
      const finalText = skipWebsiteLink
        ? result.text
        : this.ensureWebsiteLink(result.text);
      await this.whatsapp.sendMessage(from, finalText);
      await this.messageLog.log(from, 'out', finalText);
      await this.markResponded(from);
      return;
    }

    this.logger.warn('templates', 'composer fallback to template', {
      from,
      scenario: options.scenario,
      fallbackKey: options.fallbackKey,
      reason: result.reason,
    });
    await this.notifications.notifyOwnerAboutConversation(from, 'composer_fallback', {
      intent: parsed.intent,
      extra: { reason: result.reason, scenario: options.scenario },
    });
    await this.sendTemplate(
      from,
      options.fallbackKey,
      { name: merged.customerName ?? '' },
      { appendWebsite: !skipWebsiteLink },
    );
  }

  private async buildCompositionPackage(
    parsed: ParseResult,
    merged: MergedIntent,
    history: HistoryMessage[],
    options: {
      scenario: string;
      knowledgeFragments?: Fragment[];
      extraFacts?: CompositionFact[];
    },
  ): Promise<CompositionPackage> {
    const knowledge =
      options.knowledgeFragments ?? (await this.fetchKnowledgeFragmentsSafe(parsed.topicKeys));
    const openers = await this.fetchByCategorySafe('opener');
    const nudges = await this.fetchByCategorySafe('nudge');

    const facts: CompositionFact[] = knowledge.map((f) => ({
      key: f.key,
      text: f.text,
    }));
    if (options.extraFacts) facts.push(...options.extraFacts);

    if (this.touchesSeptember(parsed, merged)) {
      facts.push({
        key: 'season_september',
        text:
          "September is the start of the wine harvest in this part of the Dordogne. Vineyards are busy, evenings are usually still warm, and there are local food and wine events around. Mention this once, naturally, where it fits.",
      });
    }

    if (SCENARIOS_WITH_WEBSITE.has(options.scenario)) {
      const websiteText = `Point the guest to ${WEBSITE_URL} for more detail on the topic they asked about, in a single short sentence (e.g. "More on the website if helpful: ${WEBSITE_URL}").`;
      facts.push({ key: 'website', text: websiteText });
    }

    const scenarioGuidance = this.scenarioGuidance(options.scenario);
    if (scenarioGuidance) {
      facts.push({ key: 'scenario_guidance', text: scenarioGuidance });
    }

    // Some scenarios should always nudge toward booking even without an explicit
    // high-intent signal — a month-availability ask or a polite ack after we've
    // just quoted options. Without this, the bot lists weeks then ends flat,
    // never offering to hold.
    const SCENARIOS_FORCE_NUDGE = new Set(['month_query', 'polite_close']);
    const needsNudgeToBook =
      parsed.highIntentSignal || SCENARIOS_FORCE_NUDGE.has(options.scenario);

    return {
      scenarioHint: options.scenario,
      guestName: merged.customerName,
      isFirstMessage: history.length <= 1,
      toneFlags: {
        needsGreeting: parsed.needsGreeting,
        needsAcknowledgment: parsed.needsAcknowledgment,
        needsNudgeToBook,
        needsSignOff: true,
      },
      facts,
      openers: openers.map((f) => f.text),
      closers: [],
      nudges: nudges.map((f) => f.text),
      history,
    };
  }

  private async fetchKnowledgeFragmentsSafe(
    topicKeys: string[],
  ): Promise<Fragment[]> {
    if (topicKeys.length === 0) return [];
    try {
      return await this.fragments.fetchByTopicKeys(topicKeys);
    } catch (err) {
      this.logger.warn('templates', 'fetchByTopicKeys failed', {
        topicKeys,
        error: (err as Error).message,
      });
      return [];
    }
  }

  private async fetchByCategorySafe(
    category: 'opener' | 'closer' | 'nudge' | 'knowledge',
  ): Promise<Fragment[]> {
    try {
      return await this.fragments.listByCategory(category);
    } catch (err) {
      this.logger.warn('templates', 'listByCategory failed', {
        category,
        error: (err as Error).message,
      });
      return [];
    }
  }

  private async fetchTopicHintsSafe(): Promise<
    Array<{ topicKey: string; questionExamples: string }>
  > {
    try {
      const [fragments, kbTopics] = await Promise.all([
        this.fragments.listByCategory('knowledge').catch(() => []),
        this.knowledgeBase.listTopics().catch(() => []),
      ]);
      const examplesByKey = new Map<string, string>();
      for (const t of kbTopics) examplesByKey.set(t.topicKey, t.questionExamples);
      const allKeys = new Set<string>(examplesByKey.keys());
      for (const f of fragments) {
        for (const t of f.topicKeys) allKeys.add(t);
      }
      return Array.from(allKeys).map((topicKey) => ({
        topicKey,
        questionExamples: examplesByKey.get(topicKey) ?? '',
      }));
    } catch (err) {
      this.logger.warn('templates', 'topic hint fetch failed', {
        error: (err as Error).message,
      });
      return [];
    }
  }

  private async assembleKnowledgeFacts(
    topicKeys: string[],
    customerName: string | null,
  ): Promise<CompositionFact[]> {
    if (topicKeys.length === 0) return [];

    const fragments = await this.fetchKnowledgeFragmentsSafe(topicKeys);
    const facts: CompositionFact[] = fragments.map((f) => ({
      key: f.key,
      text: f.text,
    }));

    const covered = new Set<string>();
    for (const f of fragments) {
      for (const t of f.topicKeys) covered.add(t);
    }
    const missing = topicKeys.filter((k) => !covered.has(k));

    for (const key of missing) {
      try {
        const answer = await this.knowledgeBase.render(key, {
          name: customerName ?? '',
        });
        if (answer) facts.push({ key: `kb_${key}`, text: answer });
      } catch (err) {
        this.logger.warn('templates', 'KB fallback failed', {
          key,
          error: (err as Error).message,
        });
      }
    }

    return facts;
  }

  private async runOwnerCommand(cmd: ParsedCommand): Promise<void> {
    if (!this.ownerPhone) return;

    if (cmd.command === 'pause') {
      if (cmd.phone) {
        await this.conversation.setStatus(
          cmd.phone,
          'paused',
          cmd.minutes ? { pauseForMinutes: cmd.minutes } : {},
        );
        const who = this.formatPhone(cmd.phone);
        const body = cmd.minutes
          ? `Paused ${who} for ${cmd.minutes} minute${cmd.minutes === 1 ? '' : 's'}.\nBot will pick it back up automatically after that.`
          : `Paused ${who}.\nBot won't reply on this conversation until you /resume ${who}.`;
        await this.notifications.notifyOwner(body, {
          reason: 'owner_command',
          extra: { command: 'pause', target: cmd.phone },
        });
        return;
      }
      await this.conversation.setGlobalPaused(true);
      await this.notifications.notifyOwner(
        "Bot paused.\nNo conversations will get a reply until you send /resume.",
        { reason: 'owner_command', extra: { command: 'pause', scope: 'global' } },
      );
      return;
    }

    if (cmd.command === 'resume') {
      if (cmd.phone) {
        await this.conversation.setStatus(cmd.phone, 'bot');
        const who = this.formatPhone(cmd.phone);
        await this.notifications.notifyOwner(
          `Resumed ${who}.\nBot is replying on this conversation again.`,
          {
            reason: 'owner_command',
            extra: { command: 'resume', target: cmd.phone },
          },
        );
        return;
      }
      await this.conversation.setGlobalPaused(false);
      await this.notifications.notifyOwner(
        "Bot back on.\nReplying to conversations again.",
        {
          reason: 'owner_command',
          extra: { command: 'resume', scope: 'global' },
        },
      );
      return;
    }

    if (cmd.command === 'release') {
      if (!cmd.phone) {
        await this.notifications.notifyOwner(
          "/release needs a phone number.\nExample: /release 447712345678",
          { reason: 'owner_command', extra: { command: 'release' } },
        );
        return;
      }
      await this.conversation.setStatus(cmd.phone, 'human');
      const who = this.formatPhone(cmd.phone);
      await this.notifications.notifyOwner(
        `${who} is yours now.\nBot will stay quiet — you're handling this one.`,
        {
          reason: 'owner_command',
          extra: { command: 'release', target: cmd.phone },
        },
      );
      return;
    }

    if (cmd.command === 'status') {
      if (cmd.phone) {
        const state = await this.conversation.getState(cmd.phone);
        const who = this.formatPhone(cmd.phone);
        const statusLabel = this.formatConversationStatus(state.status);
        const lines: string[] = [`${who} — ${statusLabel}`];
        if (state.customerName) lines.push(`Name: ${state.customerName}`);
        if (state.lastIntent) {
          lines.push(`Last topic: ${this.formatIntent(state.lastIntent)}`);
        }
        await this.notifications.notifyOwner(lines.join('\n'), {
          reason: 'owner_command',
          extra: { command: 'status', target: cmd.phone },
        });
        return;
      }
      const [globalPaused, counts] = await Promise.all([
        this.conversation.getGlobalPaused(),
        this.conversation.statusCounts().catch(() => null),
      ]);
      const header = globalPaused ? 'Bot is paused.' : 'Bot is active.';
      const lines: string[] = [header];
      if (counts) {
        const items: string[] = [];
        if (counts.bot > 0) {
          items.push(
            `• ${counts.bot} ${globalPaused ? 'waiting' : 'on the bot'}`,
          );
        }
        if (counts.human > 0) items.push(`• ${counts.human} with you`);
        if (counts.paused > 0) items.push(`• ${counts.paused} paused`);
        if (items.length === 0) items.push('• No active conversations.');
        lines.push('', ...items);
      }
      await this.notifications.notifyOwner(lines.join('\n'), {
        reason: 'owner_command',
        extra: { command: 'status', scope: 'global' },
      });
      return;
    }
  }

  private formatPhone(phone: string): string {
    return phone.startsWith('+') ? phone : `+${phone}`;
  }

  private formatConversationStatus(s: 'bot' | 'human' | 'paused'): string {
    if (s === 'bot') return 'bot is replying';
    if (s === 'human') return 'with you';
    return 'paused';
  }

  private formatIntent(intent: string): string {
    const map: Record<string, string> = {
      availability_inquiry: 'availability question',
      pricing_inquiry: 'pricing question',
      greeting: 'greeting',
      general_info: 'general question',
      booking_confirmation: 'booking confirmation',
      hold_request: 'hold request',
      discount_request: 'discount request',
      human_request: 'asked to speak with you',
      complaint_or_frustration: 'complaint',
      off_topic_or_unclear: 'unclear / off-topic',
      acknowledgment: 'thanks / acknowledgement',
      polite_close: 'winding down',
      correction: 'correction',
    };
    return map[intent] ?? intent.replace(/_/g, ' ');
  }

  private async sendTemplate(
    to: string,
    key: string,
    vars: TemplateVars,
    options: { override?: boolean; appendWebsite?: boolean } = {},
  ): Promise<void> {
    const rendered = await this.templates.render(key, vars);
    const text =
      options.appendWebsite === false
        ? rendered
        : this.ensureWebsiteLink(rendered);
    await this.whatsapp.sendMessage(to, text, { override: options.override });
    await this.messageLog.log(to, 'out', text);
    await this.markResponded(to);
  }

  private async markResponded(phone: string): Promise<void> {
    try {
      await this.conversation.setLifecycleStatus(phone, 'Responded');
    } catch (err) {
      this.logger.warn('conversation', 'set Responded failed', {
        phone,
        error: (err as Error).message,
      });
    }
  }

  private async recordQuoteSafe(
    phone: string,
    datesRequested: string,
    priceQuoted: number,
    result: 'available' | 'unavailable' | 'pending',
  ): Promise<void> {
    try {
      await this.conversation.recordQuote(
        phone,
        datesRequested,
        priceQuoted,
        result,
      );
    } catch (err) {
      this.logger.warn('conversation', 'recordQuote failed', {
        phone,
        error: (err as Error).message,
      });
    }
  }

  private async handoffTemplate(
    from: string,
    originalText: string,
    templateKey: string,
    vars: TemplateVars = {},
    notification?: { reason?: string; extra?: Record<string, unknown> },
    options: { pause?: boolean } = {},
  ): Promise<void> {
    if (options.pause) {
      try {
        await this.conversation.setStatus(from, 'paused', {
          pauseForMinutes: PAUSE_ON_HANDOFF_MIN,
        });
      } catch (err) {
        this.logger.error('conversation', 'failed to set pause status', {
          from,
          error: (err as Error).message,
        });
      }
    }

    try {
      await this.sendTemplate(from, templateKey, vars, { override: true });
    } catch (err) {
      this.logger.error('conversation', 'failed to send handoff reply', {
        from,
        templateKey,
        error: (err as Error).message,
      });
    }

    const reason = notification?.reason ?? this.handoffReason(templateKey);
    if (from) {
      await this.notifications.notifyOwnerAboutConversation(from, reason, {
        message: originalText || undefined,
        extra: notification?.extra,
      });
    } else {
      await this.notifications.notifyOwner(`needs attention: ${reason}`, {
        reason,
        message: originalText || undefined,
        extra: notification?.extra,
      });
    }
  }

  private handoffReason(templateKey: string): string {
    switch (templateKey) {
      case 'discount_request':
        return 'discount_request';
      case 'long_stay_manual_pricing':
        return 'long_stay_manual_pricing';
      case 'faq_unknown_handoff':
        return 'faq_unknown';
      case 'complaint_handoff':
        return 'complaint';
      case 'human_request_handoff':
        return 'human_request';
      case 'booking_confirmed_handoff':
      case 'booking_confirmed_instant_book':
        return 'booking_confirmation';
      case 'unclear_handoff':
      default:
        return 'unclear_or_off_topic';
    }
  }

  private mergeWithPending(
    parsed: MergedIntent,
    pending: PendingDates | null,
    storedName: string | null,
  ): MergedIntent {
    const pendingCheckIn = pending?.checkIn
      ? this.parseIso(pending.checkIn)
      : null;
    const pendingCheckOut = pending?.checkOut
      ? this.parseIso(pending.checkOut)
      : null;
    return {
      checkIn: parsed.checkIn ?? pendingCheckIn,
      checkOut: parsed.checkOut ?? pendingCheckOut,
      guests: parsed.guests ?? pending?.guests ?? null,
      customerName: parsed.customerName ?? storedName,
    };
  }

  private serializePending(merged: MergedIntent): PendingDates | null {
    if (!merged.checkIn && !merged.checkOut && merged.guests === null) {
      return null;
    }
    return {
      checkIn: merged.checkIn ? this.isoDate(merged.checkIn) : null,
      checkOut: merged.checkOut ? this.isoDate(merged.checkOut) : null,
      guests: merged.guests,
    };
  }

  private parseIso(value: string): Date | null {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private formatDate(d: Date): string {
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  private formatPrice(amount: number): string {
    return `£${Math.round(amount).toLocaleString('en-GB')}`;
  }

  private monthPhraseForDate(d: Date): string {
    return ` for ${this.monthName(d)}`;
  }

  /**
   * Customer came back asking for availability without specifying dates, but
   * we have dates carried over from a previous turn. Don't silently re-run
   * availability — send `date_reconfirmation_check` with the dates spelled
   * out so they can either re-affirm (next turn's "yes please" routes through
   * `awaiting_dates_confirmation` → handleAvailability) or share new dates.
   */
  private async sendDateReconfirmation(
    from: string,
    merged: MergedIntent,
  ): Promise<void> {
    if (!merged.checkIn || !merged.checkOut) return;
    const name = merged.customerName ?? '';
    await this.sendTemplate(from, 'date_reconfirmation_check', {
      name,
      name_comma: name ? `, ${name}` : '',
      check_in: this.formatDate(merged.checkIn),
      check_out: this.formatDate(merged.checkOut),
    });
    await this.parkSuggestedDates(
      from,
      this.isoDate(merged.checkIn),
      this.isoDate(merged.checkOut),
    );
  }

  /**
   * After the bot replies with a Sunday-to-Sunday (or min-stay) suggestion,
   * overwrite the conversation's pendingDates with the SUGGESTED dates and
   * mark lastIntent='awaiting_dates_confirmation'. That way, a short
   * affirmative on the next turn ("yes please", "ok") routes through
   * handleAvailability for the suggested week — not booking_confirmed_handoff
   * and not the same not-Sunday template re-sent on the original off-week dates.
   */
  private async parkSuggestedDates(
    phone: string,
    suggestedCheckInIso: string,
    suggestedCheckOutIso: string,
  ): Promise<void> {
    try {
      await this.conversation.updateContext(phone, {
        lastIntent: 'awaiting_dates_confirmation',
        pendingDates: {
          checkIn: suggestedCheckInIso,
          checkOut: suggestedCheckOutIso,
          guests: null,
        },
      });
    } catch (err) {
      this.logger.warn('conversation', 'parkSuggestedDates failed', {
        phone,
        error: (err as Error).message,
      });
    }
  }

  private monthQueryPhrase(parsed: ParseResult): string {
    if (parsed.monthQuery) {
      const monthName = new Date(
        Date.UTC(parsed.monthQuery.year, parsed.monthQuery.month - 1, 1),
      ).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
      return ` for ${monthName}`;
    }
    if (parsed.monthRangeQuery) {
      const start = new Date(
        Date.UTC(
          parsed.monthRangeQuery.start.year,
          parsed.monthRangeQuery.start.month - 1,
          1,
        ),
      ).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
      return ` for ${start}`;
    }
    return '';
  }

  private monthName(d: Date): string {
    return d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  }

  private scenarioGuidance(scenario: string): string | null {
    switch (scenario) {
      case 'greeting':
        return "The customer has just said hello, with no question yet. Reply warmly: a brief 'Hi, lovely to hear from you' style opener is fine (greetings are allowed on first messages), introduce yourself as Jim from Bonté Maison, then ask what dates they were thinking. Two or three short sentences total. Do NOT mention or link the website here — they haven't asked anything to point them at yet.";
      case 'acknowledgment':
        return "The customer just said something like 'thanks' or 'thank you' to close the loop. Reply warmly with a 'you're welcome' style line — for example 'You're welcome, just shout if anything else comes up.' or 'My pleasure — happy to help any time.' Do NOT open with 'Perfect' / 'Great' / 'Got it'. Do NOT promise future contact like 'You'll hear from me soon' unless a fact says so. One short sentence is enough.";
      case 'polite_close':
        return "The customer is winding down ('I'll think about it', 'cool that sounds nice', 'let me check with my partner'). Reply warmly with no pressure. IMPORTANT: if the recent history shows we've just listed availability or quoted a price, weave in a single short hold offer — e.g. 'happy to hold one of those weeks briefly while you decide'. If there's no recent quote/availability in history, just a warm acknowledgement is enough.";
      case 'month_query':
        return "You're presenting availability (or lack of it) for a month or month range. STYLE RULES (tight, punchy, NOT a sales pitch):\n\n1) Open with one short sentence stating what's available, e.g. 'July 2027 has three weeks available right now.'\n2) Then list each available week ON ITS OWN LINE, with a blank line before and after the list. Format: '11 July to 18 July at £4,995.' One week per line. Do NOT chain weeks together in a single sentence with commas or semicolons. Do NOT use bullets or dashes — just plain lines separated by newlines.\n3) After the list, end with a single short question on its own line, e.g. 'Which of those works best for you?' If the guest has signalled interest, you may add one short hold-offer sentence; otherwise skip it.\n\nExample shape:\n\nJuly 2027 has three weeks available right now.\n\n11 July to 18 July at £4,995.\n18 July to 25 July at £4,995.\n25 July to 1 August at £4,995.\n\nWhich of those works best for you? Happy to hold a week for a few days while you have a think.\n\nDrop filler phrases like 'full school holiday feel', 'real atmosphere', 'often still'. Do NOT list weeks for a period the guest didn't ask about.\n\nIf a week is shown as '(rate to be confirmed)' instead of a price, list it on its own line the same way and say the exact rate will be confirmed, but NEVER make up a number for it.";
      case 'correction':
        return "The customer is correcting or pushing back on YOUR previous reply. Apologise briefly for the misunderstanding and ask what they'd like to know. Don't escalate.";
      case 'unclear':
        return "You couldn't parse what the customer is asking. Apologise briefly and ask them to rephrase or clarify. Don't guess.";
      case 'faq_unknown':
        return "You don't have a fact to answer this question. Acknowledge the question and say you'll come back shortly with the answer. Do not invent details.";
      case 'dates_unclear':
        return "The customer asked about availability (possibly naming only a year, e.g. 'can we book for 2028?') but gave no specific dates, so nothing has been checked. CRITICAL: do NOT comment on whether that year, month or any dates are available, free, booked, 'open', or 'released' — you have not looked. Simply, warmly invite them to share the specific week they have in mind (Sunday-to-Sunday check-in / check-out, or a rough month) so you can check availability and quote for them. One or two short sentences.";
      default:
        return null;
    }
  }

  private monthQueryYears(parsed: ParseResult): number[] {
    if (parsed.monthQuery) return [parsed.monthQuery.year];
    if (parsed.monthRangeQuery) {
      const out = new Set<number>();
      for (
        let y = parsed.monthRangeQuery.start.year;
        y <= parsed.monthRangeQuery.end.year;
        y++
      ) {
        out.add(y);
      }
      return Array.from(out);
    }
    return [];
  }

  private formatMonthYear(m: { year: number; month: number }): string {
    const d = new Date(Date.UTC(m.year, m.month - 1, 1));
    return d.toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  private isInSeptember(d: Date): boolean {
    return d.getUTCMonth() === SEPTEMBER;
  }

  private touchesSeptember(parsed: ParseResult, merged: MergedIntent): boolean {
    if (merged.checkIn && this.isInSeptember(merged.checkIn)) return true;
    if (merged.checkOut && this.isInSeptember(merged.checkOut)) return true;
    if (
      merged.checkIn &&
      merged.checkOut &&
      this.rangeCoversMonth(merged.checkIn, merged.checkOut, SEPTEMBER + 1)
    ) {
      return true;
    }
    if (parsed.monthQuery && parsed.monthQuery.month === SEPTEMBER + 1) {
      return true;
    }
    if (parsed.monthRangeQuery) {
      const { start, end } = parsed.monthRangeQuery;
      const startKey = start.year * 12 + (start.month - 1);
      const endKey = end.year * 12 + (end.month - 1);
      for (let k = startKey; k <= endKey; k++) {
        if (k % 12 === SEPTEMBER) return true;
      }
    }
    return false;
  }

  private rangeCoversMonth(
    start: Date,
    end: Date,
    month1Indexed: number,
  ): boolean {
    for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
      if (new Date(t).getUTCMonth() === month1Indexed - 1) return true;
    }
    return false;
  }

  /**
   * Adds the website URL on its own line before the sign-off if not already
   * present anywhere in the body. Used as a safety net so every customer-facing
   * reply ends up with a link, even on paths where the composer didn't weave
   * one in or a fixed template forgot.
   */
  private ensureWebsiteLink(body: string): string {
    if (/bontemaison\.com/i.test(body)) return body;
    return this.insertBeforeSignOff(body, WEBSITE_URL);
  }

  /**
   * Inserts `note` immediately before the trailing "Many thanks" sign-off in
   * `body`. If no sign-off is found, falls back to appending at the end.
   */
  private insertBeforeSignOff(body: string, note: string): string {
    const match = body.match(/\n+Many thanks\.?\s*$/i);
    if (!match) return `${body}\n\n${note}`;
    const head = body.slice(0, match.index ?? body.length).replace(/\s+$/, '');
    return `${head}\n\n${note}\n\nMany thanks`;
  }

  private shouldAppendHarvest(checkIn: Date, checkOut: Date): boolean {
    for (let t = checkIn.getTime(); t < checkOut.getTime(); t += DAY_MS) {
      if (new Date(t).getUTCMonth() === SEPTEMBER) return true;
    }
    return false;
  }
}
