import { AirtableService } from '../airtable/airtable.service';
import { ConversationService } from '../conversation/conversation.service';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { GuestsService } from '../guests/guests.service';
import { LoggerService } from '../logger/logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NudgeDispatcherService } from './nudge-dispatcher.service';

const makeLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const EMAIL = 'asjohns95@gmail.com';

const input = (key = 'nudge_pre_arrival') =>
  ({
    key,
    guestEmail: EMAIL,
    subject: 'Bonté — your arrival details',
    messageId: 'msg-1',
  }) as Parameters<NudgeDispatcherService['dispatch']>[0];

type Parts = {
  conversationRows?: Array<{ id: string; fields: Record<string, unknown> }>;
  guestRows?: Array<{ id: string; fields: Record<string, unknown> }>;
};

const build = (parts: Parts = {}) => {
  const airtable = {
    list: jest.fn().mockResolvedValue(parts.conversationRows ?? []),
  } as unknown as AirtableService;
  const whatsapp = {
    sendTemplate: jest.fn().mockResolvedValue({ id: 'wamid' }),
  } as unknown as WhatsappService;
  const notifications = {
    notifyOwner: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
  const guests = {
    findByEmail: jest.fn().mockResolvedValue(parts.guestRows ?? []),
  } as unknown as GuestsService;
  const conversation = {
    setLifecycleStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConversationService;
  const followUps = {
    cancel: jest.fn().mockResolvedValue(undefined),
  } as unknown as FollowUpsService;

  return {
    svc: new NudgeDispatcherService(
      airtable,
      whatsapp,
      notifications,
      guests,
      conversation,
      followUps,
      makeLogger(),
    ),
    airtable,
    whatsapp,
    notifications,
    guests,
    conversation,
    followUps,
  };
};

describe('NudgeDispatcherService.dispatch', () => {
  it('sends to the phone on a matching Conversations row', async () => {
    const { svc, whatsapp, guests } = build({
      conversationRows: [
        {
          id: 'c1',
          fields: { phone: '447877023353', customer_name: 'Abigail' },
        },
      ],
    });

    const result = await svc.dispatch(input());

    expect(result).toEqual({
      status: 'sent',
      phone: '447877023353',
      key: 'nudge_pre_arrival',
    });
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '447877023353',
      'nudge_pre_arrival',
      { '1': 'Abigail' },
      { override: true },
    );
    // The cheaper lookup wins; no need to touch Guests at all.
    expect(guests.findByEmail).not.toHaveBeenCalled();
  });

  // A guest who booked through the website has no Conversations row. Without
  // the Guests fallback they silently receive none of their nudges.
  it('falls back to the Guests table when no conversation exists', async () => {
    const { svc, whatsapp, notifications } = build({
      conversationRows: [],
      guestRows: [
        {
          id: 'g1',
          fields: {
            phone: '447877023353',
            guest_name: 'Abigail Johns',
            booking_ref: '33',
          },
        },
      ],
    });

    const result = await svc.dispatch(input());

    expect(result.status).toBe('sent');
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '447877023353',
      'nudge_pre_arrival',
      { '1': 'Abigail' },
      { override: true },
    );
    expect(notifications.notifyOwner).not.toHaveBeenCalled();
  });

  it('skips a Guests row that has no phone number', async () => {
    const { svc, whatsapp } = build({
      guestRows: [{ id: 'g1', fields: { guest_name: 'Abigail Johns' } }],
    });

    expect((await svc.dispatch(input())).status).toBe('unmatched_guest');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends nothing and tells Jim when the guest cannot be matched', async () => {
    const { svc, whatsapp, notifications } = build();

    const result = await svc.dispatch(input());

    expect(result).toEqual({ status: 'unmatched_guest', email: EMAIL });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(notifications.notifyOwner).toHaveBeenCalledWith(
      expect.stringContaining(EMAIL),
      expect.objectContaining({ reason: 'unmatched_guest' }),
    );
  });

  it('marks the conversation Booked and stops the chase on confirmation', async () => {
    const { svc, conversation, followUps } = build({
      conversationRows: [
        {
          id: 'c1',
          fields: { phone: '447877023353', customer_name: 'Abigail' },
        },
      ],
    });

    await svc.dispatch(input('nudge_booking_confirmation'));

    expect(conversation.setLifecycleStatus).toHaveBeenCalledWith(
      '447877023353',
      'Booked',
    );
    expect(followUps.cancel).toHaveBeenCalledWith('447877023353');
  });

  it('leaves the CRM alone for the other nudge types', async () => {
    const { svc, conversation, followUps } = build({
      conversationRows: [
        {
          id: 'c1',
          fields: { phone: '447877023353', customer_name: 'Abigail' },
        },
      ],
    });

    await svc.dispatch(input('nudge_mid_stay'));

    expect(conversation.setLifecycleStatus).not.toHaveBeenCalled();
    expect(followUps.cancel).not.toHaveBeenCalled();
  });

  // The nudge has already gone out by this point — bookkeeping trouble must not
  // be reported back as a send failure.
  it('still reports success when the CRM write fails', async () => {
    const { svc, conversation } = build({
      conversationRows: [
        {
          id: 'c1',
          fields: { phone: '447877023353', customer_name: 'Abigail' },
        },
      ],
    });
    (conversation.setLifecycleStatus as jest.Mock).mockRejectedValue(
      new Error('airtable down'),
    );

    const result = await svc.dispatch(input('nudge_booking_confirmation'));

    expect(result.status).toBe('sent');
  });
});
