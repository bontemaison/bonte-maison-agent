import { AirtableService } from '../airtable/airtable.service';
import { LoggerService } from '../logger/logger.service';
import {
  audiencesForMode,
  KnowledgeBaseService,
} from './knowledge-base.service';

const makeLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as LoggerService;

const row = (
  topicKey: string,
  answer: string,
  audience?: string,
  active = true,
) => ({
  id: `rec_${topicKey}`,
  fields: {
    topic_key: topicKey,
    question_examples: `${topicKey} examples`,
    answer,
    ...(audience ? { audience } : {}),
    active,
  },
});

const ROWS = [
  row('pool_heated', 'The pool is warmed by the sun.'),
  row('arrival_time', 'Check-in is from 16:00.', 'pre_stay'),
  row('bin_day', 'Bins go out on Tuesday.', 'in_stay'),
  row('wifi_password', 'The WiFi password is {name}-house-2027.', 'sensitive'),
];

// Honours the topic_key filter the service passes, so `render` sees the same
// single row Airtable would return rather than the whole table.
const makeAirtable = (rows = ROWS) =>
  ({
    list: jest
      .fn()
      .mockImplementation(
        (_table: string, options: { filterByFormula?: string } = {}) => {
          const key = options.filterByFormula?.match(
            /\{topic_key\}='([^']+)'/,
          )?.[1];
          return Promise.resolve(
            key ? rows.filter((r) => r.fields.topic_key === key) : rows,
          );
        },
      ),
  }) as unknown as AirtableService;

const build = (rows = ROWS) =>
  new KnowledgeBaseService(makeAirtable(rows), makeLogger());

describe('audiencesForMode', () => {
  it('gives a prospect nothing but the public rows', () => {
    expect(audiencesForMode('prospect')).toEqual(['all']);
    expect(audiencesForMode('hold')).toEqual(['all']);
  });

  it('opens pre-stay content to a confirmed future guest', () => {
    expect(audiencesForMode('future_guest')).toEqual(['all', 'pre_stay']);
  });

  it('opens everything, including sensitive rows, to a guest in residence', () => {
    expect(audiencesForMode('current_guest')).toEqual([
      'all',
      'pre_stay',
      'in_stay',
      'sensitive',
    ]);
  });

  // Once the stay is over the house secrets close again.
  it('closes sensitive content again once the stay is over', () => {
    expect(audiencesForMode('past_guest')).toEqual(['all']);
  });
});

describe('KnowledgeBaseService.listTopics', () => {
  it('defaults to public topics only', async () => {
    const topics = await build().listTopics();
    expect(topics.map((t) => t.topicKey)).toEqual(['pool_heated']);
  });

  it('widens with the audience', async () => {
    const topics = await build().listTopics(audiencesForMode('current_guest'));
    expect(topics.map((t) => t.topicKey)).toEqual([
      'pool_heated',
      'arrival_time',
      'bin_day',
      'wifi_password',
    ]);
  });

  it('treats a blank audience column as public, so existing rows still work', async () => {
    const topics = await build([row('sleeps', 'Sleeps 10.')]).listTopics();
    expect(topics.map((t) => t.topicKey)).toEqual(['sleeps']);
  });

  it('still honours the active checkbox', async () => {
    const topics = await build([
      row('retired', 'Old answer.', undefined, false),
    ]).listTopics();
    expect(topics).toEqual([]);
  });
});

describe('KnowledgeBaseService.render', () => {
  it('returns a public answer to anyone', async () => {
    expect(await build().render('pool_heated', {})).toContain(
      'warmed by the sun',
    );
  });

  // The whole point of the gate: a cold enquiry must never be able to pull the
  // WiFi password out of the knowledge base.
  it('withholds a sensitive answer from a prospect', async () => {
    expect(
      await build().render(
        'wifi_password',
        { name: 'Abigail' },
        audiencesForMode('prospect'),
      ),
    ).toBeNull();
  });

  it('withholds in-stay detail from a future guest', async () => {
    expect(
      await build().render('bin_day', {}, audiencesForMode('future_guest')),
    ).toBeNull();
  });

  it('releases the sensitive answer to a guest in residence', async () => {
    expect(
      await build().render(
        'wifi_password',
        { name: 'Abigail' },
        audiencesForMode('current_guest'),
      ),
    ).toBe('The WiFi password is Abigail-house-2027.');
  });

  it('returns null for an unknown topic', async () => {
    expect(await build([]).render('nope', {})).toBeNull();
  });
});
