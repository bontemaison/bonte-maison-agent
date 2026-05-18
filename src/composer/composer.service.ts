import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LoggerService } from '../logger/logger.service';
import { HistoryMessage } from '../parser/parser.service';

export type CompositionFact = {
  key: string;
  text: string;
};

export type CompositionPackage = {
  scenarioHint?: string;
  guestName: string | null;
  isFirstMessage: boolean;
  toneFlags: {
    needsGreeting: boolean;
    needsAcknowledgment: boolean;
    needsNudgeToBook: boolean;
    needsSignOff: boolean;
  };
  facts: CompositionFact[];
  openers: string[];
  closers: string[];
  nudges: string[];
  availability?: {
    requestedDatesAvailable?: boolean;
    closestAlternative?: {
      checkIn: string;
      checkOut: string;
      price?: string;
    } | null;
  };
  history: HistoryMessage[];
  styleExamples?: string[];
};

export type ComposeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; raw: string };

const SYSTEM_PROMPT = `You are responding as Jim, the owner of Bonté Maison, a premium holiday house in the Dordogne.
Your tone is calm, natural and quietly confident. You are not a salesperson or a customer service agent. You are an experienced host who knows the area well and is helping guests shape a relaxed, high-quality stay.

Tone rules (CRITICAL)
- Write like a person, not a system. Plain text only.
- Concise, natural, never enthusiastic or scripted.
- No "I'd be happy to assist" / "Thank you for your enquiry" / corporate phrasing.
- No long lists or bullet points.
- Confident without being pushy.
- NEVER use em dashes (—) or en dashes (–). They feel formal and unnatural in chat. Use commas, full stops, or split into separate sentences instead.

WhatsApp format
- This is a live chat, mid-conversation. Do NOT open with "Hi"/"Hello"/"Hi there" unless this is the very first message of the conversation.
- Do NOT open with "Thanks for getting in touch" or any formal preamble.
- Do NOT sign off with "Jim" or "Kind regards".
- ALWAYS end the reply with "Many thanks" on its own line as the sign-off.
- NEVER comment on the customer's behaviour or your own previous replies. No "as mentioned", "as I said", "looks like your message came through twice", "again", "to repeat", or similar meta-remarks. If the customer repeats themselves or asks the same thing twice, just answer freshly and naturally as if it were the first time.
- Use "reserved" rather than "sold" or "taken".
- Plain text only — no markdown, no asterisks, no bullets.

Hard constraints (NEVER violate)
- Use ONLY the facts provided in the composition package. Never invent details, prices, dates, or specifics.
- When facts contain specific numbers (percentages like "25%", durations like "8 weeks before arrival", prices like "£4,995", counts like "two hot tubs", "10 across five bedrooms"), include those numbers in your reply verbatim. Don't replace them with vague phrasing like "a deposit" or "available on the website" — the customer asked for them.
- Never offer or agree to discounts.
- Never suggest specific alternative dates yourself unless they appear in the package as availability.closestAlternative.
- Never quote a price not explicitly given in the package.
- All prices are in pounds sterling. Use the £ symbol. NEVER use € or the word "euro". The villa is in France but the rate is set in GBP.
- The villa runs on a Sunday-to-Sunday changeover (check-in Sunday, check-out the following Sunday). NEVER say "Saturday to Saturday" or any other day.
- NEVER include URLs other than www.bontemaison.com (and its sub-paths like /holiday-ideas, /eating-out, /arrival-details, /priority). No facebook.com, no third-party links.
- If the package marks a topic that is not present in facts, do not answer it — skip it.
- PAYMENT: NEVER ask the guest for credit/debit card details, card numbers, CVV, expiry dates, or any payment information. Cards are NEVER taken over WhatsApp. All payment is handled securely on www.bontemaison.com via 3D-secure card payment. If the guest wants to book, the only things you may ask for are their email address and phone number (so we can send confirmation), then direct them to www.bontemaison.com to complete payment. Do NOT say "share your preferred card", "card details", "card number", or anything similar.

Composition behaviour
- If toneFlags.needsAcknowledgment is true, open with a brief warm acknowledgment drawn from the openers list, matched to the situation:
  - "Yes of course," / "Happy to help," — guest is making a polite request of you.
  - "No problem at all," — ONLY when the guest expressed imposition, apology, or hesitation ("sorry to bother", "if it's not too much trouble", "hope you don't mind"). Never use it as a generic opener for a factual question.
  - "Good news," — only when the answer itself is good news (dates available, yes to a hopeful ask).
  If toneFlags.needsAcknowledgment is false, do NOT use any of these openers — go straight into the answer.
- Cover EVERY fact provided. Multi-topic messages need every topic addressed.
- If toneFlags.needsNudgeToBook is true and a nudge fits, weave one in naturally toward the end. Don't tack it on.
- Do NOT add a separate closer line like "Just shout if anything comes up." or "Let me know if you'd like to look further." The "Many thanks" sign-off is the closer.
- Keep replies under ~120 words unless the package facts genuinely need more.`;

const FORBIDDEN_TERMS = [
  /\bsold\b/i,
  /\btaken\b/i,
  /\bas (i|already) (mentioned|said|wrote)\b/i,
  /\bas mentioned\b/i,
  /\bas previously mentioned\b/i,
  /\bcame through twice\b/i,
  /\bsent (this|that|the same) (message )?(twice|again)\b/i,
  /\b(to|let me) repeat\b/i,
  /\byou (already|previously) asked\b/i,
  /€/,
  /\beuros?\b/i,
  /saturday to saturday/i,
  /saturday changeover/i,
  /facebook\.com/i,
  /\b(preferred|your) card\b/i,
  /\bcard (details|number|info|information)\b/i,
  /\bcvv\b/i,
  /\bcard expiry\b/i,
];
const BANNED_OPENERS = [
  /^hi[,!.\s]/i,
  /^hello[,!.\s]/i,
  /^hi there/i,
  /^thanks for getting in touch/i,
  /^thank you for your enquiry/i,
  /^thank you for getting in touch/i,
];
const BANNED_SIGNOFFS = [/\bjim\.?\s*$/i, /kind regards\.?\s*$/i];

@Injectable()
export class ComposerService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly logger: LoggerService,
    config: ConfigService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set');
    this.client = new Anthropic({ apiKey });
    this.model =
      config.get<string>('CLAUDE_RESPONSE_MODEL') ?? 'claude-sonnet-4-6';
  }

  async compose(pkg: CompositionPackage): Promise<ComposeResult> {
    const userContent = this.buildUserContent(pkg);

    let raw: string;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 768,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      });
      const block = response.content[0];
      raw = block && block.type === 'text' ? block.text.trim() : '';
    } catch (err) {
      this.logger.error('templates', 'composer call failed', {
        error: (err as Error).message,
      });
      return { ok: false, reason: 'api_error', raw: '' };
    }

    const cleaned = this.stripEmDashes(raw);

    const validation = this.validate(cleaned, pkg);
    if (!validation.ok) {
      this.logger.warn('templates', 'composer output rejected', {
        reason: validation.reason,
        raw,
      });
      return { ok: false, reason: validation.reason, raw };
    }
    return { ok: true, text: this.ensureSignOff(cleaned) };
  }

  private ensureSignOff(text: string): string {
    if (/many thanks\.?\s*$/i.test(text)) return text;
    return `${text.replace(/\s+$/, '')}\n\nMany thanks`;
  }

  private stripEmDashes(text: string): string {
    return text
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/^\s*,\s*/, '');
  }

  private buildUserContent(pkg: CompositionPackage): string {
    const parts: string[] = [];

    if (pkg.scenarioHint) {
      parts.push(`Scenario: ${pkg.scenarioHint}`);
    }

    parts.push(
      `Context:\n- Guest name: ${pkg.guestName ?? '(unknown)'}\n- First message in conversation: ${pkg.isFirstMessage}`,
    );

    parts.push(
      `Tone flags:\n- needsGreeting: ${pkg.toneFlags.needsGreeting}\n- needsAcknowledgment: ${pkg.toneFlags.needsAcknowledgment}\n- needsNudgeToBook: ${pkg.toneFlags.needsNudgeToBook}\n- needsSignOff: ${pkg.toneFlags.needsSignOff}`,
    );

    if (pkg.facts.length > 0) {
      const factLines = pkg.facts
        .map((f) => `- ${f.key}: ${f.text}`)
        .join('\n');
      parts.push(`Facts (use these verbatim or paraphrased; do NOT invent):\n${factLines}`);
    } else {
      parts.push(
        'Facts: none. If the message asks a factual question, do not invent — keep the reply short and offer to come back with the answer.',
      );
    }

    if (pkg.openers.length > 0) {
      parts.push(
        `Opener phrases (pick one if needed; rotate, never copy verbatim):\n${pkg.openers.map((o) => `- ${o}`).join('\n')}`,
      );
    }

    if (pkg.nudges.length > 0) {
      parts.push(
        `Nudge phrases (use only if needsNudgeToBook):\n${pkg.nudges.map((n) => `- ${n}`).join('\n')}`,
      );
    }

    if (pkg.closers.length > 0) {
      parts.push(
        `Closer phrases:\n${pkg.closers.map((c) => `- ${c}`).join('\n')}`,
      );
    }

    if (pkg.availability) {
      const a = pkg.availability;
      const lines: string[] = [];
      if (a.requestedDatesAvailable !== undefined) {
        lines.push(`- requestedDatesAvailable: ${a.requestedDatesAvailable}`);
      }
      if (a.closestAlternative) {
        lines.push(
          `- closestAlternative: ${a.closestAlternative.checkIn} to ${a.closestAlternative.checkOut}${a.closestAlternative.price ? ` (${a.closestAlternative.price})` : ''}`,
        );
      }
      if (lines.length > 0) {
        parts.push(`Availability:\n${lines.join('\n')}`);
      }
    }

    if (pkg.styleExamples && pkg.styleExamples.length > 0) {
      const capped = pkg.styleExamples.slice(0, 3);
      parts.push(
        `Style examples from Jim (use only to calibrate warmth/vocabulary — do NOT copy structure or sign-offs):\n\n${capped.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n')}`,
      );
    }

    if (pkg.history.length > 0) {
      const recent = pkg.history.slice(-10);
      const transcript = recent
        .map(
          (h) => `${h.role === 'customer' ? 'Customer' : 'Jim'}: ${h.text}`,
        )
        .join('\n');
      parts.push(`Recent conversation:\n${transcript}`);
    }

    parts.push("Write Jim's WhatsApp reply now. Plain text only.");

    return parts.join('\n\n');
  }

  private validate(
    text: string,
    pkg: CompositionPackage,
  ): { ok: true } | { ok: false; reason: string } {
    if (text.length < 5) return { ok: false, reason: 'empty_output' };
    if (text.length > 1500) return { ok: false, reason: 'too_long' };

    for (const re of FORBIDDEN_TERMS) {
      if (re.test(text)) {
        return { ok: false, reason: `forbidden_term:${re.source}` };
      }
    }

    if (!pkg.toneFlags.needsGreeting) {
      for (const re of BANNED_OPENERS) {
        if (re.test(text)) {
          return { ok: false, reason: `banned_opener:${re.source}` };
        }
      }
    }

    for (const re of BANNED_SIGNOFFS) {
      if (re.test(text)) {
        return { ok: false, reason: `banned_signoff:${re.source}` };
      }
    }

    return { ok: true };
  }
}
