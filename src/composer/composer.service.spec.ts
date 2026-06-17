import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { ComposerService, CompositionPackage } from './composer.service';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockCreate(...args) },
  })),
);

const makeConfig = (
  values: Record<string, string | undefined> = {
    ANTHROPIC_API_KEY: 'test-key',
    CLAUDE_RESPONSE_MODEL: 'claude-sonnet-4-6',
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

const claudeText = (text: string) => ({ content: [{ type: 'text', text }] });

const basePkg = (overrides: Partial<CompositionPackage> = {}): CompositionPackage => ({
  guestName: 'Maria',
  isFirstMessage: false,
  toneFlags: {
    needsGreeting: false,
    needsAcknowledgment: true,
    needsNudgeToBook: false,
    needsSignOff: true,
  },
  facts: [
    {
      key: 'dogs_allowed',
      text: 'Dogs are very welcome and there is no limit.',
    },
  ],
  openers: ['Yes of course,', 'Happy to help'],
  closers: ['Just shout if anything else comes up.'],
  nudges: ['Happy to hold those dates if helpful.'],
  history: [],
  ...overrides,
});

describe('ComposerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the model output when validation passes', async () => {
    mockCreate.mockResolvedValue(
      claudeText(
        'Yes of course, dogs are very welcome here with no limit. Just shout if anything else comes up.',
      ),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('dogs are very welcome');
    }
  });

  it('rejects output containing forbidden terms', async () => {
    mockCreate.mockResolvedValue(
      claudeText(
        "I'm afraid those dates are sold I'm afraid. Just shout if anything else comes up.",
      ),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/forbidden_term/);
    }
  });

  it('rejects invented availability claims about dates not being released yet', async () => {
    mockCreate.mockResolvedValue(
      claudeText(
        "For 2028 dates, I don't have that availability open just yet. I'll be in touch as soon as those weeks are released.",
      ),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg({ scenarioHint: 'dates_unclear', facts: [] }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/forbidden_term/);
    }
  });

  it('rejects output that opens with a banned greeting mid-conversation', async () => {
    mockCreate.mockResolvedValue(
      claudeText('Hi! Dogs are very welcome here. Just shout if anything else comes up.'),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg({ toneFlags: { ...basePkg().toneFlags, needsGreeting: false } }));

    expect(result.ok).toBe(false);
  });

  it('allows banned openers when this is the first message', async () => {
    mockCreate.mockResolvedValue(
      claudeText('Hi Maria — happy to help with anything you need ahead of your stay.'),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(
      basePkg({
        isFirstMessage: true,
        toneFlags: { ...basePkg().toneFlags, needsGreeting: true },
        facts: [],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('rejects output that signs off as Jim', async () => {
    mockCreate.mockResolvedValue(
      claudeText(
        'Yes of course, dogs are very welcome here with no limit.\n\nMany thanks,\nJim',
      ),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/banned_signoff/);
    }
  });

  it('reports api_error when Claude call throws', async () => {
    mockCreate.mockRejectedValue(new Error('429 rate limited'));
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('api_error');
    }
  });

  it('rejects empty output', async () => {
    mockCreate.mockResolvedValue(claudeText(''));
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty_output');
    }
  });

  it('rejects meta-remarks about repeated messages', async () => {
    mockCreate.mockResolvedValue(
      claudeText(
        'Looks like your message came through twice. As mentioned, September is fully available.',
      ),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/forbidden_term/);
    }
  });

  it('strips em and en dashes from output', async () => {
    mockCreate.mockResolvedValue(
      claudeText(
        'Yes, Bonté Maison — near Duras, between Bordeaux and Bergerac. Just shout if anything else comes up.',
      ),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    const result = await svc.compose(basePkg());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).not.toMatch(/[—–]/);
      expect(result.text).toContain('Bonté Maison, near Duras');
    }
  });

  it('builds a structured user prompt with facts and tone flags', async () => {
    mockCreate.mockResolvedValue(
      claudeText('Yes of course, dogs are very welcome here.'),
    );
    const svc = new ComposerService(makeLogger(), makeConfig());

    await svc.compose(basePkg());

    const call = mockCreate.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    const content = call.messages[0].content;
    expect(content).toContain('Guest name: Maria');
    expect(content).toContain('needsAcknowledgment: true');
    expect(content).toContain('dogs_allowed');
    expect(content).toContain('Yes of course');
  });
});
