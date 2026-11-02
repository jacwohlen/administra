import { describe, expect, it } from 'vitest';
import {
  bearerKey,
  buildApiEventParticipants,
  buildApiEvents,
  buildApiTrainingPlan,
  normalizeOrigin,
  parseAttendedFilter,
  parseEventId,
  parseEventsQuery,
  parseOrigins,
  parseTrainingPlanQuery,
  scopesAllowOrigins,
  type ApiEventData,
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

describe('scopesAllowOrigins', () => {
  it('allows websites only without personal data', () => {
    expect(scopesAllowOrigins(['training_plan:read'])).toBe(true);
    expect(scopesAllowOrigins([])).toBe(true);
    expect(scopesAllowOrigins(['event_participants:read'])).toBe(false);
    expect(scopesAllowOrigins(['training_plan:read', 'event_participants:read'])).toBe(false);
  });
});

describe('parseEventsQuery', () => {
  const now = new Date('2026-11-02T23:30:00Z'); // already 3 November in Zurich

  it('defaults to 90 days back and 180 days in all', () => {
    expect(parseEventsQuery(new URLSearchParams(), now)).toEqual({
      ok: true,
      query: { from: '2026-08-05', to: '2027-01-31' }
    });
  });

  it('takes from and to', () => {
    expect(parseEventsQuery(new URLSearchParams('from=2026-10-01&to=2026-10-31'), now)).toEqual({
      ok: true,
      query: { from: '2026-10-01', to: '2026-10-31' }
    });
  });

  it.each(['from=2026-13-01', 'from=2026-10-02&to=2026-10-01', 'from=2026-01-01&to=2027-01-02'])(
    'refuses %s',
    (query) => {
      expect(parseEventsQuery(new URLSearchParams(query), now).ok).toBe(false);
    }
  );
});

describe('parseEventId and parseAttendedFilter', () => {
  it('reads an event id', () => {
    expect(parseEventId('42')).toBe(42);
    expect(parseEventId('10000001')).toBe(10000001);
  });

  it.each([undefined, '', '0', '-1', '1.5', 'abc', '2147483648', '12345678901'])(
    'refuses %s as event id',
    (value) => {
      expect(parseEventId(value)).toBeNull();
    }
  );

  it('reads attended', () => {
    expect(parseAttendedFilter(new URLSearchParams())).toEqual({ ok: true, attendedOnly: false });
    expect(parseAttendedFilter(new URLSearchParams('attended=false')).ok).toBe(true);
    expect(parseAttendedFilter(new URLSearchParams('attended=true'))).toEqual({
      ok: true,
      attendedOnly: true
    });
    expect(parseAttendedFilter(new URLSearchParams('attended=1')).ok).toBe(false);
  });
});

describe('buildApiEvents and buildApiEventParticipants', () => {
  const event: ApiEventData = {
    id: 10000005,
    title: 'Sommerlager',
    date: '2026-07-06',
    date_to: '2026-07-10',
    all_day: true,
    timeFrom: '09:00',
    timeTo: '17:00',
    location: ' Tenero ',
    section: '',
    registered: 3,
    attended: 2
  };

  it('shapes an event: last day, no times all day, empty text as null', () => {
    const answer = buildApiEvents(
      {
        allowed_origins: [],
        events: [
          event,
          { ...event, id: 7, date_to: null, all_day: false, timeFrom: '18.00', timeTo: null }
        ]
      },
      { from: '2026-07-01', to: '2026-07-31' }
    );
    expect(answer).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      timezone: 'Europe/Zurich',
      events: [
        {
          id: 10000005,
          title: 'Sommerlager',
          date: '2026-07-06',
          dateTo: '2026-07-10',
          allDay: true,
          start: null,
          end: null,
          location: 'Tenero',
          section: null,
          registered: 3,
          attended: 2
        },
        expect.objectContaining({ id: 7, dateTo: '2026-07-06', start: '18:00', end: null })
      ]
    });
    expect(JSON.stringify(answer)).not.toContain('allowed_origins');
  });

  const participants = [
    { id: 1, firstname: 'Anna', lastname: 'Muster', registered: true, attended: true, coach: true },
    {
      id: 2,
      firstname: 'Beni',
      lastname: 'Beispiel',
      registered: true,
      attended: false,
      coach: false
    },
    { id: 3, firstname: 'Clara', lastname: 'Neu', registered: false, attended: true, coach: false }
  ];

  it('lists every participant with their flags', () => {
    const answer = buildApiEventParticipants({ allowed_origins: [], event, participants }, false);
    expect(answer.event.id).toBe(10000005);
    expect(answer.participants).toEqual([
      {
        memberId: 1,
        firstname: 'Anna',
        lastname: 'Muster',
        registered: true,
        attended: true,
        coach: true
      },
      {
        memberId: 2,
        firstname: 'Beni',
        lastname: 'Beispiel',
        registered: true,
        attended: false,
        coach: false
      },
      {
        memberId: 3,
        firstname: 'Clara',
        lastname: 'Neu',
        registered: false,
        attended: true,
        coach: false
      }
    ]);
  });

  it('only who attended when asked', () => {
    const answer = buildApiEventParticipants({ allowed_origins: [], event, participants }, true);
    expect(answer.participants.map((p) => p.memberId)).toEqual([1, 3]);
  });
});
