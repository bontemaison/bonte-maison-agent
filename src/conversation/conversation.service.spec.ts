import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';
import { ConversationService } from './conversation.service';

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const makeAirtable = (overrides: Partial<AirtableService> = {}) =>
  ({
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'new-rec', fields: {} }),
    update: jest.fn().mockResolvedValue({ id: 'rec1', fields: {} }),
    ...overrides,
  }) as unknown as AirtableService;

describe('ConversationService.getStatus', () => {
  it('returns bot when no conversation row exists for the phone', async () => {
    const airtable = makeAirtable();
    const service = new ConversationService(airtable, makeLogger());

    const status = await service.getStatus('62812');

    expect(status).toBe('bot');
    expect(airtable.list).toHaveBeenCalledWith('Conversations', {
      filterByFormula: "{phone}='62812'",
      maxRecords: 1,
    });
  });

  it('returns the stored status when a row exists', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'rec1', fields: { phone: '62812', pause_status: 'human' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.getStatus('62812')).toBe('human');
  });

  it('returns bot when the stored status has expired via pause_until', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        {
          id: 'rec1',
          fields: { phone: '62812', pause_status: 'paused', pause_until: past },
        },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.getStatus('62812')).toBe('bot');
  });

  it('stays paused when pause_until is in the future', async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        {
          id: 'rec1',
          fields: { phone: '62812', pause_status: 'paused', pause_until: future },
        },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.getStatus('62812')).toBe('paused');
  });

  it('resumes the bot once a human takeover window has expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        {
          id: 'rec1',
          fields: { phone: '62812', pause_status: 'human', pause_until: past },
        },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.getStatus('62812')).toBe('bot');
  });

  it('stays human during the takeover window (future pause_until)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        {
          id: 'rec1',
          fields: { phone: '62812', pause_status: 'human', pause_until: future },
        },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.getStatus('62812')).toBe('human');
  });

  it('keeps a manual /release (human, no pause_until) paused indefinitely', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'rec1', fields: { phone: '62812', pause_status: 'human' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.getStatus('62812')).toBe('human');
  });
});

describe('ConversationService.resumeExpired', () => {
  it('writes expired human/paused rows back to bot and clears pause_until', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'expired-human', fields: { phone: '1', pause_status: 'human', pause_until: past } },
        { id: 'expired-paused', fields: { phone: '2', pause_status: 'paused', pause_until: past } },
        { id: 'active-window', fields: { phone: '3', pause_status: 'human', pause_until: future } },
        { id: 'released', fields: { phone: '4', pause_status: 'human' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    const resumed = await service.resumeExpired();

    expect(resumed).toBe(2);
    expect(airtable.update).toHaveBeenCalledWith('Conversations', 'expired-human', {
      pause_status: 'bot',
      pause_until: null,
    });
    expect(airtable.update).toHaveBeenCalledWith('Conversations', 'expired-paused', {
      pause_status: 'bot',
      pause_until: null,
    });
    expect(airtable.update).toHaveBeenCalledTimes(2);
  });

  it('continues the sweep when one write fails', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'boom', fields: { phone: '1', pause_status: 'human', pause_until: past } },
        { id: 'ok', fields: { phone: '2', pause_status: 'paused', pause_until: past } },
      ]),
      update: jest
        .fn()
        .mockRejectedValueOnce(new Error('airtable 500'))
        .mockResolvedValueOnce({ id: 'ok', fields: {} }),
    });
    const service = new ConversationService(airtable, makeLogger());

    const resumed = await service.resumeExpired();

    expect(resumed).toBe(1);
    expect(airtable.update).toHaveBeenCalledTimes(2);
  });
});

describe('ConversationService.getState', () => {
  it('returns defaults when there is no row', async () => {
    const service = new ConversationService(makeAirtable(), makeLogger());

    const state = await service.getState('62812');

    expect(state).toEqual({
      status: 'bot',
      lifecycleStatus: 'New',
      lastIntent: null,
      pendingDates: null,
      customerName: null,
    });
  });

  it('reads lastIntent, pendingDates (JSON), and customerName', async () => {
    const pending = JSON.stringify({
      checkIn: '2026-06-15',
      checkOut: null,
      guests: 2,
    });
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        {
          id: 'r',
          fields: {
            phone: '62812',
            pause_status: 'bot',
            last_intent: 'availability_inquiry',
            pending_dates: pending,
            customer_name: 'Maria',
          },
        },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    const state = await service.getState('62812');

    expect(state.status).toBe('bot');
    expect(state.lastIntent).toBe('availability_inquiry');
    expect(state.pendingDates).toEqual({
      checkIn: '2026-06-15',
      checkOut: null,
      guests: 2,
    });
    expect(state.customerName).toBe('Maria');
  });

  it('gracefully handles malformed pending_dates JSON', async () => {
    const logger = makeLogger();
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'r', fields: { phone: '62812', pending_dates: 'not-json' } },
      ]),
    });
    const service = new ConversationService(airtable, logger);

    const state = await service.getState('62812');

    expect(state.pendingDates).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('ConversationService.canSendBot', () => {
  it('allows sends when status is bot', async () => {
    const service = new ConversationService(makeAirtable(), makeLogger());
    expect(await service.canSendBot('62812')).toBe(true);
  });

  it('blocks sends when status is human or paused', async () => {
    const humanAirtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'r', fields: { phone: '62812', pause_status: 'human' } },
      ]),
    });
    const pausedAirtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        {
          id: 'r',
          fields: {
            phone: '62812',
            pause_status: 'paused',
            pause_until: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ]),
    });

    expect(
      await new ConversationService(humanAirtable, makeLogger()).canSendBot(
        '62812',
      ),
    ).toBe(false);
    expect(
      await new ConversationService(pausedAirtable, makeLogger()).canSendBot(
        '62812',
      ),
    ).toBe(false);
  });

  it('blocks sends when global pause is on, regardless of per-conv status', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockImplementation((table: string) => {
        if (table === 'BookingRules') {
          return Promise.resolve([
            {
              id: 'r-global',
              fields: { key: 'bot_paused_global', value: 'true', active: true },
            },
          ]);
        }
        // Conversations table — say the conversation is in bot mode
        return Promise.resolve([
          { id: 'r1', fields: { phone: '62812', pause_status: 'bot' } },
        ]);
      }),
    });
    const service = new ConversationService(airtable, makeLogger());

    expect(await service.canSendBot('62812')).toBe(false);
  });
});

describe('ConversationService global pause', () => {
  it('returns false when no BookingRules row exists', async () => {
    const airtable = makeAirtable();
    const service = new ConversationService(airtable, makeLogger());
    expect(await service.getGlobalPaused()).toBe(false);
  });

  it('returns true when value is "true"', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'r', fields: { key: 'bot_paused_global', value: 'true' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());
    expect(await service.getGlobalPaused()).toBe(true);
  });

  it('returns false on Airtable read failure', async () => {
    const logger = makeLogger();
    const airtable = makeAirtable({
      list: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const service = new ConversationService(airtable, logger);
    expect(await service.getGlobalPaused()).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('creates a BookingRules row when one does not exist', async () => {
    const airtable = makeAirtable();
    const service = new ConversationService(airtable, makeLogger());

    await service.setGlobalPaused(true);

    expect(airtable.create).toHaveBeenCalledWith(
      'BookingRules',
      expect.objectContaining({
        key: 'bot_paused_global',
        value: 'true',
        active: true,
      }),
    );
  });

  it('updates the existing BookingRules row', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'rec-gp', fields: { key: 'bot_paused_global', value: 'true' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    await service.setGlobalPaused(false);

    expect(airtable.update).toHaveBeenCalledWith(
      'BookingRules',
      'rec-gp',
      expect.objectContaining({ value: 'false' }),
    );
  });
});

describe('ConversationService.setStatus', () => {
  it('creates a new row when one does not exist', async () => {
    const airtable = makeAirtable();
    const service = new ConversationService(airtable, makeLogger());

    await service.setStatus('62812', 'human');

    expect(airtable.create).toHaveBeenCalledWith(
      'Conversations',
      expect.objectContaining({ phone: '62812', pause_status: 'human' }),
    );
  });

  it('updates the existing row when one exists', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'rec1', fields: { phone: '62812', pause_status: 'bot' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    await service.setStatus('62812', 'paused', {
      pauseForMinutes: 30,
    });

    expect(airtable.update).toHaveBeenCalledWith(
      'Conversations',
      'rec1',
      expect.objectContaining({
        pause_status: 'paused',
        pause_until: expect.any(String),
      }),
    );
  });
});

describe('ConversationService.updateContext', () => {
  it('stores pendingDates as JSON and customerName/lastIntent as given', async () => {
    const airtable = makeAirtable();
    const service = new ConversationService(airtable, makeLogger());

    await service.updateContext('62812', {
      lastIntent: 'availability_inquiry',
      pendingDates: { checkIn: '2026-06-15', checkOut: null, guests: 2 },
      customerName: 'Maria',
    });

    expect(airtable.create).toHaveBeenCalledWith(
      'Conversations',
      expect.objectContaining({
        phone: '62812',
        last_intent: 'availability_inquiry',
        pending_dates: expect.stringContaining('2026-06-15'),
        customer_name: 'Maria',
      }),
    );
  });

  it('clears pendingDates when passed null', async () => {
    const airtable = makeAirtable({
      list: jest.fn().mockResolvedValue([
        { id: 'r1', fields: { phone: '62812', pending_dates: 'old' } },
      ]),
    });
    const service = new ConversationService(airtable, makeLogger());

    await service.updateContext('62812', { pendingDates: null });

    expect(airtable.update).toHaveBeenCalledWith(
      'Conversations',
      'r1',
      expect.objectContaining({ pending_dates: '' }),
    );
  });
});

describe('ConversationService.parseCommand', () => {
  const service = new ConversationService(makeAirtable(), makeLogger());

  it('parses /release with no arg', () => {
    expect(service.parseCommand('/release')).toEqual({ command: 'release' });
  });

  it('parses /release with a phone target', () => {
    expect(service.parseCommand('/release 628777')).toEqual({
      command: 'release',
      phone: '628777',
    });
  });

  it('parses /pause with no args', () => {
    expect(service.parseCommand('/pause')).toEqual({ command: 'pause' });
  });

  it('parses /pause with just a minutes duration', () => {
    expect(service.parseCommand('/pause 30')).toEqual({
      command: 'pause',
      minutes: 30,
    });
  });

  it('parses /pause with phone and minutes', () => {
    expect(service.parseCommand('/pause 628777 30')).toEqual({
      command: 'pause',
      phone: '628777',
      minutes: 30,
    });
  });

  it('parses /resume with optional phone', () => {
    expect(service.parseCommand('/resume')).toEqual({ command: 'resume' });
    expect(service.parseCommand('/resume 628777')).toEqual({
      command: 'resume',
      phone: '628777',
    });
  });

  it('parses /status with optional phone', () => {
    expect(service.parseCommand('/status')).toEqual({ command: 'status' });
    expect(service.parseCommand('/status 628777')).toEqual({
      command: 'status',
      phone: '628777',
    });
  });

  it('returns null for non-commands', () => {
    expect(service.parseCommand('hello there')).toBeNull();
    expect(service.parseCommand('/unknown')).toBeNull();
    expect(service.parseCommand('')).toBeNull();
  });

  it('is case-insensitive and tolerant of leading whitespace', () => {
    expect(service.parseCommand('  /RELEASE')).toEqual({ command: 'release' });
    expect(service.parseCommand('/Pause 15')).toEqual({
      command: 'pause',
      minutes: 15,
    });
  });
});
