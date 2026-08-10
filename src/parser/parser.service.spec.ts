import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { ParserService } from './parser.service';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockCreate(...args) },
  })),
);

const makeConfig = (
  values: Record<string, string | undefined> = {
    ANTHROPIC_API_KEY: 'test-key',
    CLAUDE_MODEL: 'claude-sonnet-5',
  },
): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const makeLogger = (): LoggerService =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const claudeResponse = (json: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(json) }],
});

const fullJson = (overrides: Record<string, unknown> = {}) => ({
  intent: 'greeting',
  confidence: 0.9,
  customerName: null,
  checkIn: null,
  checkOut: null,
  guests: null,
  mentionsDiscount: false,
  highIntentSignal: false,
  ...overrides,
});

describe('ParserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws at construction when ANTHROPIC_API_KEY is missing', () => {
    expect(
      () =>
        new ParserService(
          makeConfig({ ANTHROPIC_API_KEY: undefined }),
          makeLogger(),
        ),
    ).toThrow();
  });

  it('parses a well-formed Claude response into a structured intent', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse(
        fullJson({
          intent: 'availability_inquiry',
          confidence: 0.95,
          customerName: 'Maria',
          checkIn: '2026-06-15',
          checkOut: '2026-06-20',
          guests: 2,
        }),
      ),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('Hi, Maria here. Is 15-20 June free for 2?');

    expect(out).toEqual({
      intent: 'availability_inquiry',
      confidence: 0.95,
      customerName: 'Maria',
      guestEmail: null,
      checkIn: new Date('2026-06-15'),
      checkOut: new Date('2026-06-20'),
      guests: 2,
      mentionsDiscount: false,
      highIntentSignal: false,
      topicKeys: [],
      monthQuery: null,
      monthRangeQuery: null,
      needsGreeting: false,
      needsAcknowledgment: false,
      isCorrection: false,
      isClarificationOfPrevious: false,
    });
  });

  it('calls Claude with the configured model and the user message', async () => {
    mockCreate.mockResolvedValue(claudeResponse(fullJson()));
    const service = new ParserService(makeConfig(), makeLogger());

    await service.parse('hey');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('hey'),
          }),
        ]),
      }),
    );
  });

  it('passes conversation history to Claude when provided', async () => {
    mockCreate.mockResolvedValue(claudeResponse(fullJson()));
    const service = new ParserService(makeConfig(), makeLogger());

    await service.parse('yes please', [
      { role: 'customer', text: 'is 15-20 june free?' },
      { role: 'assistant', text: 'yes, those dates are free. confirm?' },
    ]);

    const call = mockCreate.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    expect(call.messages[0].content).toContain('Customer: is 15-20 june free?');
    expect(call.messages[0].content).toContain(
      'Assistant: yes, those dates are free. confirm?',
    );
    expect(call.messages[0].content).toContain('yes please');
  });

  it('returns intent with null date/guest fields when Claude omits them', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse({
        intent: 'availability_inquiry',
        confidence: 0.8,
        customerName: null,
      }),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('vague');

    expect(out).toEqual({
      intent: 'availability_inquiry',
      confidence: 0.8,
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
    });
  });

  it('returns off_topic_or_unclear when Claude output is not valid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    const logger = makeLogger();
    const service = new ParserService(makeConfig(), logger);

    const out = await service.parse('whatever');

    expect(out.intent).toBe('off_topic_or_unclear');
    expect(logger.warn).toHaveBeenCalledWith(
      'parser',
      expect.stringContaining('JSON'),
      expect.any(Object),
    );
  });

  it('logs and rethrows when the Claude API call fails', async () => {
    mockCreate.mockRejectedValue(new Error('429 rate limited'));
    const logger = makeLogger();
    const service = new ParserService(makeConfig(), logger);

    await expect(service.parse('hi')).rejects.toThrow('429 rate limited');
    expect(logger.error).toHaveBeenCalledWith(
      'parser',
      expect.stringContaining('Claude'),
      expect.objectContaining({ error: '429 rate limited' }),
    );
  });

  it('parses JSON wrapped in markdown code fences', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '```json\n{\n  "intent": "greeting",\n  "confidence": 0.9,\n  "customerName": null,\n  "checkIn": null,\n  "checkOut": null,\n  "guests": null\n}\n```',
        },
      ],
    });
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('hi');

    expect(out.intent).toBe('greeting');
    expect(out.confidence).toBe(0.9);
  });

  it('parses JSON embedded in surrounding prose', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Here is the result:\n{"intent":"greeting","confidence":0.9,"customerName":null,"checkIn":null,"checkOut":null,"guests":null}\nLet me know if you need more.',
        },
      ],
    });
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('hi');

    expect(out.intent).toBe('greeting');
  });

  it('clamps invalid confidence values to 0', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse(fullJson({ confidence: 'high' })),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('hi');

    expect(out.confidence).toBe(0);
  });

  it('falls back to off_topic_or_unclear for an unknown intent value', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse(fullJson({ intent: 'something_else' })),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('hi');

    expect(out.intent).toBe('off_topic_or_unclear');
  });

  it('sets mentionsDiscount true when Claude returns true', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse(fullJson({ mentionsDiscount: true })),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('can I get a discount?');

    expect(out.mentionsDiscount).toBe(true);
  });

  it('sets highIntentSignal true when Claude returns true', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse(fullJson({ highIntentSignal: true })),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse("this looks perfect, we'd love to book");

    expect(out.highIntentSignal).toBe(true);
  });

  it('defaults mentionsDiscount and highIntentSignal to false when absent', async () => {
    mockCreate.mockResolvedValue(
      claudeResponse({ intent: 'greeting', confidence: 0.9, customerName: null }),
    );
    const service = new ParserService(makeConfig(), makeLogger());

    const out = await service.parse('hi');

    expect(out.mentionsDiscount).toBe(false);
    expect(out.highIntentSignal).toBe(false);
  });
});
