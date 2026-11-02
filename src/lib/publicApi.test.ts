import { describe, expect, it } from 'vitest';
import {
  bearerKey,
  buildApiTrainingPlan,
  normalizeOrigin,
  parseOrigins,
  parseTrainingPlanQuery,
  type ApiTrainingPlanData
} from './publicApi';

const key = 'alleda_' + '0123456789abcdef'.repeat(3);

describe('bearerKey', () => {
  it('reads a well-formed key', () => {
    expect(bearerKey(`Bearer ${key}`)).toBe(key);
    expect(bearerKey(`bearer  ${key} `)).toBe(key);
  });

  it.each([
    ['no header', null],
    ['no scheme', key],
    ['another scheme', `Basic ${key}`],
    ['too short', `Bearer ${key.slice(0, -1)}`],
    ['upper case', `Bearer ${key.toUpperCase()}`],
    ['a JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'],
    ['two words', `Bearer ${key} x`]
  ])('refuses %s', (_, header) => {
    expect(bearerKey(header)).toBeNull();
  });
});

describe('origins', () => {
  it('keeps scheme, host and port', () => {
    expect(normalizeOrigin('https://www.JTC.ch/')).toBe('https://www.jtc.ch');
    expect(normalizeOrigin(' https://www.jtc.ch/training?x=1 ')).toBe('https://www.jtc.ch');
    expect(normalizeOrigin('http://localhost:4321')).toBe('http://localhost:4321');
  });

  it('refuses what is no web origin', () => {
    expect(normalizeOrigin('www.jtc.ch')).toBeNull();
    expect(normalizeOrigin('ftp://jtc.ch')).toBeNull();
    expect(normalizeOrigin('https://user:pw@jtc.ch')).toBeNull();
    expect(normalizeOrigin('*')).toBeNull();
  });

  it('parses a text field, without duplicates', () => {
    expect(
      parseOrigins('https://www.jtc.ch/\nhttps://jtc.ch, https://www.jtc.ch  www.x.ch')
    ).toEqual({
      origins: ['https://www.jtc.ch', 'https://jtc.ch'],
      invalid: ['www.x.ch']
    });
    expect(parseOrigins('  ')).toEqual({ origins: [], invalid: [] });
  });
});

describe('parseTrainingPlanQuery', () => {
  // 23:30 UTC on 1 Nov is already 2 Nov in Zurich
  const now = new Date('2026-11-01T23:30:00Z');
  const parse = (q: string) => parseTrainingPlanQuery(new URLSearchParams(q), now);

  it('defaults to eight weeks from today in Zurich', () => {
    expect(parse('')).toEqual({
      ok: true,
      query: { from: '2026-11-02', to: '2026-12-27', trainingIds: null }
    });
  });

  it('takes from, to and training ids', () => {
    expect(parse('from=2026-01-01&to=2026-12-31&training=26,%2027')).toEqual({
      ok: true,
      query: { from: '2026-01-01', to: '2026-12-31', trainingIds: [26, 27] }
    });
  });

  it.each([
    'from=2026-13-01',
    'from=2026-02-30',
    'from=1.1.2026',
    'to=tomorrow',
    'from=2026-05-01&to=2026-04-30',
    'from=2026-01-01&to=2027-01-02',
    'training=',
    'training=26,abc',
    'training=-1'
  ])('refuses %s', (q) => {
    expect(parse(q).ok).toBe(false);
  });

  it('allows a whole leap year', () => {
    expect(parse('from=2028-01-01&to=2028-12-31').ok).toBe(true);
  });
});

describe('buildApiTrainingPlan', () => {
  const data: ApiTrainingPlanData = {
    allowed_origins: [],
    trainings: [
      {
        id: 26,
        title: 'Judo Randori',
        weekday: 'Wednesday',
        dateFrom: '20.00',
        dateTo: '21:30',
        section: 'Judo',
        mainTrainerId: 12
      },
      {
        id: 27,
        title: 'Judo Technik',
        weekday: 'Monday',
        dateFrom: '19:00',
        dateTo: '',
        section: 'Judo',
        mainTrainerId: null
      }
    ],
    sessions: [
      {
        id: 1,
        training_id: 27,
        date: '2026-12-07',
        trainer_id: 13,
        topic: ' Uchi-mata ',
        cancelled: null
      },
      {
        id: 2,
        training_id: 26,
        date: '2026-12-09',
        trainer_id: null,
        topic: null,
        cancelled: true
      },
      { id: 3, training_id: 27, date: '2026-12-21', trainer_id: 13, topic: null, cancelled: false }
    ],
    breaks: [
      {
        id: 1,
        title: 'Weihnachten',
        date_from: '2026-12-21',
        date_to: '2027-01-03',
        cancels_training: true
      },
      {
        id: 2,
        title: 'Winterferien',
        date_from: '2026-12-19',
        date_to: '2027-01-03',
        cancels_training: false
      }
    ],
    trainers: [
      { id: 12, name: 'Anna Muster' },
      { id: 13, name: 'Beni Beispiel' }
    ]
  };
  const query = { from: '2026-12-07', to: '2026-12-23', trainingIds: null };

  it('lists every date with trainer, topic and why it is dropped', () => {
    const plan = buildApiTrainingPlan(data, query);
    expect(plan.from).toBe('2026-12-07');
    expect(plan.timezone).toBe('Europe/Zurich');
    expect(plan.trainings).toEqual([
      {
        id: 26,
        title: 'Judo Randori',
        weekday: 'Wednesday',
        start: '20:00',
        end: '21:30',
        section: 'Judo'
      },
      {
        id: 27,
        title: 'Judo Technik',
        weekday: 'Monday',
        start: '19:00',
        end: null,
        section: 'Judo'
      }
    ]);
    expect(
      plan.sessions.map((s) => [
        s.date,
        s.trainingId,
        s.trainer,
        s.topic,
        s.cancelled,
        s.cancelReason,
        s.holiday
      ])
    ).toEqual([
      // planned trainer and topic, trimmed
      ['2026-12-07', 27, 'Beni Beispiel', 'Uchi-mata', false, null, null],
      // dropped on its own: no reason (notes are never in the API)
      ['2026-12-09', 26, 'Anna Muster', null, true, null, null],
      // no trainer planned, none by default
      ['2026-12-14', 27, null, null, false, null, null],
      // the main trainer by default
      ['2026-12-16', 26, 'Anna Muster', null, false, null, null],
      // held although the dojo is closed
      ['2026-12-21', 27, 'Beni Beispiel', null, false, null, 'Weihnachten'],
      // dropped by the closing holiday
      ['2026-12-23', 26, 'Anna Muster', null, true, 'Weihnachten', null]
    ]);
    expect(plan.sessions[0]).toMatchObject({ title: 'Judo Technik', start: '19:00', end: null });
    expect(plan.holidays).toEqual([
      { title: 'Weihnachten', from: '2026-12-21', to: '2027-01-03', dojoClosed: true },
      { title: 'Winterferien', from: '2026-12-19', to: '2027-01-03', dojoClosed: false }
    ]);
  });

  it('shows school holidays the training takes place in', () => {
    const plan = buildApiTrainingPlan(
      { ...data, breaks: [data.breaks[1]] },
      { from: '2026-12-21', to: '2026-12-21', trainingIds: null }
    );
    expect(plan.sessions).toEqual([
      expect.objectContaining({ date: '2026-12-21', cancelled: false, holiday: 'Winterferien' })
    ]);
  });

  it('keeps only the asked trainings', () => {
    const plan = buildApiTrainingPlan(data, { ...query, trainingIds: [26, 99] });
    expect(plan.trainings.map((t) => t.id)).toEqual([26]);
    expect(new Set(plan.sessions.map((s) => s.trainingId))).toEqual(new Set([26]));
  });

  it('names nobody when the key shows no names', () => {
    const plan = buildApiTrainingPlan(
      {
        ...data,
        trainings: data.trainings.map((t) => ({ ...t, mainTrainerId: null })),
        sessions: data.sessions.map((s) => ({ ...s, trainer_id: null })),
        trainers: []
      },
      query
    );
    expect(plan.sessions.every((s) => s.trainer === null)).toBe(true);
  });

  it('never passes on more than the answer lists', () => {
    const plan = buildApiTrainingPlan(data, query);
    const text = JSON.stringify(plan);
    expect(text).not.toContain('mainTrainerId');
    expect(text).not.toContain('allowed_origins');
    expect(Object.keys(plan.sessions[0]).sort()).toEqual(
      [
        'cancelReason',
        'cancelled',
        'date',
        'end',
        'holiday',
        'start',
        'title',
        'topic',
        'trainer',
        'trainingId'
      ].sort()
    );
  });
});
