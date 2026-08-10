import { Injectable } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service';
import type { GuestMode } from '../guests/guests.service';
import { LoggerService } from '../logger/logger.service';

/**
 * Who a knowledge-base row may be shown to.
 *
 * - `all` — safe for anyone, including a cold prospect. The default when the
 *   Airtable column is blank, so existing rows keep working untouched.
 * - `pre_stay` — only useful once a booking exists (arrival process, what to
 *   bring, pre-arrival shopping).
 * - `in_stay` — operational detail for a guest who is at the house (BBQ, hot
 *   tub, bin day, nearest pharmacy).
 * - `sensitive` — must never reach anyone but a guest currently in residence.
 *   The WiFi password lives here.
 */
export type KbAudience = 'all' | 'pre_stay' | 'in_stay' | 'sensitive';

type KbFields = {
  topic_key?: string;
  question_examples?: string;
  answer?: string;
  audience?: KbAudience;
  active?: boolean;
};

export type KbTopic = {
  topicKey: string;
  questionExamples: string;
};

export type KbVars = Record<string, string | number | boolean>;

const PLACEHOLDER = /\{(\w+)\}/g;

const DEFAULT_AUDIENCES: KbAudience[] = ['all'];

const AUDIENCES_BY_MODE: Record<GuestMode, KbAudience[]> = {
  prospect: ['all'],
  hold: ['all'],
  future_guest: ['all', 'pre_stay'],
  current_guest: ['all', 'pre_stay', 'in_stay', 'sensitive'],
  // A past guest is a prospect again as far as house secrets go — they no
  // longer need the door code or the WiFi password.
  past_guest: ['all'],
};

export function audiencesForMode(mode: GuestMode): KbAudience[] {
  return AUDIENCES_BY_MODE[mode] ?? DEFAULT_AUDIENCES;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Topics the parser is allowed to name for this audience.
   *
   * The gate has to apply here as well as in `render`: if a prospect's parser
   * never learns that `wifi_password` exists, it can never ask for it, so the
   * answer can never be fetched by mistake.
   */
  async listTopics(
    audiences: KbAudience[] = DEFAULT_AUDIENCES,
  ): Promise<KbTopic[]> {
    const rows = await this.airtable.list<KbFields>('KnowledgeBase');
    return rows
      .filter(
        (r) =>
          typeof r.fields.topic_key === 'string' &&
          r.fields.active !== false &&
          this.isVisible(r.fields.audience, audiences),
      )
      .map((r) => ({
        topicKey: r.fields.topic_key as string,
        questionExamples: r.fields.question_examples ?? '',
      }));
  }

  async render(
    topicKey: string,
    vars: KbVars,
    audiences: KbAudience[] = DEFAULT_AUDIENCES,
  ): Promise<string | null> {
    const rows = await this.airtable.list<KbFields>('KnowledgeBase', {
      filterByFormula: `{topic_key}='${topicKey}'`,
      maxRecords: 1,
    });
    const entry = rows.find(
      (r) =>
        typeof r.fields.answer === 'string' && r.fields.active !== false,
    );
    if (!entry) return null;

    if (!this.isVisible(entry.fields.audience, audiences)) {
      this.logger.info('knowledge-base', 'topic withheld from this audience', {
        topicKey,
        rowAudience: entry.fields.audience ?? 'all',
        allowed: audiences,
      });
      return null;
    }

    return this.substitute(entry.fields.answer as string, vars, topicKey);
  }

  /** A blank column means `all`, so rows written before this existed still show. */
  private isVisible(
    rowAudience: KbAudience | undefined,
    allowed: KbAudience[],
  ): boolean {
    return allowed.includes(rowAudience ?? 'all');
  }

  private substitute(text: string, vars: KbVars, topicKey: string): string {
    return text.replace(PLACEHOLDER, (_m, name: string) => {
      if (!(name in vars)) {
        this.logger.error('knowledge-base', 'missing placeholder value', {
          topicKey,
          placeholder: name,
        });
        throw new Error(
          `missing placeholder "${name}" for KB topic "${topicKey}"`,
        );
      }
      return String(vars[name]);
    });
  }
}
