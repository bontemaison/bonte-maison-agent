import { Injectable } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';

export type ConversationStatus = 'bot' | 'human' | 'paused';

export type LifecycleStatus =
  | 'New'
  | 'Responded'
  | 'Follow-up'
  | 'Booked'
  | 'Lost';

export type AvailabilityResult = 'available' | 'unavailable' | 'pending';

export type PendingDates = {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
};

export type ConversationState = {
  status: ConversationStatus;
  lifecycleStatus: LifecycleStatus;
  lastIntent: string | null;
  pendingDates: PendingDates | null;
  customerName: string | null;
};

export type CrmSnapshot = {
  customerName: string | null;
  email: string | null;
  status: ConversationStatus;
  lifecycleStatus: LifecycleStatus;
  lastIntent: string | null;
  datesRequested: string | null;
  priceQuoted: number | null;
  availabilityResult: AvailabilityResult | null;
  followUpCount: number | null;
};

export type ParsedCommand =
  | { command: 'release'; phone?: string }
  | { command: 'pause'; phone?: string; minutes?: number }
  | { command: 'resume'; phone?: string }
  | { command: 'status'; phone?: string };

type ConversationFields = {
  phone?: string;
  pause_status?: ConversationStatus;
  pause_until?: string;
  status?: LifecycleStatus;
  last_activity?: string;
  last_intent?: string;
  pending_dates?: string;
  customer_name?: string;
  email?: string;
  dates_requested?: string;
  price_quoted?: number;
  availability_result?: AvailabilityResult;
  follow_up_count?: number;
  follow_up_24h_sent?: boolean;
  follow_up_7d_sent?: boolean;
  enquiry_source?: string;
  notes?: string;
};

type BookingRulesFields = {
  key?: string;
  value?: string;
  active?: boolean;
};

const GLOBAL_PAUSE_KEY = 'bot_paused_global';

const COMMAND_NAMES = ['release', 'pause', 'resume', 'status'] as const;
type CommandName = (typeof COMMAND_NAMES)[number];

const DEFAULT_STATE: ConversationState = {
  status: 'bot',
  lifecycleStatus: 'New',
  lastIntent: null,
  pendingDates: null,
  customerName: null,
};

@Injectable()
export class ConversationService {
  constructor(
    private readonly airtable: AirtableService,
    private readonly logger: LoggerService,
  ) {}

  async getStatus(phone: string): Promise<ConversationStatus> {
    const row = await this.findRow(phone);
    if (!row) return 'bot';
    return this.resolveStatus(row.fields);
  }

  async getState(phone: string): Promise<ConversationState> {
    const row = await this.findRow(phone);
    if (!row) return DEFAULT_STATE;

    const f = row.fields;
    const effectiveStatus = this.resolveStatus(f);

    return {
      status: effectiveStatus,
      lifecycleStatus: f.status ?? 'New',
      lastIntent: f.last_intent ?? null,
      pendingDates: this.parsePending(f.pending_dates),
      customerName: f.customer_name ?? null,
    };
  }

  async getCrmSnapshot(phone: string): Promise<CrmSnapshot | null> {
    const row = await this.findRow(phone);
    if (!row) return null;
    const f = row.fields;
    const effectiveStatus = this.resolveStatus(f);
    return {
      customerName: f.customer_name?.trim() ? f.customer_name.trim() : null,
      email: f.email?.trim() ? f.email.trim() : null,
      status: effectiveStatus,
      lifecycleStatus: f.status ?? 'New',
      lastIntent: f.last_intent ?? null,
      datesRequested: f.dates_requested?.trim()
        ? f.dates_requested.trim()
        : null,
      priceQuoted:
        typeof f.price_quoted === 'number' && f.price_quoted > 0
          ? f.price_quoted
          : null,
      availabilityResult: f.availability_result ?? null,
      followUpCount:
        typeof f.follow_up_count === 'number' ? f.follow_up_count : null,
    };
  }

  async canSendBot(phone: string): Promise<boolean> {
    if (await this.getGlobalPaused()) return false;
    return (await this.getStatus(phone)) === 'bot';
  }

  async getGlobalPaused(): Promise<boolean> {
    try {
      const row = await this.findGlobalPauseRow();
      return this.parseGlobalPauseValue(row?.fields.value);
    } catch (err) {
      this.logger.warn('conversation', 'global pause read failed; assuming OFF', {
        error: (err as Error).message,
      });
      return false;
    }
  }

  async setGlobalPaused(paused: boolean): Promise<void> {
    const row = await this.findGlobalPauseRow();
    const fields: BookingRulesFields = {
      key: GLOBAL_PAUSE_KEY,
      value: paused ? 'true' : 'false',
      active: true,
    };
    if (row) {
      await this.airtable.update<BookingRulesFields>(
        'BookingRules',
        row.id,
        fields,
      );
    } else {
      await this.airtable.create<BookingRulesFields>('BookingRules', fields);
    }
    this.logger.info('conversation', 'global pause updated', { paused });
  }

  async statusCounts(): Promise<{ bot: number; human: number; paused: number }> {
    const rows = await this.airtable.list<ConversationFields>('Conversations', {});
    const counts = { bot: 0, human: 0, paused: 0 };
    for (const row of rows) {
      counts[this.resolveStatus(row.fields)]++;
    }
    return counts;
  }

  /**
   * Sweep conversations whose pause window (`pause_until`) has lapsed and write
   * them back to `bot` in Airtable so the CRM view reflects the resume. Covers
   * both automatic human takeovers and timed `/pause <phone> <minutes>`. A
   * `/release` sets `human` with no `pause_until`, so it is never swept —
   * deliberate handovers stay with Jim until he `/resume`s. Returns the count
   * flipped. Best-effort per row: one failure never aborts the sweep.
   */
  async resumeExpired(): Promise<number> {
    const rows = await this.airtable.list<ConversationFields>('Conversations', {
      filterByFormula: "OR({pause_status}='human',{pause_status}='paused')",
    });
    const now = Date.now();
    this.logger.debug('conversation', 'resume sweep: candidates', {
      count: rows.length,
      rows: rows.map((r) => ({
        phone: r.fields.phone,
        pause_status: r.fields.pause_status,
        pause_until: r.fields.pause_until ?? null,
        expired: r.fields.pause_until
          ? new Date(r.fields.pause_until).getTime() < now
          : false,
      })),
    });
    let resumed = 0;
    for (const row of rows) {
      const { pause_until, phone } = row.fields;
      if (!pause_until || new Date(pause_until).getTime() >= now) continue;
      try {
        await this.airtable.update<ConversationFields>(
          'Conversations',
          row.id,
          {
            pause_status: 'bot',
            // null (not '') clears an Airtable Date field — '' errors on it.
            // Airtable's FieldSet types omit null, so cast locally.
            pause_until: null as unknown as string,
          },
        );
        resumed++;
        this.logger.info(
          'conversation',
          'auto-resumed to bot after pause window',
          { phone },
        );
      } catch (err) {
        this.logger.warn('conversation', 'auto-resume write failed', {
          phone,
          error: (err as Error).message,
        });
      }
    }
    return resumed;
  }

  async setStatus(
    phone: string,
    status: ConversationStatus,
    options: { pauseForMinutes?: number } = {},
  ): Promise<void> {
    const fields: ConversationFields = {
      phone,
      pause_status: status,
      last_activity: new Date().toISOString(),
    };
    if (options.pauseForMinutes !== undefined) {
      fields.pause_until = new Date(
        Date.now() + options.pauseForMinutes * 60_000,
      ).toISOString();
    }
    await this.upsert(phone, fields);
    this.logger.info('conversation', 'pause status updated', { phone, status });
  }

  async setLifecycleStatus(
    phone: string,
    status: LifecycleStatus,
  ): Promise<void> {
    await this.upsert(phone, {
      phone,
      status,
      last_activity: new Date().toISOString(),
    });
    this.logger.info('conversation', 'lifecycle status updated', {
      phone,
      status,
    });
  }

  async recordQuote(
    phone: string,
    datesRequested: string,
    priceQuoted: number,
    availabilityResult: AvailabilityResult,
  ): Promise<void> {
    await this.upsert(phone, {
      phone,
      dates_requested: datesRequested,
      price_quoted: priceQuoted,
      availability_result: availabilityResult,
      last_activity: new Date().toISOString(),
    });
  }

  async recordEmail(phone: string, email: string): Promise<void> {
    await this.upsert(phone, {
      phone,
      email,
      last_activity: new Date().toISOString(),
    });
  }

  async markFollowUpSent(phone: string, stage: '24h' | '7d'): Promise<void> {
    const row = await this.findRow(phone);
    const current =
      (row?.fields.follow_up_count as number | undefined) ?? 0;
    const patch: ConversationFields = {
      phone,
      follow_up_count: current + 1,
      last_activity: new Date().toISOString(),
    };
    if (stage === '24h') patch.follow_up_24h_sent = true;
    else patch.follow_up_7d_sent = true;
    await this.upsert(phone, patch);
  }

  async updateContext(
    phone: string,
    patch: {
      lastIntent?: string;
      pendingDates?: PendingDates | null;
      customerName?: string | null;
    },
  ): Promise<void> {
    const fields: ConversationFields = {
      phone,
      last_activity: new Date().toISOString(),
    };
    if (patch.lastIntent !== undefined) fields.last_intent = patch.lastIntent;
    if (patch.pendingDates !== undefined) {
      fields.pending_dates = patch.pendingDates
        ? JSON.stringify(patch.pendingDates)
        : '';
    }
    if (patch.customerName !== undefined) {
      fields.customer_name = patch.customerName ?? '';
    }
    await this.upsert(phone, fields);
  }

  parseCommand(text: string): ParsedCommand | null {
    const tokens = text.trim().toLowerCase().split(/\s+/);
    const head = tokens[0];
    if (!head?.startsWith('/')) return null;
    const cmd = head.slice(1) as CommandName;
    if (!COMMAND_NAMES.includes(cmd)) return null;

    const args = tokens.slice(1);
    let phone: string | undefined;
    let minutes: number | undefined;

    for (const arg of args) {
      if (/^\+?\d{4,}$/.test(arg) && phone === undefined) {
        phone = arg.replace(/^\+/, '');
      } else if (/^\d{1,3}$/.test(arg) && minutes === undefined) {
        minutes = Number(arg);
      } else {
        return null;
      }
    }

    if (cmd === 'pause') return { command: 'pause', phone, minutes };
    if (cmd === 'release') return { command: 'release', phone };
    if (cmd === 'status') return { command: 'status', phone };
    return { command: 'resume', phone };
  }

  /**
   * Effective pause status. A `pause_until` in the past means the pause window
   * (timed `/pause`, or an automatic human takeover) has lapsed, so the bot is
   * back on regardless of the stored `pause_status`. Rows with no `pause_until`
   * (e.g. `/release`) keep their stored status indefinitely.
   */
  private resolveStatus(f: ConversationFields): ConversationStatus {
    if (f.pause_until && new Date(f.pause_until).getTime() < Date.now()) {
      return 'bot';
    }
    return f.pause_status ?? 'bot';
  }

  private parsePending(value: string | undefined): PendingDates | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed as PendingDates;
    } catch {
      this.logger.warn('conversation', 'could not parse pending_dates', {
        value,
      });
    }
    return null;
  }

  private async upsert(
    phone: string,
    fields: ConversationFields,
  ): Promise<void> {
    const row = await this.findRow(phone);
    if (row) {
      await this.airtable.update<ConversationFields>(
        'Conversations',
        row.id,
        fields,
      );
    } else {
      // Defaults applied only on initial creation.
      const initial: ConversationFields = {
        status: 'New',
        enquiry_source: 'whatsapp',
        follow_up_count: 0,
        follow_up_24h_sent: false,
        follow_up_7d_sent: false,
        ...fields,
      };
      await this.airtable.create<ConversationFields>(
        'Conversations',
        initial,
      );
    }
  }

  private async findRow(phone: string) {
    const rows = await this.airtable.list<ConversationFields>('Conversations', {
      filterByFormula: `{phone}='${phone}'`,
      maxRecords: 1,
    });
    return rows[0];
  }

  private async findGlobalPauseRow() {
    const rows = await this.airtable.list<BookingRulesFields>('BookingRules', {
      filterByFormula: `{key}='${GLOBAL_PAUSE_KEY}'`,
      maxRecords: 1,
    });
    return rows[0];
  }

  private parseGlobalPauseValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes';
    }
    return false;
  }
}
