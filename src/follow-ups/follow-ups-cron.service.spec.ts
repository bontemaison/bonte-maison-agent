import { ConversationService } from '../conversation/conversation.service';
import { LoggerService } from '../logger/logger.service';
import { MessageLogService } from '../messagelog/messagelog.service';
import { TemplatesService } from '../templates/templates.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { FollowUpsCronService } from './follow-ups-cron.service';
import { FollowUp, FollowUpsService } from './follow-ups.service';

const makeConversation = (
  candidates: Array<{
    phone: string;
    customerName: string | null;
    checkIn: string;
    checkOut: string;
  }> = [],
) =>
  ({
    markFollowUpSent: jest.fn().mockResolvedValue(undefined),
    setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
    listDateReconfirmationCandidates: jest.fn().mockResolvedValue(candidates),
    markDateReconfirmationSent: jest.fn().mockResolvedValue(undefined),
    updateContext: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ConversationService;

const makeLogger = () =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as LoggerService;

const makeResponse = (text = 'rendered') =>
  ({ render: jest.fn().mockResolvedValue(text) }) as unknown as TemplatesService;

const makeWhatsapp = () =>
  ({ sendMessage: jest.fn().mockResolvedValue(undefined) }) as unknown as WhatsappService;

const makeMessageLog = () =>
  ({ log: jest.fn().mockResolvedValue(undefined) }) as unknown as MessageLogService;

const makeFollowUps = (due: FollowUp[] = []) =>
  ({
    listDue: jest.fn().mockResolvedValue(due),
    markSent24h: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
  }) as unknown as FollowUpsService;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const fixture = (overrides: Partial<FollowUp['fields']> = {}): FollowUp => ({
  id: 'rec1',
  fields: {
    phone: '447111',
    quote_sent_at: new Date().toISOString(),
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  },
});

describe('FollowUpsCronService', () => {
  it('sends followup_24h for pending rows aged ≥ 24h but < 7d', async () => {
    const row = fixture({
      quote_sent_at: new Date(Date.now() - 25 * HOUR).toISOString(),
    });
    const followUps = makeFollowUps([row]);
    const response = makeResponse('24h reply');
    const whatsapp = makeWhatsapp();
    const cron = new FollowUpsCronService(
      followUps,
      whatsapp,
      makeMessageLog(),
      response,
      makeConversation(),
      makeLogger(),
    );

    await cron.runDailyCheck();

    expect(response.render).toHaveBeenCalledWith('followup_24h', expect.any(Object));
    expect(whatsapp.sendMessage).toHaveBeenCalledWith('447111', '24h reply');
    expect(followUps.markSent24h).toHaveBeenCalledWith('rec1');
  });

  it('sends followup_7d for sent_24h rows aged ≥ 7d and marks completed', async () => {
    const row = fixture({
      quote_sent_at: new Date(Date.now() - 8 * DAY).toISOString(),
      status: 'sent_24h',
    });
    const followUps = makeFollowUps([row]);
    const response = makeResponse('7d reply');
    const whatsapp = makeWhatsapp();
    const cron = new FollowUpsCronService(
      followUps,
      whatsapp,
      makeMessageLog(),
      response,
      makeConversation(),
      makeLogger(),
    );

    await cron.runDailyCheck();

    expect(response.render).toHaveBeenCalledWith('followup_7d', expect.any(Object));
    expect(whatsapp.sendMessage).toHaveBeenCalledWith('447111', '7d reply');
    expect(followUps.markCompleted).toHaveBeenCalledWith('rec1');
  });

  it('does nothing for rows aged < 24h', async () => {
    const row = fixture({
      quote_sent_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    });
    const followUps = makeFollowUps([row]);
    const whatsapp = makeWhatsapp();
    const cron = new FollowUpsCronService(
      followUps,
      whatsapp,
      makeMessageLog(),
      makeResponse(),
      makeConversation(),
      makeLogger(),
    );

    await cron.runDailyCheck();

    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(followUps.markSent24h).not.toHaveBeenCalled();
  });

  it('sends date_reconfirmation_check, parks dates, and marks sent for idle candidates', async () => {
    const conversation = makeConversation([
      {
        phone: '447222',
        customerName: 'Sam',
        checkIn: '2027-08-08',
        checkOut: '2027-08-15',
      },
    ]);
    const response = makeResponse('reconfirm reply');
    const whatsapp = makeWhatsapp();
    const cron = new FollowUpsCronService(
      makeFollowUps(),
      whatsapp,
      makeMessageLog(),
      response,
      conversation,
      makeLogger(),
    );

    await cron.runDailyCheck();

    expect(response.render).toHaveBeenCalledWith(
      'date_reconfirmation_check',
      expect.objectContaining({
        name: 'Sam',
        name_comma: ', Sam',
        check_in: expect.stringContaining('August'),
        check_out: expect.stringContaining('August'),
      }),
    );
    expect(whatsapp.sendMessage).toHaveBeenCalledWith('447222', 'reconfirm reply');
    expect(conversation.updateContext).toHaveBeenCalledWith('447222', {
      lastIntent: 'awaiting_dates_confirmation',
      pendingDates: {
        checkIn: '2027-08-08',
        checkOut: '2027-08-15',
        guests: null,
      },
    });
    expect(conversation.markDateReconfirmationSent).toHaveBeenCalledWith('447222');
  });

  it('skips the 24h step if ≥7d already elapsed and goes straight to 7d', async () => {
    const row = fixture({
      quote_sent_at: new Date(Date.now() - 9 * DAY).toISOString(),
      status: 'pending',
    });
    const followUps = makeFollowUps([row]);
    const response = makeResponse();
    const cron = new FollowUpsCronService(
      followUps,
      makeWhatsapp(),
      makeMessageLog(),
      response,
      makeConversation(),
      makeLogger(),
    );

    await cron.runDailyCheck();

    expect(response.render).toHaveBeenCalledWith('followup_7d', expect.any(Object));
    expect(followUps.markCompleted).toHaveBeenCalledWith('rec1');
  });
});
