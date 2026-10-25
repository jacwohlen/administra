import { describe, expect, it } from 'vitest';
import type { TrainerRole } from '$lib/models';
import {
  adoptMember,
  cancelledDates,
  checkInKey,
  chooseEntry,
  confirmRosterSuggestions,
  createDraft,
  createdAnyway,
  dateIssue,
  dateIssues,
  fetchAllRows,
  filterMembers,
  isRosterSuggestionOpen,
  labelList,
  memberHint,
  nameTwins,
  needsConfirmation,
  newMemberNames,
  openFailures,
  personRows,
  reviewDraft,
  skipOpen,
  sortMembers,
  splitName,
  weekdayOf,
  withDate,
  writtenWeekdays,
  type AttendanceDraft,
  type AttendanceMember,
  type ReviewContext,
  type SaveFailure
} from './attendance';
import { clubToday } from './proposals';
import type { AttendanceEntry, AttendanceProposal } from './types';

// "Judo Kinder" on Mondays; the review runs on Sunday, 25 October 2026
const TODAY = '2026-10-25';
const WEEKDAY = 'Monday';

const members: AttendanceMember[] = [
  { id: 1, firstname: 'Lena', lastname: 'Müller', labels: ['Aktiv'] },
  { id: 2, firstname: 'Lukas', lastname: 'Müller', labels: ['Aktiv'] },
  { id: 3, firstname: 'Benjamin', lastname: 'Keller', labels: ['Aktiv', 'Kindertrainer'] },
  { id: 4, firstname: 'Anna-Lena', lastname: 'Muster', labels: ['Aktiv'] },
  { id: 5, firstname: 'Noah', lastname: 'Schmid', labels: ['03_Austritt'] },
  { id: 6, firstname: 'Mia', lastname: 'Meier', labels: ['probetraining'] },
  { id: 7, firstname: 'Elias', lastname: 'Brunner', labels: [] }
];
const memberMap = new Map(members.map((m) => [m.id, m]));
// On the training's roster: everyone but Noah and Elias
const roster = new Set([1, 2, 3, 4, 6]);

function entry(name: string, extra: Partial<AttendanceEntry> = {}): AttendanceEntry {
  return { name, role: 'attendee', dates: [], confidence: 'high', remark: '', ...extra };
}

function proposal(entries: AttendanceEntry[], dates: string[] = []): AttendanceProposal {
  const all = new Set([...dates, ...entries.flatMap((e) => e.dates)]);
  return { trainingAsWritten: 'Judo Kinder Montag', dates: [...all].sort(), entries, warnings: [] };
}

function draftOf(p: AttendanceProposal, pageDate = '2026-10-19'): AttendanceDraft {
  return createDraft(p, { members, roster, pageDate, today: TODAY, weekday: WEEKDAY });
}

function context(existing: [string, number, TrainerRole][] = []): ReviewContext {
  return {
    members: memberMap,
    roster,
    existing: new Map(existing.map(([date, id, role]) => [checkInKey(date, id), role])),
    cancelled: new Set(),
    today: TODAY,
    weekday: WEEKDAY
  };
}

describe('dates', () => {
  it('knows the weekday and today in Zurich', () => {
    expect(weekdayOf('2026-10-19')).toBe('Monday');
    expect(weekdayOf('2026-10-25')).toBe('Sunday');
    // 00:30 in Zurich is still the evening before in UTC
    expect(clubToday(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
  });

  it('rejects impossible and future dates and flags another weekday', () => {
    expect(dateIssue('2026-10-19', TODAY, WEEKDAY)).toBeNull();
    expect(dateIssue('2026-02-31', TODAY, WEEKDAY)).toBe('invalid');
    expect(dateIssue('19.10.2026', TODAY, WEEKDAY)).toBe('invalid');
    expect(dateIssue('2026-10-26', TODAY, WEEKDAY)).toBe('future');
    expect(dateIssue('2026-10-20', TODAY, WEEKDAY)).toBe('weekday');
    // No weekday stored for the training: nothing to compare
    expect(dateIssue('2026-10-20', TODAY, null)).toBeNull();
  });

  it('marks a date that occurs twice, and takes a corrected date again', () => {
    const dates = [withDate('2026-10-12', TODAY, WEEKDAY), withDate('2026-10-12', TODAY, WEEKDAY)];
    expect(dateIssues(dates, TODAY, WEEKDAY)).toEqual([null, 'duplicate']);
    expect(withDate('2026-10-13', TODAY, WEEKDAY)).toEqual({ date: '2026-10-13', include: false });
    expect(withDate('2026-10-05', TODAY, WEEKDAY)).toEqual({ date: '2026-10-05', include: true });
  });
});

describe('createDraft', () => {
  it('matches clear names and leaves the rest to the user', () => {
    const draft = draftOf(
      proposal([
        entry('Müller Lena'),
        entry('Beni Keller', { role: 'main_trainer' }),
        entry('L. Müller', { confidence: 'low', remark: 'Vorname unleserlich' }),
        entry('Zoe Unbekannt')
      ])
    );
    expect(draft.grid).toBe(false);
    expect(draft.dates).toEqual([{ date: '2026-10-19', include: true }]);
    const [lena, beni, initial, unknown] = draft.entries;
    expect(lena).toMatchObject({
      action: 'member',
      memberId: 1,
      unconfirmed: false,
      marks: [true]
    });
    expect(beni).toMatchObject({ action: 'member', memberId: 3, role: 'main_trainer' });
    // Lena or Lukas: the likelier one preselected, to be confirmed
    expect(initial).toMatchObject({
      action: 'member',
      unconfirmed: true,
      remark: 'Vorname unleserlich'
    });
    expect(initial.candidates.slice(0, 2).sort()).toEqual([1, 2]);
    expect(unknown).toMatchObject({
      action: 'open',
      memberId: null,
      lastname: 'Zoe',
      firstname: 'Unbekannt'
    });
  });

  it('asks to confirm a clear match the model was unsure about or that is unusual', () => {
    const draft = draftOf(
      proposal([
        entry('Lena Müller', { confidence: 'low', remark: 'Häkchen kaum lesbar' }),
        entry('Lukas Müller', { confidence: 'medium' }),
        entry('Noah Schmid'),
        entry('Mia Meier')
      ])
    );
    expect(draft.entries.map((e) => [e.memberId, e.unconfirmed])).toEqual([
      // Low confidence: the reading may be wrong
      [1, true],
      [2, false],
      // Left the club and not on the roster
      [5, true],
      // Trial candidate already on the roster
      [6, false]
    ]);
    expect(needsConfirmation({ id: 6, labels: ['Probetraining'] }, new Set())).toBe(true);
    expect(needsConfirmation({ id: 5, labels: ['03_Austritt'] }, new Set([5]))).toBe(false);
    expect(needsConfirmation({ id: 7, labels: ['Passiv'] }, new Set())).toBe(false);
  });

  it('takes the date written on a single list when it fits the training', () => {
    const written = draftOf(proposal([entry('Müller Lena')], ['2026-10-12']));
    expect(written.dates).toEqual([{ date: '2026-10-12', include: true }]);
    // A Tuesday on a Monday list: the page's date, the list's is pointed out
    const wrongDay = draftOf(proposal([entry('Müller Lena')], ['2026-10-13']));
    expect(wrongDay.dates).toEqual([{ date: '2026-10-19', include: true }]);
    expect(wrongDay.listDates).toEqual(['2026-10-13']);
  });

  it('reads a grid with marks per date and leaves dates on another weekday out', () => {
    const draft = draftOf(
      proposal([
        entry('Lena Müller', { dates: ['2026-10-05', '2026-10-19'] }),
        entry('Anna-Lena Muster', { dates: ['2026-10-05', '2026-10-06', '2026-10-12'] })
      ])
    );
    expect(draft.grid).toBe(true);
    expect(draft.dates).toEqual([
      { date: '2026-10-05', include: true },
      { date: '2026-10-06', include: false },
      { date: '2026-10-12', include: true },
      { date: '2026-10-19', include: true }
    ]);
    expect(draft.entries.map((e) => e.marks)).toEqual([
      [true, false, false, true],
      [true, true, true, false]
    ]);
  });

  it('preselects the roster member of two with the same name, to be confirmed', () => {
    // A check-in-created 'new' record and the later Webling record of one kid
    const hans = [
      { id: 50, firstname: 'Hans', lastname: 'Muster', labels: ['Aktiv'] },
      { id: 90, firstname: 'Hans', lastname: 'Muster', labels: ['new'] }
    ];
    for (const order of [hans, [...hans].reverse()]) {
      const draft = createDraft(proposal([entry('Muster Hans')]), {
        members: [...members, ...order],
        roster: new Set([...roster, 90]),
        pageDate: '2026-10-19',
        today: TODAY,
        weekday: WEEKDAY
      });
      expect(draft.entries[0]).toMatchObject({ action: 'member', memberId: 90, unconfirmed: true });
      expect(draft.entries[0].candidates.slice(0, 2)).toEqual([90, 50]);
    }
  });

  it('only suggests a look-alike last name, and never as a roster suggestion', () => {
    const club = [...members, { id: 8, firstname: 'Lena', lastname: 'Hugentobler', labels: [] }];
    const draft = createDraft(proposal([entry('Lena Hug'), entry('Lena')]), {
      members: club,
      roster: new Set([8]),
      pageDate: '2026-10-19',
      today: TODAY,
      weekday: WEEKDAY
    });
    // Hug is not Hugentobler: to be confirmed one by one
    expect(draft.entries[0]).toMatchObject({
      memberId: 8,
      unconfirmed: true,
      rosterSuggestion: false
    });
    // Only a first name on a kids' list, one Lena on the roster
    expect(draft.entries[1]).toMatchObject({
      memberId: 8,
      unconfirmed: true,
      rosterSuggestion: true
    });
  });

  it('confirms the roster suggestions at once, but not unsure or ambiguous ones', () => {
    const draft = draftOf(
      proposal([
        entry('Mia'),
        entry('Elias'),
        entry('L. Müller'),
        entry('Benjamin', { confidence: 'low' }),
        entry('Lena Müller')
      ])
    );
    expect(draft.entries.map((e) => [e.memberId, e.unconfirmed, e.rosterSuggestion])).toEqual([
      // Mia Meier is on the roster
      [6, true, true],
      // Elias Brunner is not
      [7, true, false],
      // Lena or Lukas, both on the roster
      [1, true, false],
      [3, true, false],
      [1, false, false]
    ]);
    expect(draft.entries.map(isRosterSuggestionOpen)).toEqual([true, false, false, false, false]);
    expect(confirmRosterSuggestions(draft.entries)).toEqual([0]);
    expect(draft.entries.map((e) => e.unconfirmed)).toEqual([false, true, true, true, false]);
    expect(confirmRosterSuggestions(draft.entries)).toEqual([]);
  });

  it('splits names like the check-in page', () => {
    expect(splitName('Muster Anna-Lena')).toEqual(['Muster', 'Anna-Lena']);
    expect(splitName('Muster, Anna Lena')).toEqual(['Muster', 'Anna Lena']);
    expect(splitName('Lena')).toEqual(['Lena', '']);
    expect(splitName('Anna Lena Graf', false)).toEqual(['Graf', 'Anna Lena']);
  });

  it('prefills a new member in the order the list writes names', () => {
    const firstNamesFirst = draftOf(
      proposal([entry('Lena Müller'), entry('Benjamin Keller'), entry('Zoe Graf')])
    );
    expect(firstNamesFirst.entries[2]).toMatchObject({ lastname: 'Graf', firstname: 'Zoe' });
    const lastNamesFirst = draftOf(
      proposal([entry('Müller Lena'), entry('Keller Benjamin'), entry('Graf Zoe')])
    );
    expect(lastNamesFirst.entries[2]).toMatchObject({ lastname: 'Graf', firstname: 'Zoe' });
    // Nothing to go by: the check-in page's order
    expect(draftOf(proposal([entry('Graf Zoe')])).entries[0]).toMatchObject({
      lastname: 'Graf',
      firstname: 'Zoe'
    });
  });
});

describe('reviewDraft', () => {
  it('writes new check-ins only, keeps recorded ones and puts people on the roster', () => {
    const draft = draftOf(
      proposal([entry('Lena Müller'), entry('Lukas Müller'), entry('Elias Brunner')])
    );
    const review = reviewDraft(
      draft,
      context([
        ['2026-10-19', 2, 'attendee'],
        ['2026-10-12', 1, 'attendee']
      ])
    );
    expect(review.entries.map((e) => e.status)).toEqual(['new', 'exists', 'new']);
    expect(review.entries.map((e) => e.addsToRoster)).toEqual([false, false, true]);
    expect(review.open).toBe(0);
    expect(review.checkIns).toBe(2);
    expect(review.rosterAdds).toBe(1);
    expect(review.plan).toEqual([
      {
        entry: 0,
        memberId: 1,
        create: null,
        addToRoster: false,
        checkIns: [{ date: '2026-10-19', role: 'attendee' }]
      },
      {
        entry: 2,
        memberId: 7,
        create: null,
        addToRoster: true,
        checkIns: [{ date: '2026-10-19', role: 'attendee' }]
      }
    ]);
  });

  it('changes the role of a recorded check-in only when asked to', () => {
    const draft = draftOf(proposal([entry('Benjamin Keller', { role: 'main_trainer' })]));
    const ctx = context([['2026-10-19', 3, 'attendee']]);
    const review = reviewDraft(draft, ctx);
    expect(review.entries[0]).toMatchObject({
      status: 'changed',
      cells: ['changed'],
      existingRoles: ['attendee']
    });
    expect(review.checkIns).toBe(0);

    draft.entries[0].overwrite = true;
    expect(reviewDraft(draft, ctx).plan[0].checkIns).toEqual([
      { date: '2026-10-19', role: 'main_trainer' }
    ]);
  });

  it('says before the confirmation that a suggestion off the roster is added to it', () => {
    const draft = draftOf(proposal([entry('Elias'), entry('Mia')]));
    const review = reviewDraft(draft, context());
    expect(review.entries.map((e) => [e.problem, e.addsToRoster])).toEqual([
      ['confirm', true],
      ['confirm', false]
    ]);
    // Nothing is written or counted until it is confirmed
    expect(review.rosterAdds).toBe(0);
    // Recorded already: confirming would not touch the roster
    const recorded = reviewDraft(draft, context([['2026-10-19', 7, 'attendee']]));
    expect(recorded.entries[0].addsToRoster).toBe(false);
  });

  it('withdraws the overwrite tick and the confirmation when another member is chosen', () => {
    const draft = draftOf(proposal([entry('Benjamin Keller', { role: 'main_trainer' })]));
    const ctx = context([
      ['2026-10-19', 3, 'attendee'],
      ['2026-10-19', 7, 'assistant']
    ]);
    const [row] = draft.entries;
    row.overwrite = true;
    expect(reviewDraft(draft, ctx).plan[0].checkIns).toHaveLength(1);

    chooseEntry(row, 'm:7', (id) => memberMap.has(id));
    expect(row).toMatchObject({ action: 'member', memberId: 7, overwrite: false });
    const review = reviewDraft(draft, ctx);
    expect(review.entries[0]).toMatchObject({ status: 'changed', existingRoles: ['assistant'] });
    expect(review.plan).toEqual([]);

    chooseEntry(row, 'skip', (id) => memberMap.has(id));
    expect(row).toMatchObject({ action: 'skip', memberId: null });
    chooseEntry(row, 'm:99', (id) => memberMap.has(id));
    expect(row.action).toBe('open');
  });

  it('holds everything back while a row needs a decision', () => {
    const draft = draftOf(
      proposal([entry('Lena Müller'), entry('L. Müller'), entry('Zoe Unbekannt')])
    );
    let review = reviewDraft(draft, context());
    expect(review.entries.map((e) => e.problem)).toEqual([null, 'confirm', 'pick']);
    expect(review.entries[1].cells).toEqual(['pending']);
    expect(review.open).toBe(2);

    draft.entries[1].unconfirmed = false;
    draft.entries[1].memberId = 2;
    skipOpen(draft.entries);
    review = reviewDraft(draft, context());
    expect(review.open).toBe(0);
    expect(review.entries.map((e) => e.status)).toEqual(['new', 'new', 'skipped']);
    expect(review.plan.map((p) => p.memberId)).toEqual([1, 2]);
  });

  it('creates a new member only with both names, and puts them on the roster', () => {
    const draft = draftOf(proposal([entry('Zoe')]));
    draft.entries[0].action = 'create';
    let review = reviewDraft(draft, context());
    expect(review.entries[0]).toMatchObject({ status: 'invalid', problem: 'name' });
    expect(review.plan).toEqual([]);

    draft.entries[0].lastname = '  Graf ';
    draft.entries[0].firstname = 'Zoe';
    review = reviewDraft(draft, context());
    expect(review.creates).toBe(1);
    expect(review.plan[0]).toMatchObject({
      memberId: null,
      create: { lastname: 'Graf', firstname: 'Zoe' },
      addToRoster: true
    });
  });

  it('cleans the names of a new member', () => {
    expect(newMemberNames({ lastname: '=Graf', firstname: ' Zoe  Lea ' })).toEqual({
      lastname: 'Graf',
      firstname: 'Zoe Lea'
    });
    expect(newMemberNames({ lastname: 'Graf', firstname: ' ' })).toBeNull();
  });

  it('merges the same person listed twice, with the higher role', () => {
    const draft = draftOf(
      proposal([
        entry('Keller Beni', { dates: ['2026-10-12'] }),
        entry('Benjamin Keller', { role: 'main_trainer', dates: ['2026-10-12', '2026-10-19'] })
      ])
    );
    const review = reviewDraft(draft, context());
    expect(review.entries.map((e) => e.status)).toEqual(['new', 'duplicate']);
    expect(review.entries[1].duplicateOf).toBe(0);
    expect(review.plan).toEqual([
      {
        entry: 0,
        memberId: 3,
        create: null,
        addToRoster: false,
        checkIns: [
          { date: '2026-10-12', role: 'main_trainer' },
          { date: '2026-10-19', role: 'main_trainer' }
        ]
      }
    ]);
  });

  it('keeps the role per date when a leader is also listed as a participant', () => {
    const draft = draftOf(
      proposal([
        entry('Keller Benjamin', { dates: ['2026-10-05', '2026-10-12'] }),
        entry('Beni Keller', { role: 'main_trainer', dates: ['2026-10-12'] })
      ])
    );
    const review = reviewDraft(draft, context([['2026-10-12', 3, 'main_trainer']]));
    // Led on the 12th (already recorded so), took part on the 5th
    expect(review.entries[0]).toMatchObject({ status: 'new', cells: ['new', 'exists'] });
    expect(review.plan[0].checkIns).toEqual([{ date: '2026-10-05', role: 'attendee' }]);
  });

  it('puts only people who get a check-in on the roster', () => {
    const draft = draftOf(proposal([entry('Elias Brunner'), entry('Noah Schmid')]));
    draft.entries[1].unconfirmed = false;
    // Elias is recorded already: nothing to write, so the roster stays as it is
    const review = reviewDraft(draft, context([['2026-10-19', 7, 'attendee']]));
    expect(review.entries.map((e) => [e.status, e.addsToRoster])).toEqual([
      ['exists', false],
      ['new', true]
    ]);
    expect(review.rosterAdds).toBe(1);
    expect(review.plan.map((p) => p.memberId)).toEqual([5]);
  });

  it('writes a date on another weekday only once the user includes it, never a future one', () => {
    const draft = draftOf(
      proposal([entry('Lena Müller', { dates: ['2026-10-13', '2026-10-19', '2026-10-26'] })])
    );
    let review = reviewDraft(draft, context());
    expect(review.dates.map((d) => [d.issue, d.usable])).toEqual([
      ['weekday', false],
      [null, true],
      ['future', false]
    ]);
    expect(review.entries[0].cells).toEqual(['excluded', 'new', 'excluded']);

    draft.dates[0].include = true;
    draft.dates[2].include = true;
    review = reviewDraft(draft, context());
    expect(review.plan[0].checkIns.map((c) => c.date)).toEqual(['2026-10-13', '2026-10-19']);
  });

  it('counts the people marked per date and flags cancelled sessions', () => {
    const draft = draftOf(
      proposal([
        entry('Lena Müller', { dates: ['2026-10-05', '2026-10-12'] }),
        entry('Lukas Müller', { dates: ['2026-10-12'] }),
        entry('Zoe Unbekannt', { dates: ['2026-10-12'] })
      ])
    );
    draft.entries[2].action = 'skip';
    const review = reviewDraft(draft, { ...context(), cancelled: new Set(['2026-10-05']) });
    expect(review.dates.map((d) => [d.date, d.marked, d.cancelled])).toEqual([
      ['2026-10-05', 1, true],
      ['2026-10-12', 2, false]
    ]);
    expect(review.entries[1].status).toBe('new');
    expect(review.entries[2].status).toBe('skipped');
    expect(review.checkIns).toBe(3);
  });

  it('reports a row with nothing on the dates taken over as empty', () => {
    const draft = draftOf(
      proposal([
        entry('Lena Müller', { dates: ['2026-10-12'] }),
        entry('Lukas Müller', { dates: ['2026-10-13'] })
      ])
    );
    expect(reviewDraft(draft, context()).entries[1].status).toBe('empty');
  });
});

describe('after a partly failed save', () => {
  it('retries a created member through its id, roster first, without creating it again', () => {
    const draft = draftOf(
      proposal([
        entry('Graf Zoe', { dates: ['2026-10-12', '2026-10-19'] }),
        entry('Zoe Graf', { dates: ['2026-10-19'] })
      ])
    );
    for (const e of draft.entries) {
      chooseEntry(e, 'create', () => false);
      e.lastname = 'Graf';
      e.firstname = 'Zoe';
    }
    const before = reviewDraft(draft, context());
    expect(before.plan).toHaveLength(1);
    expect(personRows(before, before.plan[0].entry)).toEqual([0, 1]);

    // Created as member 20, but the roster upsert failed
    const zoe = { id: 20, firstname: 'Zoe', lastname: 'Graf', labels: ['new'] };
    adoptMember(draft.entries, personRows(before, 0), zoe.id, true);
    const ctx = { ...context(), members: new Map([...memberMap, [zoe.id, zoe]]) };
    const retry = reviewDraft(draft, ctx);
    expect(retry.creates).toBe(0);
    expect(retry.plan).toEqual([
      {
        entry: 0,
        memberId: 20,
        create: null,
        addToRoster: true,
        checkIns: [
          { date: '2026-10-12', role: 'attendee' },
          { date: '2026-10-19', role: 'attendee' }
        ]
      }
    ]);

    // On the roster now, the 12th saved: only the 19th is left
    const saved = reviewDraft(draft, {
      ...ctx,
      roster: new Set([...roster, 20]),
      existing: new Map([[checkInKey('2026-10-12', 20), 'attendee']])
    });
    expect(saved.plan[0]).toMatchObject({
      addToRoster: false,
      checkIns: [{ date: '2026-10-19', role: 'attendee' }]
    });
    expect(saved.entries[0].cells).toEqual(['exists', 'new']);
  });

  it('drops the check-ins that committed despite the error', () => {
    const failures = new Map<number, SaveFailure>([
      [
        0,
        {
          step: 'checkIn',
          memberId: 1,
          checkIns: [
            { date: '2026-10-12', role: 'attendee' },
            { date: '2026-10-19', role: 'main_trainer' }
          ]
        }
      ],
      [2, { step: 'checkIn', memberId: 2, checkIns: [{ date: '2026-10-12', role: 'attendee' }] }],
      [
        3,
        {
          step: 'create',
          memberId: null,
          checkIns: [{ date: '2026-10-12', role: 'attendee' }]
        }
      ]
    ]);
    const existing = new Map<string, TrainerRole>([
      [checkInKey('2026-10-12', 1), 'attendee'],
      // Still the old role: the overwrite did not go through
      [checkInKey('2026-10-19', 1), 'attendee'],
      [checkInKey('2026-10-12', 2), 'attendee']
    ]);
    const open = openFailures(failures, existing);
    expect([...open.keys()]).toEqual([0, 3]);
    expect(open.get(0)?.checkIns).toEqual([{ date: '2026-10-19', role: 'main_trainer' }]);
    expect(open.get(3)?.checkIns).toHaveLength(1);
  });

  it('finds a member an insert created although it reported an error', () => {
    const found = [
      { id: 3, firstname: 'Zoe', lastname: 'Graf', labels: [] },
      { id: 21, firstname: 'Zoé', lastname: 'Graf', labels: ['new'] }
    ];
    const known = new Set([3]);
    expect(createdAnyway({ lastname: 'Graf', firstname: 'Zoe' }, found, known)?.id).toBe(21);
    expect(createdAnyway({ lastname: 'Graf', firstname: 'Lea' }, found, known)).toBeNull();
  });
});

describe('training plan', () => {
  const breaks = [
    {
      id: 1,
      title: 'Herbstferien',
      date_from: '2026-10-05',
      date_to: '2026-10-16',
      cancels_training: true
    }
  ];

  it('follows the breaks for planned trainings unless the TK holds the session', () => {
    const dates = ['2026-10-05', '2026-10-12', '2026-10-19'];
    const sessions = [
      { date: '2026-10-12', cancelled: false },
      { date: '2026-10-19', cancelled: true }
    ];
    expect([...cancelledDates(dates, { planned: true, sessions, breaks })]).toEqual([
      '2026-10-05',
      '2026-10-19'
    ]);
    // Not in the plan: breaks do not apply, only explicit cancellations
    expect([...cancelledDates(dates, { planned: false, sessions, breaks })]).toEqual([
      '2026-10-19'
    ]);
  });
});

describe('helpers', () => {
  it('finds weekdays named on the list', () => {
    expect(writtenWeekdays('Judo Kinder Montag 18:30')).toEqual(['Monday']);
    expect(writtenWeekdays('Dienstagstraining Kids')).toEqual(['Tuesday']);
    expect(writtenWeekdays('Präsenzliste Mo/Mi')).toEqual([]);
  });

  it('notes former members, passive members and trial candidates', () => {
    expect(memberHint(members[4])).toBe('former');
    expect(memberHint({ labels: ['Passiv'] })).toBe('passive');
    expect(memberHint(members[5])).toBe('trial');
    expect(memberHint(members[0])).toBeNull();
    expect(labelList(['Aktiv', 3, null])).toEqual(['Aktiv']);
    expect(labelList(null)).toEqual([]);
  });

  it('tells members with the same name apart', () => {
    const club: AttendanceMember[] = [
      ...members,
      { id: 50, firstname: 'Hans', lastname: 'Muster', labels: ['Aktiv'] },
      { id: 90, firstname: 'Hans', lastname: 'Muster', labels: ['new'] },
      { id: 91, firstname: 'Lena', lastname: 'Mueller', labels: ['Passiv'] },
      { id: 92, firstname: 'Elias', lastname: 'Brunner', labels: [] }
    ];
    const twins = nameTwins(club, new Set([...roster, 90]));
    expect([...twins.keys()].sort((a, b) => a - b)).toEqual([1, 7, 50, 90, 91, 92]);
    expect(twins.get(50)).toEqual({ details: ['notRoster'], showId: false });
    expect(twins.get(90)).toEqual({ details: ['roster', 'new'], showId: false });
    expect(twins.get(1)).toEqual({ details: ['roster'], showId: false });
    expect(twins.get(91)).toEqual({ details: ['notRoster', 'passive'], showId: false });
    // Nothing else to tell them apart by
    expect(twins.get(7)).toEqual({ details: ['notRoster'], showId: true });
    expect(twins.get(92)).toEqual({ details: ['notRoster'], showId: true });
  });

  it('sorts members by name and filters them by word starts', () => {
    expect(sortMembers(members).map((m) => m.lastname)).toEqual([
      'Brunner',
      'Keller',
      'Meier',
      'Müller',
      'Müller',
      'Muster',
      'Schmid'
    ]);
    expect(filterMembers(members, 'mul').map((m) => m.id)).toEqual([1, 2]);
    expect(filterMembers(members, 'lena mu').map((m) => m.id)).toEqual([1, 4]);
    expect(filterMembers(members, '')).toHaveLength(members.length);
  });

  it('loads every page of a long result', async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const ranges: [number, number][] = [];
    const rows = await fetchAllRows(async (from, to) => {
      ranges.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(rows).toEqual(all);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ]);
    await expect(
      fetchAllRows(async () => ({ data: null, error: new Error('permission denied') }))
    ).rejects.toThrow('permission denied');
  });
});
