import { AirtableRecord, ListOptions } from '../../../src/airtable/airtable.service';
import { ParseResult } from '../../../src/parser/parser.service';
import type { IncomingMessage, WhatsAppProvider } from '../../../src/whatsapp/providers/provider.interface';

export type AnyFields = Record<string, unknown>;

export class FakeAirtable {
  private store = new Map<string, AirtableRecord<AnyFields>[]>();
  private idSeq = 0;

  reset(): void {
    this.store.clear();
    this.idSeq = 0;
  }

  seed(table: string, rows: AnyFields[]): void {
    const list = this.store.get(table) ?? [];
    for (const fields of rows) {
      list.push({ id: `rec_${++this.idSeq}`, fields: { ...fields } });
    }
    this.store.set(table, list);
  }

  rows(table: string): AirtableRecord<AnyFields>[] {
    return this.store.get(table) ?? [];
  }

  // --- AirtableService surface ---

  list = jest.fn(
    async <T extends AnyFields>(
      table: string,
      options: ListOptions = {},
    ): Promise<AirtableRecord<T>[]> => {
      let rows = (this.store.get(table) ?? []) as AirtableRecord<T>[];
      if (options.filterByFormula) {
        rows = rows.filter((r) =>
          this.matchesFormula(options.filterByFormula!, r.fields),
        );
      }
      if (options.sort && options.sort.length > 0) {
        const { field, direction } = options.sort[0];
        const dir = direction === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const av = (a.fields as AnyFields)[field];
          const bv = (b.fields as AnyFields)[field];
          if (av === bv) return 0;
          return (av! < bv! ? -1 : 1) * dir;
        });
      }
      if (typeof options.maxRecords === 'number') {
        rows = rows.slice(0, options.maxRecords);
      }
      return rows.map((r) => ({ id: r.id, fields: { ...r.fields } }));
    },
  );

  find = jest.fn(
    async <T extends AnyFields>(
      table: string,
      id: string,
    ): Promise<AirtableRecord<T> | null> => {
      const row = (this.store.get(table) ?? []).find((r) => r.id === id);
      return row ? ({ id: row.id, fields: { ...row.fields } } as AirtableRecord<T>) : null;
    },
  );

  create = jest.fn(
    async <T extends AnyFields>(
      table: string,
      fields: T,
    ): Promise<AirtableRecord<T>> => {
      const list = this.store.get(table) ?? [];
      const record = { id: `rec_${++this.idSeq}`, fields: { ...fields } };
      list.push(record);
      this.store.set(table, list);
      return { id: record.id, fields: { ...record.fields } } as AirtableRecord<T>;
    },
  );

  update = jest.fn(
    async <T extends AnyFields>(
      table: string,
      id: string,
      fields: Partial<T>,
    ): Promise<AirtableRecord<T>> => {
      const list = this.store.get(table) ?? [];
      const row = list.find((r) => r.id === id);
      if (!row) throw new Error(`record ${id} not found in ${table}`);
      row.fields = { ...row.fields, ...fields };
      return { id: row.id, fields: { ...row.fields } } as AirtableRecord<T>;
    },
  );

  /**
   * Tiny formula matcher — handles only the patterns this codebase uses:
   *   {field}='value'
   *   AND({a}='x', {b}='y')
   */
  private matchesFormula(formula: string, fields: AnyFields): boolean {
    const trimmed = formula.trim();
    const andMatch = trimmed.match(/^AND\((.*)\)$/);
    if (andMatch) {
      const parts = this.splitTopLevel(andMatch[1]);
      return parts.every((p) => this.matchesFormula(p, fields));
    }
    const eqMatch = trimmed.match(/^\{(\w+)\}\s*=\s*'(.*)'$/);
    if (eqMatch) {
      const [, key, value] = eqMatch;
      return String(fields[key] ?? '') === value;
    }
    return true;
  }

  private splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    out.push(s.slice(start));
    return out.map((p) => p.trim());
  }
}

// --- Parser fake ---

const DEFAULT_PARSE: ParseResult = {
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

export class FakeParser {
  private map = new Map<string, Partial<ParseResult>>();
  private fallback: Partial<ParseResult> | null = null;
  public calls: Array<{ message: string }> = [];

  reset(): void {
    this.map.clear();
    this.fallback = null;
    this.calls = [];
  }

  setResponse(message: string, result: Partial<ParseResult>): void {
    this.map.set(message, result);
  }

  setFallback(result: Partial<ParseResult>): void {
    this.fallback = result;
  }

  parse = jest.fn(async (message: string): Promise<ParseResult> => {
    this.calls.push({ message });
    const r = this.map.get(message) ?? this.fallback;
    if (!r) return { ...DEFAULT_PARSE };
    return { ...DEFAULT_PARSE, ...r };
  });
}

// --- Availability fake ---

export class FakeAvailability {
  private bookedRanges: Array<{ start: Date; end: Date }> = [];
  private throwError: Error | null = null;

  reset(): void {
    this.bookedRanges = [];
    this.throwError = null;
  }

  block(start: Date, end: Date): void {
    this.bookedRanges.push({ start, end });
  }

  fail(err: Error): void {
    this.throwError = err;
  }

  isRangeAvailable = jest.fn(async (checkIn: Date, checkOut: Date): Promise<boolean> => {
    if (this.throwError) throw this.throwError;
    return !this.bookedRanges.some(
      (r) => r.start.getTime() < checkOut.getTime() && r.end.getTime() > checkIn.getTime(),
    );
  });
}

// --- Email service fake ---

export type SentEmail = { to: string; subject: string; body: string };

export class FakeEmailService {
  public sent: SentEmail[] = [];
  private throwError: Error | null = null;

  reset(): void {
    this.sent = [];
    this.throwError = null;
  }

  fail(err: Error): void {
    this.throwError = err;
  }

  isConfigured(): boolean {
    return true;
  }

  send = jest.fn(async (msg: SentEmail): Promise<void> => {
    if (this.throwError) throw this.throwError;
    this.sent.push({ ...msg });
  });
}

// --- Whatsapp provider fake ---

export type SentMessage = { to: string; text: string };

export class FakeWhatsAppProvider implements WhatsAppProvider {
  public sent: SentMessage[] = [];

  reset(): void {
    this.sent = [];
  }

  sendMessage = jest.fn(async (to: string, text: string) => {
    this.sent.push({ to, text });
    return {} as { id?: string };
  });

  sendTemplate = jest.fn(async () => ({}) as { id?: string });

  parseWebhook(_payload: unknown): IncomingMessage | null {
    return null;
  }
}
