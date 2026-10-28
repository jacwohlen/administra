import { describe, expect, it, vi } from 'vitest';
import {
  ID_RETRIES,
  addDays,
  buildEventInserts,
  comparisonSpan,
  daysBetween,
  eventDescription,
  eventProvider,
  formatDay,
  initialDefaultSection,
  initialInputs,
  insertEvents,
  isTime,
  isWeblingEvent,
  markSaved,
  matchSection,
  preselect,
  reviewEvents,
  spanCovers,
  summarizeEvents,
  titleSimilarity,
  titleWords,
  untickRecorded,
  withEventProviders,
  type ComparisonSet,
  type EventReviewContext,
  type EventRowInput,
  type EventWrite,
  type KnownEvent
} from './events';
import type { EventEntry, EventsProposal } from './types';

const SECTIONS = ['Judo', 'Aikido'];
const TODAY = '2026-10-25';

function entry(values: Partial<EventEntry>): EventEntry {
  return {
    title: '',
    date: '',
    dateTo: '',
    timeFrom: '',
    timeTo: '',
    location: '',
    section: '',
    description: '',
    confidence: 'high',
    remark: '',
    ...values
  };
}

// The club's Jahresprogramm as the model reads it from a flyer
const proposal: EventsProposal = {
  events: [
    entry({
      title: 'Kids Cup',
      date: '2026-11-14',
      timeFrom: '09:00',
      timeTo: '16:00',
      location: 'Sporthalle Junkholz, Wohlen',
      section: 'judo',
      description: 'Anmeldung bis 31.10. beim Trainer'
    }),
    entry({
      title: 'Herbstlager',
      date: '2026-11-14',
      dateTo: '2026-11-16',
      location: 'Tenero',
      section: 'Judo'
    }),
    entry({
      title: 'Aikido Lehrgang mit Sensei Tanaka',
      date: '2026-12-05',
      timeFrom: '10:00',
      timeTo: '12:30',
      section: 'Aikido'
    }),
    entry({
      title: 'Chlausabend',
      date: '2026-12-06',
      timeFrom: '18:00',
      section: 'Club',
      confidence: 'low',
      remark: 'Jahr unleserlich'
    }),
    entry({ title: 'Generalversammlung', date: '', section: '' })
  ],
  warnings: []
};

const known: KnownEvent[] = [
  {
    id: 4711,
    title: 'Judo Kids Cup 2026',
    date: '2026-11-14',
    timeFrom: '08:30',
    location: 'Wohlen',
    description: 'https://jacwohlen.webling.ch/portal#/calendar/event/4711'
  },
  { id: 12, title: 'Kyu-Prüfung', date: '2026-11-20', description: null },
  { id: 13, title: 'Weihnachtsessen', date: '2025-12-06', description: null }
];

const ctx = (values: Partial<EventReviewContext> = {}): EventReviewContext => ({
  known,
  sections: SECTIONS,
  defaultSection: '',
  today: TODAY,
  ...values
});

const until = (date: string) => `bis ${formatDay(date)}`;

function inputs(changes: Partial<EventRowInput>[] = []): EventRowInput[] {
  return initialInputs(proposal, SECTIONS).map((input, i) => ({ ...input, ...changes[i] }));
}

describe('titles', () => {
  it('keeps the words that tell events apart', () => {
    expect(titleWords('Judo Kids Cup 2026')).toEqual(['judo', 'kids', 'cup']);
    expect(titleWords('Kyu-Prüfung für die Jugend')).toEqual(['kyu', 'prufung', 'jugend']);
    expect(titleWords('1. Clubmeisterschaft')).toEqual(['clubmeisterschaft']);
  });

  it('finds the same event under a longer or shorter title', () => {
    expect(titleSimilarity('Kids Cup', 'Judo Kids Cup 2026')).toBe(1);
    expect(titleSimilarity('Clubmeisterschaft', 'JAC Clubmeisterschaft')).toBe(1);
    expect(titleSimilarity('Kyu Prüfung', 'Kyu-Pruefung')).toBe(1);
  });

  it('matches compounds, endings and a misread letter', () => {
    expect(titleSimilarity('Lager', 'Herbstlager Tenero')).toBe(1);
    expect(titleSimilarity('Schweizermeisterschaften', 'Schweizermeisterschaft')).toBe(1);
    expect(titleSimilarity('Generalversamlung', 'Generalversammlung')).toBe(1);
  });

  it('tells different events apart', () => {
    expect(titleSimilarity('Judo Training', 'Aikido Training')).toBe(0.5);
    expect(titleSimilarity('Chlausabend', 'Weihnachtsessen')).toBe(0);
    expect(titleSimilarity('2026', 'Kids Cup')).toBe(0);
    expect(titleSimilarity('', '')).toBe(0);
  });
});

describe('helpers', () => {
  it('counts days across months and years', () => {
    expect(daysBetween('2026-11-14', '2026-11-16')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('accepts times only as HH:MM', () => {
    expect(isTime('09:00')).toBe(true);
    expect(isTime('23:59')).toBe(true);
    expect(isTime('9:00')).toBe(false);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('18.30')).toBe(false);
    expect(isTime('')).toBe(false);
  });

  it('recognises events created by the Webling sync', () => {
    expect(isWeblingEvent('https://jacwohlen.webling.ch/portal#/calendar/event/4711')).toBe(true);
    expect(isWeblingEvent('Anmeldung über webling')).toBe(false);
    expect(isWeblingEvent(null)).toBe(false);
  });

  it('tells the provider of an event by its link, else by the Webling portal link', () => {
    const portal = 'https://jacwohlen.webling.ch/portal#/calendar/event/4711';
    expect(eventProvider({ description: portal })).toBe('webling');
    expect(eventProvider({ description: 'Mitbringen: Judogi' })).toBeNull();
    // Links loaded: the live link decides, a gone one makes it the app's
    expect(eventProvider({ description: null, provider: 'csv' })).toBe('csv');
    expect(eventProvider({ description: portal, provider: null })).toBeNull();
  });

  it('gives events the provider of their links', () => {
    const events: KnownEvent[] = [
      { id: 4711, title: 'Cup', date: '2026-11-14' },
      { id: '12', title: 'Kyu', date: '2026-11-20' },
      { id: 13, title: 'Essen', date: '2025-12-06' },
      { id: 14, title: 'Lager', date: '2026-07-06' }
    ];
    const result = withEventProviders(events, [
      { event_id: '4711', connection: 'webling', gone_at: null },
      { event_id: 12, connection: 'webling', gone_at: '2026-10-01T00:00:00Z' },
      // A gone link and a live one of another connection: the live one counts
      { event_id: 14, connection: 'webling', gone_at: '2026-10-01T00:00:00Z' },
      { event_id: 14, connection: 'csv', gone_at: null }
    ]);
    expect(result.map((e) => e.provider)).toEqual(['webling', null, undefined, 'csv']);
    // Without a link row the event is left as it was
    expect(result[2]).toBe(events[2]);
  });

  it('maps the section written to a club section', () => {
    expect(matchSection('judo', SECTIONS)).toBe('Judo');
    expect(matchSection(' AIKIDO ', SECTIONS)).toBe('Aikido');
    expect(matchSection('Club', SECTIONS)).toBe('');
    expect(matchSection('', SECTIONS)).toBe('');
  });

  it('preselects a default section only when the club has one', () => {
    expect(initialDefaultSection(SECTIONS)).toBe('');
    expect(initialDefaultSection(['Judo'])).toBe('Judo');
  });
});

describe('initial inputs', () => {
  it('takes the values read, with the section mapped', () => {
    const [cup, camp, , chlaus, gv] = initialInputs(proposal, SECTIONS);
    expect(cup).toEqual({
      title: 'Kids Cup',
      date: '2026-11-14',
      dateTo: '',
      timeFrom: '09:00',
      timeTo: '16:00',
      location: 'Sporthalle Junkholz, Wohlen',
      section: 'Judo',
      description: 'Anmeldung bis 31.10. beim Trainer',
      include: null,
      saved: false
    });
    expect(camp.dateTo).toBe('2026-11-16');
    expect(chlaus.section).toBe('');
    expect(gv.date).toBe('');
  });

  it('drops values that are not real dates or times', () => {
    const odd: EventsProposal = {
      events: [
        entry({
          title: 'Turnier',
          date: '2026-02-30',
          dateTo: '2026-03-01',
          timeFrom: '9:00',
          timeTo: '25:00'
        }),
        entry({ title: 'Lager', date: '2026-07-10', dateTo: '2026-07-01' })
      ],
      warnings: []
    };
    const [turnier, lager] = initialInputs(odd, SECTIONS);
    expect(turnier).toMatchObject({ date: '', dateTo: '', timeFrom: '', timeTo: '' });
    expect(lager.dateTo).toBe('');
  });
});

describe('review', () => {
  it('marks a date already synced from Webling as a duplicate, not created', () => {
    const [cup] = reviewEvents(proposal.events, inputs(), ctx());
    expect(cup.status).toBe('duplicate');
    expect(cup.selected).toBe(false);
    expect(cup.duplicate).toEqual({ kind: 'existing', event: known[0], provider: 'webling' });
    expect(cup.blocking).toBe(false);
  });

  it('finds a recorded event a day off', () => {
    const shifted = inputs([{}, {}, {}, {}, { date: '2026-11-21', title: 'Kyu Prüfung' }]);
    const gv = reviewEvents(proposal.events, shifted, ctx())[4];
    expect(gv.duplicate).toEqual({ kind: 'existing', event: known[1], provider: null });
    const twoDays = inputs([{}, {}, {}, {}, { date: '2026-11-22', title: 'Kyu Prüfung' }]);
    expect(reviewEvents(proposal.events, twoDays, ctx())[4].duplicate).toBeNull();
  });

  it('does not take another event on the same day for a duplicate', () => {
    const camp = reviewEvents(proposal.events, inputs(), ctx())[1];
    expect(camp.duplicate).toBeNull();
    expect(camp.status).toBe('new');
    expect(camp.selected).toBe(true);
  });

  it('marks a date read twice', () => {
    const twice: EventsProposal = {
      events: [
        entry({ title: 'Herbstlager', date: '2026-11-14', section: 'Judo' }),
        entry({ title: 'Herbstlager Tenero', date: '2026-11-14', section: 'Judo' })
      ],
      warnings: []
    };
    const rows = reviewEvents(twice.events, initialInputs(twice, SECTIONS), ctx());
    expect(rows[0].status).toBe('new');
    expect(rows[1]).toMatchObject({
      status: 'duplicate',
      duplicate: { kind: 'row', index: 0 },
      selected: false
    });
  });

  it('creates a duplicate the user ticks', () => {
    const [cup] = reviewEvents(proposal.events, inputs([{ include: true }]), ctx());
    expect(cup.status).toBe('duplicate');
    expect(cup.selected).toBe(true);
    expect(cup.blocking).toBe(false);
  });

  it('keeps the first selection while a row is edited', () => {
    const start = inputs();
    const fixed = preselect(start, reviewEvents(proposal.events, start, ctx()));
    expect(fixed.map((input) => input.include)).toEqual([false, true, true, true, true]);
    // The Herbstlager retitled to the recorded Kids Cup stays ticked and shows the duplicate
    fixed[1] = { ...fixed[1], title: 'Kids Cup', dateTo: '' };
    const camp = reviewEvents(proposal.events, fixed, ctx())[1];
    expect(camp).toMatchObject({ status: 'duplicate', selected: true, blocking: false });
    expect(camp.duplicate).toMatchObject({ kind: 'existing', event: { id: 4711 } });
    // A choice the user already made is kept
    const chosen = inputs([{ include: true }, { include: false }]);
    const kept = preselect(chosen, reviewEvents(proposal.events, chosen, ctx()));
    expect(kept.slice(0, 2).map((input) => input.include)).toEqual([true, false]);
  });

  it('asks for a section the club does not have', () => {
    const chlaus = reviewEvents(proposal.events, inputs(), ctx())[3];
    expect(chlaus.status).toBe('invalid');
    expect(chlaus.errors).toEqual([{ code: 'unknownSection', written: 'Club' }]);
    expect(chlaus.blocking).toBe(true);
    expect(chlaus.entry.confidence).toBe('low');
  });

  it('asks for a section once the user clears a mapped one', () => {
    const cleared = inputs([{ section: '' }]);
    expect(reviewEvents(proposal.events, cleared, ctx())[0].errors).toEqual([
      { code: 'noSection' }
    ]);
  });

  it('uses the default section for rows without one', () => {
    const rows = reviewEvents(proposal.events, inputs(), ctx({ defaultSection: 'Judo' }));
    expect(rows[3]).toMatchObject({ section: 'Judo', status: 'new', errors: [] });
    // A row's own section wins
    expect(rows[2].section).toBe('Aikido');
    // A default the club does not have is ignored
    const odd = reviewEvents(proposal.events, inputs(), ctx({ defaultSection: 'Club' }));
    expect(odd[3].section).toBe('');
  });

  it('needs title, date and section', () => {
    const gv = reviewEvents(proposal.events, inputs(), ctx())[4];
    expect(gv.status).toBe('invalid');
    expect(gv.errors.map((e) => e.code)).toEqual(['noDate', 'noSection']);
    const blank = inputs([{}, {}, {}, {}, { title: '  ', date: '2026-13-01', section: 'Judo' }]);
    expect(reviewEvents(proposal.events, blank, ctx())[4].errors.map((e) => e.code)).toEqual([
      'noTitle',
      'badDate'
    ]);
  });

  it('checks times and the last day', () => {
    const wrong = inputs([
      {},
      { dateTo: '2026-11-14' },
      {},
      { section: 'Judo', timeFrom: '18', timeTo: '7:5' }
    ]);
    const rows = reviewEvents(proposal.events, wrong, ctx());
    expect(rows[1].errors).toEqual([{ code: 'badDateTo' }]);
    expect(rows[3].errors.map((e) => e.code)).toEqual(['badTimeFrom', 'badTimeTo']);
  });

  it('only asks whether a one-day event ends after midnight', () => {
    const night = inputs([
      {},
      // Sommerlager: Friday 18:00 to Sunday 14:00
      { timeFrom: '18:00', timeTo: '14:00' },
      // Silvester 20:00–01:00
      { title: 'Silvesterparty', date: '2026-12-31', timeFrom: '20:00', timeTo: '01:00' },
      { section: 'Judo', timeFrom: '18:00', timeTo: '18:00' }
    ]);
    const rows = reviewEvents(proposal.events, night, ctx());
    expect(rows[1]).toMatchObject({ status: 'new', errors: [], warnings: [], blocking: false });
    expect(rows[2]).toMatchObject({
      status: 'new',
      errors: [],
      warnings: [{ code: 'timeOrder' }],
      blocking: false
    });
    expect(rows[3].warnings).toEqual([{ code: 'timeOrder' }]);
    // Saved with both times as read
    const writes = buildEventInserts(rows, SECTIONS, until);
    expect(writes.find((w) => w.row === 2)?.values).toMatchObject({
      title: 'Silvesterparty',
      date: '2026-12-31',
      timeFrom: '20:00',
      timeTo: '01:00'
    });
    expect(writes.find((w) => w.row === 1)?.values).toMatchObject({
      timeFrom: '18:00',
      timeTo: '14:00',
      description: 'bis 16.11.2026'
    });
  });

  it('warns about past dates and far-off years without blocking', () => {
    const dates = inputs([{}, {}, { date: '2026-03-14' }, { section: 'Judo', date: '2062-12-06' }]);
    const rows = reviewEvents(proposal.events, dates, ctx());
    expect(rows[2]).toMatchObject({ status: 'new', warnings: [{ code: 'past' }], blocking: false });
    expect(rows[3]).toMatchObject({ status: 'new', warnings: [{ code: 'farFuture' }] });
  });

  it('lets the user leave out a row that cannot be fixed', () => {
    const rows = reviewEvents(
      proposal.events,
      inputs([{}, {}, {}, { include: false }, { include: false }]),
      ctx()
    );
    expect(summarizeEvents(rows)).toEqual({
      inserts: 2,
      blocking: 0,
      byStatus: { new: 2, duplicate: 1, invalid: 2, saved: 0 }
    });
  });

  it('counts blocking rows', () => {
    const summary = summarizeEvents(reviewEvents(proposal.events, inputs(), ctx()));
    expect(summary).toEqual({
      inserts: 2,
      blocking: 2,
      byStatus: { new: 2, duplicate: 1, invalid: 2, saved: 0 }
    });
  });
});

describe('writes', () => {
  it('puts the last day of a multi-day event into the description', () => {
    expect(
      eventDescription({ date: '2026-11-14', dateTo: '2026-11-16', description: '' }, until)
    ).toBe('bis 16.11.2026');
    expect(
      eventDescription(
        { date: '2026-11-14', dateTo: '2026-11-16', description: 'Mit Übernachtung' },
        until
      )
    ).toBe('bis 16.11.2026\nMit Übernachtung');
    // Typed in already
    expect(
      eventDescription(
        { date: '2026-11-14', dateTo: '2026-11-16', description: 'bis 16.11.2026, Tenero' },
        until
      )
    ).toBe('bis 16.11.2026, Tenero');
    expect(
      eventDescription({ date: '2026-11-14', dateTo: '', description: ' Halle 2 ' }, until)
    ).toBe('Halle 2');
  });

  it('builds exactly the columns of the event form', () => {
    const edited = inputs([
      {},
      { description: 'Mit Übernachtung' },
      { location: '  Dojo Wohlen ' },
      { section: 'Judo', include: false },
      { include: false }
    ]);
    const rows = reviewEvents(proposal.events, edited, ctx());
    const writes = buildEventInserts(rows, SECTIONS, until);
    expect(writes.map((w) => w.row)).toEqual([1, 2]);
    expect(writes.map((w) => w.values)).toEqual([
      {
        title: 'Herbstlager',
        description: 'bis 16.11.2026\nMit Übernachtung',
        date: '2026-11-14',
        timeFrom: null,
        timeTo: null,
        location: 'Tenero',
        section: 'Judo',
        maxParticipants: null,
        registrationDeadline: null
      },
      {
        title: 'Aikido Lehrgang mit Sensei Tanaka',
        description: null,
        date: '2026-12-05',
        timeFrom: '10:00',
        timeTo: '12:30',
        location: 'Dojo Wohlen',
        section: 'Aikido',
        maxParticipants: null,
        registrationDeadline: null
      }
    ]);
  });

  it('writes a ticked duplicate and the default section', () => {
    const rows = reviewEvents(
      proposal.events,
      inputs([{ include: true }, { include: false }, { include: false }, {}, { include: false }]),
      ctx({ defaultSection: 'Judo' })
    );
    const inserts = buildEventInserts(rows, SECTIONS, until).map((w) => w.values);
    expect(inserts.map((r) => [r.title, r.section])).toEqual([
      ['Kids Cup', 'Judo'],
      ['Chlausabend', 'Judo']
    ]);
    expect(inserts[0].description).toBe('Anmeldung bis 31.10. beim Trainer');
  });

  it('never writes a row with errors, even when its flags say otherwise', () => {
    const rows = reviewEvents(proposal.events, inputs(), ctx());
    const forged = rows.map((row) => ({ ...row, selected: true, errors: [] }));
    const titles = buildEventInserts(forged, SECTIONS, until).map((w) => w.values.title);
    // Chlausabend has no club section, the Generalversammlung no date
    expect(titles).toEqual(['Kids Cup', 'Herbstlager', 'Aikido Lehrgang mit Sensei Tanaka']);
    // A section that is no longer the club's
    const aikido = rows.map((row) => ({ ...row, selected: true }));
    expect(buildEventInserts(aikido, ['Judo'], until).map((w) => w.values.title)).not.toContain(
      'Aikido Lehrgang mit Sensei Tanaka'
    );
    // A row saved before, whatever its flags say
    const saved = reviewEvents(proposal.events, markSaved(inputs(), [1]), ctx());
    const again = saved.map((row) => ({ ...row, selected: true }));
    expect(buildEventInserts(again, SECTIONS, until).map((w) => w.row)).not.toContain(1);
  });
});

describe('events to compare with', () => {
  it('spans every date read, a day wider on both ends', () => {
    expect(comparisonSpan(inputs())).toEqual({ from: '2026-11-13', to: '2026-12-07' });
    expect(comparisonSpan([{ date: '2027-01-01' }, { date: '' }, { date: '2026-12-31' }])).toEqual({
      from: '2026-12-30',
      to: '2027-01-02'
    });
    // An edited date widens it
    expect(comparisonSpan(inputs([{}, {}, {}, {}, { date: '2027-03-14' }]))?.to).toBe('2027-03-15');
    expect(comparisonSpan([{ date: '' }, { date: '2026-02-30' }])).toBeNull();
  });

  it('tells whether the loaded events cover what the review needs', () => {
    const loaded = { from: '2026-11-13', to: '2026-12-07' };
    expect(spanCovers(loaded, { from: '2026-11-13', to: '2026-12-07' })).toBe(true);
    expect(spanCovers(loaded, { from: '2026-11-20', to: '2026-11-22' })).toBe(true);
    expect(spanCovers(loaded, { from: '2026-11-13', to: '2026-12-08' })).toBe(false);
    expect(spanCovers(loaded, { from: '2026-11-12', to: '2026-12-07' })).toBe(false);
    expect(spanCovers(null, { from: '2026-11-13', to: '2026-12-07' })).toBe(false);
    // Nothing to compare: nothing to load
    expect(spanCovers(null, null)).toBe(true);
  });
});

describe('after a partial save', () => {
  // The events compared with before the apply, for the days of the rows read
  const loadedFor = (events: KnownEvent[]): ComparisonSet => ({
    span: { from: '2026-11-13', to: '2026-12-07' },
    events
  });

  it('shows saved rows as saved and never writes them again', () => {
    const start = preselect(inputs(), reviewEvents(proposal.events, inputs(), ctx()));
    const after = markSaved(start, [1, 2]);
    expect(after.map((input) => input.saved)).toEqual([false, true, true, false, false]);
    // The reloaded events now hold the Herbstlager: it is not its own duplicate
    const reloaded: KnownEvent[] = [
      ...known,
      { id: 9001, title: 'Herbstlager', date: '2026-11-14', description: 'bis 16.11.2026' }
    ];
    const rows = reviewEvents(proposal.events, after, ctx({ known: reloaded }));
    expect(rows[1]).toMatchObject({
      status: 'saved',
      selected: false,
      duplicate: null,
      errors: [],
      blocking: false
    });
    expect(summarizeEvents(rows)).toMatchObject({
      inserts: 0,
      byStatus: { new: 0, duplicate: 1, invalid: 2, saved: 2 }
    });
    expect(buildEventInserts(rows, SECTIONS, until)).toEqual([]);
  });

  it('unticks a failed row that was recorded after all', () => {
    const start = preselect(inputs(), reviewEvents(proposal.events, inputs(), ctx()));
    // Herbstlager saved (id 9001), the Aikido Lehrgang reported an error but went through
    // (id 9002), the Chlausabend failed
    const saved = markSaved(start, [1]);
    const reloaded: KnownEvent[] = [
      ...known,
      { id: 9001, title: 'Herbstlager', date: '2026-11-14' },
      { id: 9002, title: 'Aikido Lehrgang mit Sensei Tanaka', date: '2026-12-05' }
    ];
    const { inputs: next, recorded } = untickRecorded(
      saved,
      [2, 3],
      loadedFor(known),
      reloaded,
      [9001]
    );
    expect(recorded).toEqual([2]);
    expect(next[2].include).toBe(false);
    expect(next[3].include).toBe(true);
    const rows = reviewEvents(proposal.events, next, ctx({ known: reloaded }));
    expect(rows[2]).toMatchObject({ status: 'duplicate', selected: false });
    expect(rows[2].duplicate).toMatchObject({ kind: 'existing', event: { id: 9002 } });
  });

  it('keeps the choice of a failed row whose only match was there before', () => {
    // The Kids Cup was ticked although Webling has it; its insert failed
    const start = inputs([{ include: true }]);
    const { inputs: next, recorded } = untickRecorded(start, [0], loadedFor(known), known);
    expect(recorded).toEqual([]);
    expect(next[0].include).toBe(true);
    // Created for another row of this apply: not a sign that this one went through
    const twice = [
      { ...start[1], include: true, saved: true },
      { ...start[1], title: 'Herbstlager Tenero', include: true }
    ];
    const created: KnownEvent = { id: 9001, title: 'Herbstlager', date: '2026-11-14' };
    expect(
      untickRecorded(twice, [1], loadedFor(known), [...known, created], [9001]).recorded
    ).toEqual([]);
    expect(untickRecorded(twice, [1], loadedFor(known), [...known, created]).recorded).toEqual([1]);
  });

  it('lets one new event account for one failed row only', () => {
    // Both inserts reported an error; only the Saturday one went through
    const rows = inputs([
      { title: 'Kids Cup', date: '2027-03-13', include: true },
      { title: 'Kids Cup Finale', date: '2027-03-14', include: true }
    ]).slice(0, 2);
    const committed: KnownEvent = { id: 500, title: 'Kids Cup', date: '2027-03-13' };
    const span = { span: { from: '2027-03-12', to: '2027-03-15' }, events: [] };
    const result = untickRecorded(rows, [0, 1], span, [committed]);
    expect(result.recorded).toEqual([0]);
    expect(result.inputs[1].include).toBe(true);
  });

  it('only counts events on the days compared before', () => {
    // The reload after the apply failed, then the Chlausabend was moved a year on: the old
    // Chlausabend there was not new, only not loaded before
    const start = preselect(inputs(), reviewEvents(proposal.events, inputs(), ctx()));
    const moved = start.map((input, i) => (i === 3 ? { ...input, date: '2027-12-06' } : input));
    const old: KnownEvent = { id: 77, title: 'Chlausabend', date: '2027-12-06' };
    const result = untickRecorded(moved, [3], loadedFor(known), [...known, old]);
    expect(result.recorded).toEqual([]);
    expect(result.inputs[3].include).toBe(moved[3].include);
    // On the days compared before, the same event is new: the insert went through after all
    const fresh = { ...old, date: '2026-12-06' };
    expect(untickRecorded(start, [3], loadedFor(known), [...known, fresh]).recorded).toEqual([3]);
  });
});

describe('saving', () => {
  let rowIndex = 0;
  const row = (title: string): EventWrite => ({
    row: rowIndex++,
    values: {
      title,
      description: null,
      date: '2026-11-14',
      timeFrom: null,
      timeTo: null,
      location: null,
      section: 'Judo',
      maxParticipants: null,
      registrationDeadline: null
    }
  });

  it('creates the events one by one and reports failures per row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let id = 9000;
    const insert = vi.fn(async (values: EventWrite['values']) =>
      values.title === 'Lager'
        ? { data: null, error: { code: '42501', message: 'row-level security' } }
        : { data: { id: ++id }, error: null }
    );
    const progress: number[] = [];
    const writes = [row('Kids Cup'), row('Lager'), row('Chlausabend')];
    const outcome = await insertEvents(writes, insert, (done) => progress.push(done));
    expect(outcome.saved.map((w) => w.values.title)).toEqual(['Kids Cup', 'Chlausabend']);
    expect(outcome.failed).toEqual([writes[1]]);
    expect(outcome.created).toEqual([9001, 9002]);
    expect(progress).toEqual([1, 2, 3]);
    expect(insert).toHaveBeenCalledTimes(3);
    // Only the columns go to the database, not the row index
    expect(insert.mock.calls[0][0]).toBe(writes[0].values);
  });

  it('tries again when the next id is taken', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505', message: 'events_pkey' } })
      .mockResolvedValueOnce({ error: { code: '23505', message: 'events_pkey' } })
      .mockResolvedValue({ error: null });
    const outcome = await insertEvents([row('Kids Cup')], insert);
    expect(outcome.saved).toHaveLength(1);
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it('does not retry other unique violations', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "x_key"' }
    });
    expect((await insertEvents([row('Kids Cup')], insert)).failed).toHaveLength(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few taken ids and on a thrown error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const taken = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'events_pkey' } });
    expect((await insertEvents([row('Kids Cup')], taken)).failed).toHaveLength(1);
    expect(taken).toHaveBeenCalledTimes(ID_RETRIES + 1);
    const offline = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    expect((await insertEvents([row('Kids Cup')], offline)).failed).toHaveLength(1);
  });
});
