import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LoggerService } from '../logger/logger.service';

export type Intent =
  | 'greeting'
  | 'availability_inquiry'
  | 'pricing_inquiry'
  | 'general_info'
  | 'booking_confirmation'
  | 'hold_request'
  | 'human_request'
  | 'complaint_or_frustration'
  | 'correction'
  | 'polite_close'
  | 'acknowledgment'
  | 'off_topic_or_unclear';

export type HistoryMessage = {
  role: 'customer' | 'assistant';
  text: string;
};

export type MonthRange = {
  start: { year: number; month: number };
  end: { year: number; month: number };
};

export type ParseResult = {
  intent: Intent;
  confidence: number;
  customerName: string | null;
  guestEmail: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  guests: number | null;
  mentionsDiscount: boolean;
  highIntentSignal: boolean;
  topicKeys: string[];
  monthQuery: { year: number; month: number } | null;
  monthRangeQuery: MonthRange | null;
  needsGreeting: boolean;
  needsAcknowledgment: boolean;
  isCorrection: boolean;
  isClarificationOfPrevious: boolean;
};

export type KbTopicHint = {
  topicKey: string;
  questionExamples: string;
};

const SYSTEM_PROMPT = `You parse short WhatsApp messages from prospective guests of a rental property into structured data.

Return ONLY a JSON object with these keys (no prose, no code fences):
- intent: one of
  - "greeting" — the guest just said hi / introduced themselves / opened the conversation without a question
  - "availability_inquiry" — asks whether specific dates are free, or asks about availability in general (including vague month-level asks like "anything in September?")
  - "pricing_inquiry" — asks about prices, rates, cost, or a quote
  - "general_info" — asks a factual question about the property, location, amenities, check-in time, etc.
  - "booking_confirmation" — explicitly confirms they want to proceed with a booking they've already discussed (e.g. "yes let's book those dates", "confirmed", "I'll pay now"). ALSO use this intent when the customer is providing an email address in response to a previous ask for one ("here's my email …", "you can reach me at …@…"). NOT a first-contact "I'd like to book the villa" — that's a greeting or availability_inquiry depending on whether they gave dates. NOT questions about HOW to book, the deposit amount, or the payment process ("how do I book?", "what's the deposit?", "how do I pay?", "tell me the deposit needed", "what are the booking terms?") — those are "general_info".
  - "hold_request" — explicitly asks to hold or reserve dates without committing to a full booking
  - "human_request" — explicitly asks to talk to a person, the owner, or a human
  - "complaint_or_frustration" — genuine dissatisfaction with the property or stay (e.g. "the wifi doesn't work", "this has been a terrible experience"). Do NOT use this for the guest pushing back on YOUR previous reply or saying "that's not what I meant" — that's "correction".
  - "correction" — guest is pushing back on, correcting, or clarifying YOUR previous reply ("I didn't ask about that", "you misunderstood", "that's not what I meant"). Always set is_correction=true alongside this intent.
  - "polite_close" — guest is winding down conversationally without a question or commitment ("I'll think about it", "let me discuss with my partner", "leave it with me"). Distinct from acknowledgment because it explicitly says "I'm pausing/leaving" rather than just acknowledging.
  - "acknowledgment" — short closer, farewell, or filler signalling the current exchange is done ("thanks", "ok thanks", "noted", "great", "perfect", "bye", "goodbye", "thanks, bye", "that's it, thanks"). No fresh question, no commitment.
  - "off_topic_or_unclear" — anything else you cannot classify confidently (and is not a correction or polite_close).
- confidence: number from 0 to 1
- customerName: guest's name if introduced, otherwise null
- guestEmail: a single email address from the current message if present (e.g. "name@example.com"), otherwise null. Lower-case the address. Do NOT carry over from history.
- checkIn: ISO date "YYYY-MM-DD" or null — extract ONLY from the CURRENT message. If the current message has no concrete date, return null. NEVER carry over dates from earlier turns.
- checkOut: ISO date "YYYY-MM-DD" or null — exclusive (departure date). Same rule as checkIn.
- guests: integer or null
- mentionsDiscount: true if the guest asks for a discount or special rate
- highIntentSignal: true if the message suggests booking readiness ("we'd like to come", multiple questions, asking about payment)
- topicKeys: array of zero or more topic keys from the knowledge base list below that this message is asking about. ARRAY — multi-intent messages get multiple topics. Empty array if none apply.
- monthQuery: { "year": number, "month": number } if the guest asks about a single month without specific dates. Covers BOTH availability checks ("any availability in September 2027?") AND consultative/recommendation phrasing ("what week would you recommend in June 2027?", "which week is best in August?", "thinking of August"). Else null. Year must be explicit or unambiguous from context — if uncertain, use the next future occurrence.
- monthRangeQuery: { "start": { "year": ..., "month": ... }, "end": {...} } if the guest asks about a range of months ("anything in autumn?", "summer 2027"), else null.
- needsGreeting: true ONLY when this is the very first customer message in the conversation (no prior assistant turns). For repeat hellos mid-conversation, set false.
- needsAcknowledgment: true ONLY when the guest is making a polite request of you or apologetically asking for help ("could you...", "would you mind...", "sorry to bother..."), or asking permission ("is it ok if..."). FALSE for direct factual questions about the property or area ("what are the events", "is the pool heated", "how many bedrooms", "where is it"). Default to false unless the polite-ask framing is clearly present.
- isCorrection: true when the guest is pushing back on or correcting YOUR previous reply. Mirror the "correction" intent.
- isClarificationOfPrevious: true when the message is a short answer or addendum to a question YOU asked in the previous turn (e.g. assistant asked "where are you travelling from?" → guest replies "Italy").

Rules:
- Use the recent conversation history to disambiguate references like "those dates" or "yes", but DO NOT carry forward dates into checkIn/checkOut. Those fields reflect only what is in the current message.
- Never invent dates or guest counts.
- When the guest gives a day + month without a year, resolve to the nearest FUTURE occurrence relative to today's date (provided below). Never return a date in the past.
- If you cannot confidently classify, use "off_topic_or_unclear" with confidence <= 0.5.`;

const UNKNOWN: ParseResult = {
  intent: 'off_topic_or_unclear',
  confidence: 0,
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
};

const VALID_INTENTS: readonly Intent[] = [
  'greeting',
  'availability_inquiry',
  'pricing_inquiry',
  'general_info',
  'booking_confirmation',
  'hold_request',
  'human_request',
  'complaint_or_frustration',
  'correction',
  'polite_close',
  'acknowledgment',
  'off_topic_or_unclear',
];

@Injectable()
export class ParserService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set');
    this.client = new Anthropic({ apiKey });
    this.model =
      config.get<string>('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
  }

  async parse(
    message: string,
    history: HistoryMessage[] = [],
    kbTopics: KbTopicHint[] = [],
  ): Promise<ParseResult> {
    const userContent = this.buildUserContent(message, history);
    const system = this.buildSystemPrompt(kbTopics);

    let raw: string;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 768,
        system,
        messages: [{ role: 'user', content: userContent }],
      });
      const block = response.content[0];
      raw = block && block.type === 'text' ? block.text : '';
    } catch (err) {
      this.logger.error('parser', 'Claude API call failed', {
        error: (err as Error).message,
      });
      throw err;
    }

    return this.coerce(raw, message);
  }

  private buildSystemPrompt(kbTopics: KbTopicHint[]): string {
    if (kbTopics.length === 0) return SYSTEM_PROMPT;
    const lines = kbTopics.map(
      (t) =>
        `- ${t.topicKey}${t.questionExamples ? ` — ${t.questionExamples}` : ''}`,
    );
    return `${SYSTEM_PROMPT}\n\nKnowledge base topics (use exact keys for topicKeys):\n${lines.join('\n')}`;
  }

  private buildUserContent(
    message: string,
    history: HistoryMessage[],
  ): string {
    const today = new Date().toISOString().slice(0, 10);
    const header = `Today's date: ${today}`;
    if (history.length === 0) return `${header}\n\nNew message: ${message}`;
    const lines = history.map(
      (h) => `${h.role === 'customer' ? 'Customer' : 'Assistant'}: ${h.text}`,
    );
    return `${header}\n\nRecent conversation:\n${lines.join('\n')}\n\nNew message: ${message}`;
  }

  private coerce(raw: string, originalMessage: string): ParseResult {
    const candidate = this.extractJson(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      this.logger.warn('parser', 'Claude returned non-JSON output', {
        raw,
        message: originalMessage,
      });
      return UNKNOWN;
    }

    if (!parsed || typeof parsed !== 'object') return UNKNOWN;
    const p = parsed as Record<string, unknown>;

    const intent = VALID_INTENTS.includes(p.intent as Intent)
      ? (p.intent as Intent)
      : 'off_topic_or_unclear';

    const confidence =
      typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1
        ? p.confidence
        : 0;

    const customerName =
      typeof p.customerName === 'string' && p.customerName.trim().length > 0
        ? p.customerName.trim()
        : null;

    const guestEmail =
      typeof p.guestEmail === 'string' && /\S+@\S+\.\S+/.test(p.guestEmail.trim())
        ? p.guestEmail.trim().toLowerCase()
        : null;

    const checkIn = this.toDate(p.checkIn);
    const checkOut = this.toDate(p.checkOut);
    const guests = typeof p.guests === 'number' ? p.guests : null;
    const mentionsDiscount = p.mentionsDiscount === true;
    const highIntentSignal = p.highIntentSignal === true;

    const topicKeys = this.toStringArray(p.topicKeys);
    const monthQuery = this.toMonth(p.monthQuery);
    const monthRangeQuery = this.toMonthRange(p.monthRangeQuery);
    const needsGreeting = p.needsGreeting === true;
    const needsAcknowledgment = p.needsAcknowledgment === true;
    const isCorrection =
      p.isCorrection === true || intent === 'correction';
    const isClarificationOfPrevious = p.isClarificationOfPrevious === true;

    return {
      intent,
      confidence,
      customerName,
      guestEmail,
      checkIn,
      checkOut,
      guests,
      mentionsDiscount,
      highIntentSignal,
      topicKeys,
      monthQuery,
      monthRangeQuery,
      needsGreeting,
      needsAcknowledgment,
      isCorrection,
      isClarificationOfPrevious,
    };
  }

  private toDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
  }

  private toMonth(value: unknown): { year: number; month: number } | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.year !== 'number' || typeof v.month !== 'number') return null;
    if (v.month < 1 || v.month > 12) return null;
    return { year: v.year, month: v.month };
  }

  private toMonthRange(value: unknown): MonthRange | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const start = this.toMonth(v.start);
    const end = this.toMonth(v.end);
    if (!start || !end) return null;
    return { start, end };
  }

  private extractJson(raw: string): string {
    const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenced) return fenced[1].trim();
    const braced = raw.match(/\{[\s\S]*\}/);
    return braced ? braced[0] : raw;
  }
}
