import { describe, expect, it } from 'vitest';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import { addDays, type FeedTraining } from './calendarFeed';
import {
  MAIL_DAYS_AHEAD,
  addressKey,
  computeNotices,
  fingerprint,
  isTestAddress,
  normTime,
  scheduleOf,
  type MailAddress,
  type MailMember,
  type MailPlanData,
  type MailScope,
  type MemberNotice,
  type MemberTold,
  type NoticeLine,
  type NoticeSet,
  type ToldDateRow,
  type ToldTrainingRow
} from './trainingPlanMail';
import { compressTraining, memberBlocks, renderMail } from './trainingPlanMailText';

// A Monday; training 1 is on Mondays, training 2 on Wednesdays
const TODAY = '2026-11-02';
const TK: MailScope = { all: true, trainingIds: [] };

const MEMBERS: MailMember[] = [
  { id: 10, firstname: 'Max', lastname: 'Muster' },
  { id: 20, firstname: 'Anna', lastname: 'Aebi' },
  { id: 30, firstname: 'Lea', lastname: 'Keller' },
  { id: 40, firstname: 'Tom', lastname: 'Brunner' },
  { id: 50, firstname: 'Eva', lastname: 'Zaugg' }
];

const ADDRESSES: MailAddress[] = MEMBERS.map((m) => ({
  member_id: m.id,
  email: `${m.firstname.toLowerCase()}@test.ch`,
  source: 'member'
}));

const t1 = (over: Partial<FeedTraining> = {}): FeedTraining => ({
  id: 1,
  title: 'Judo Montag',
  weekday: 'Monday',
  dateFrom: '18:00',
  dateTo: '19:30',
  section: 'Judo',
  mainTrainerId: 10,
  ...over
});

const t2 = (over: Partial<FeedTraining> = {}): FeedTraining => ({
  id: 2,
  title: 'Judo Mittwoch',
  weekday: 'Wednesday',
  dateFrom: '18.30',
  dateTo: '20.00',
  section: 'Judo',
  mainTrainerId: null,
  ...over
});

let nextSession = 1;
function session(
  trainingId: number,
  date: string,
  trainerId: number | null,
  over: Partial<TrainingPlanSession> = {}
): TrainingPlanSession {
  return {
    id: nextSession++,
    training_id: trainingId,
    date,
    trainer_id: trainerId,
    topic: null,
    notes: null,
    cancelled: null,
    updated_at: '',
    ...over
  };
}

function closing(title: string, from: string, to = from, cancels = true): TrainingPlanBreak {
  return { id: nextSession++, title, date_from: from, date_to: to, cancels_training: cancels };
}

function plan(over: Partial<MailPlanData> = {}): MailPlanData {
  return {
    today: TODAY,
    to: addDays(TODAY, MAIL_DAYS_AHEAD),
    trainings: [t1(), t2()],
    sessions: [],
    breaks: [],
    toldTrainings: [],
    toldDates: [],
    optOuts: [],
    ownMemberIds: [],
    members: MEMBERS,
    addresses: ADDRESSES,
    pendingMails: [],
    ...over
  };
}

/** Mondays from today on: 2026-11-02, 11-09, 11-16, ... */
const monday = (week: number) => addDays(TODAY, 7 * week);
/** Wednesdays from today on: 2026-11-04, 11-11, ... */
const wednesday = (week: number) => addDays(TODAY, 2 + 7 * week);

/** What training_plan_set_told() does with the states, on the data */
function applyTold(data: MailPlanData, states: MemberTold[]): MailPlanData {
  let toldTrainings: ToldTrainingRow[] = [...data.toldTrainings];
  let toldDates: ToldDateRow[] = [...data.toldDates];
  for (const s of states) {
    const replaced = (row: { member_id: number; training_id: number }) =>
      row.member_id === s.member_id && s.training_ids.includes(row.training_id);
    toldDates = toldDates.filter(
      (d) => !replaced(d) && !(d.member_id === s.member_id && d.date < data.today)
    );
    toldTrainings = toldTrainings.filter((t) => !replaced(t));
    toldTrainings.push(
      ...s.trainings.map((t) => ({ member_id: s.member_id, ...t, told_at: '2026-11-02T10:00Z' }))
    );
    toldDates.push(
      ...s.dates.filter((d) => d.date >= data.today).map((d) => ({ member_id: s.member_id, ...d }))
    );
  }
  return { ...data, toldTrainings, toldDates };
}

/** The told payload's rules (training_plan_set_told() and the exception model) */
function checkTold(n: MemberNotice, data: MailPlanData, scope: MailScope) {
  const { told } = n;
  expect(told.member_id).toBe(n.memberId);
  for (const id of told.training_ids)
    expect(scope.all || scope.trainingIds.includes(id)).toBe(true);
  const entries = new Map(told.trainings.map((t) => [t.training_id, t]));
  for (const t of told.trainings) expect(told.training_ids).toContain(t.training_id);
  for (const d of told.dates) {
    const entry = entries.get(d.training_id);
    expect(entry).toBeDefined();
    expect(d.date >= data.today && d.date <= data.to).toBe(true);
    expect(entry!.is_main ? ['cancelled', 'not_lead'] : ['lead', 'cancelled']).toContain(d.state);
  }
}

/**
 * computeNotices, plus the invariant every fixture of this file goes through:
 * once the pending and the sender's own members are told, nothing is pending
 */
function notices(data: MailPlanData, scope: MailScope = TK): NoticeSet {
  const set = computeNotices(data, scope);
  for (const n of [...set.members, ...set.own]) checkTold(n, data, scope);
  const after = computeNotices(
    applyTold(
      data,
      [...set.members, ...set.own].map((n) => n.told)
    ),
    scope
  );
  expect(after.members).toEqual([]);
  expect(after.own.flatMap((o) => o.trainings)).toEqual([]);
  return set;
}

/** The data with every pending (and own) member told: the baseline of a change */
function told(data: MailPlanData, scope: MailScope = TK): MailPlanData {
  const set = notices(data, scope);
  return applyTold(
    data,
    [...set.members, ...set.own].map((n) => n.told)
  );
}

function member(set: NoticeSet, id: number): MemberNotice | undefined {
  return set.members.find((m) => m.memberId === id);
}

function lines(set: NoticeSet, id: number): NoticeLine[] {
  return (member(set, id)?.trainings ?? []).flatMap((t) => t.lines);
}

/** kind and date per line, the short form most cases compare */
function brief(set: NoticeSet, id: number): string[] {
  return lines(set, id).map((l) => (l.date ? `${l.kind} ${l.date}` : l.kind));
}

const MONDAY_1800 = { weekday: 'Monday', timeFrom: '18:00', timeTo: '19:30' };

describe('helpers', () => {
  it('normalizes times, weekdays and addresses', () => {
    expect(normTime('18.00')).toBe('18:00');
    expect(normTime(' 9:05 ')).toBe('09:05');
    expect(normTime('abends')).toBe('abends');
    expect(normTime('  ')).toBeNull();
    expect(normTime(null)).toBeNull();
    expect(scheduleOf(t2({ weekday: '' }))).toEqual({
      weekday: null,
      timeFrom: '18:30',
      timeTo: '20:00'
    });
    expect(addressKey(' Familie@Test.CH ')).toBe('familie@test.ch');
    expect(isTestAddress('member-12@example.INVALID ')).toBe(true);
    expect(isTestAddress('max@invalid.ch')).toBe(false);
  });
});

describe('computeNotices', () => {
  it('1: first time, a main trainer without sessions is told they lead every date', () => {
    const set = notices(plan());
    expect(set.firstTime).toBe(true);
    expect(set.members.map((m) => m.memberId)).toEqual([10]);
    const max = member(set, 10)!;
    expect(max.firstTime).toBe(true);
    expect(max.trainings).toEqual([
      {
        trainingId: 1,
        title: 'Judo Montag',
        schedule: MONDAY_1800,
        lines: [{ kind: 'main_new', trainingId: 1, schedule: MONDAY_1800 }]
      }
    ]);
    expect(max.told).toEqual({
      member_id: 10,
      training_ids: [1],
      trainings: [
        {
          training_id: 1,
          is_main: true,
          title: 'Judo Montag',
          weekday: 'Monday',
          time_from: '18:00',
          time_to: '19:30'
        }
      ],
      dates: []
    });
  });

  it('2: first time, a substitute gets their dates and the main trainer the exceptions', () => {
    const set = notices(
      plan({
        sessions: [session(1, monday(1), 20), session(1, monday(2), 20), session(1, monday(3), 20)],
        breaks: [closing('Herbstferien', monday(2))]
      })
    );
    expect(brief(set, 20)).toEqual([`lead ${monday(1)}`, `lead ${monday(3)}`]);
    expect(member(set, 20)!.told.dates).toEqual([
      { training_id: 1, date: monday(1), state: 'lead' },
      { training_id: 1, date: monday(2), state: 'cancelled' },
      { training_id: 1, date: monday(3), state: 'lead' }
    ]);
    expect(member(set, 20)!.told.trainings[0].is_main).toBe(false);

    expect(lines(set, 10)).toEqual([
      { kind: 'main_new', trainingId: 1, schedule: MONDAY_1800 },
      {
        kind: 'other_leads',
        trainingId: 1,
        date: monday(1),
        other: { memberId: 20, name: 'Anna Aebi' }
      },
      { kind: 'cancelled', trainingId: 1, date: monday(2), reason: 'Herbstferien' },
      {
        kind: 'other_leads',
        trainingId: 1,
        date: monday(3),
        other: { memberId: 20, name: 'Anna Aebi' }
      }
    ]);
    expect(member(set, 10)!.told.dates).toEqual([
      { training_id: 1, date: monday(1), state: 'not_lead' },
      { training_id: 1, date: monday(2), state: 'not_lead' },
      { training_id: 1, date: monday(3), state: 'not_lead' }
    ]);
    // Sorted by last name
    expect(set.members.map((m) => m.memberId)).toEqual([20, 10]);
  });

  it('3: once everyone is told, nothing is pending (every fixture of this file checks it)', () => {
    const data = plan({
      trainings: [t1(), t2({ mainTrainerId: 50 })],
      sessions: [
        session(1, monday(1), 20, { topic: 'Fallschule' }),
        session(1, monday(2), null, { cancelled: true }),
        session(2, wednesday(1), 30),
        session(2, wednesday(2), 30, { cancelled: true }),
        session(2, wednesday(3), 50, { cancelled: false })
      ],
      breaks: [closing('Herbstferien', wednesday(3), addDays(wednesday(3), 7))],
      ownMemberIds: [30]
    });
    const baseline = told(data);
    expect(computeNotices(baseline, TK).members).toEqual([]);
    expect(computeNotices(baseline, TK).firstTime).toBe(false);
  });

  it('4: a substitute added: the main trainer loses the date, the substitute gets it', () => {
    const baseline = told(plan());
    const set = notices({ ...baseline, sessions: [session(1, monday(1), 30)] });
    expect(lines(set, 10)).toEqual([
      {
        kind: 'not_lead',
        trainingId: 1,
        date: monday(1),
        other: { memberId: 30, name: 'Lea Keller' }
      }
    ]);
    expect(lines(set, 30)).toEqual([{ kind: 'lead', trainingId: 1, date: monday(1), topic: null }]);
    expect(member(set, 10)!.firstTime).toBe(false);
    expect(member(set, 30)!.firstTime).toBe(true);
  });

  it('5: a substitute cleared: the date falls back to the main trainer', () => {
    const baseline = told(plan({ sessions: [session(1, monday(1), 30)] }));
    const set = notices({ ...baseline, sessions: [] });
    expect(lines(set, 10)).toEqual([{ kind: 'lead', trainingId: 1, date: monday(1), topic: null }]);
    expect(lines(set, 30)).toEqual([
      {
        kind: 'not_lead',
        trainingId: 1,
        date: monday(1),
        other: { memberId: 10, name: 'Max Muster' }
      }
    ]);
    // No longer involved: what 30 was told about training 1 goes
    expect(member(set, 30)!.told).toEqual({
      member_id: 30,
      training_ids: [1],
      trainings: [],
      dates: []
    });
  });

  it('6: a substitute swapped: only the two substitutes hear of it', () => {
    const baseline = told(plan({ sessions: [session(1, monday(1), 30)] }));
    const set = notices({ ...baseline, sessions: [session(1, monday(1), 40)] });
    expect(member(set, 10)).toBeUndefined();
    expect(lines(set, 30)).toEqual([
      {
        kind: 'not_lead',
        trainingId: 1,
        date: monday(1),
        other: { memberId: 40, name: 'Tom Brunner' }
      }
    ]);
    expect(brief(set, 40)).toEqual([`lead ${monday(1)}`]);
  });

  it('7: "Trainer offen" only on a training without a main trainer', () => {
    const baseline = told(
      plan({ sessions: [session(2, wednesday(1), 30), session(1, monday(1), 30)] })
    );
    // The trainer cleared, a topic stays
    const set = notices({
      ...baseline,
      sessions: [
        session(2, wednesday(1), null, { topic: 'Kata' }),
        session(1, monday(1), null, { topic: 'Kata' })
      ]
    });
    expect(lines(set, 30)).toEqual([
      {
        kind: 'not_lead',
        trainingId: 1,
        date: monday(1),
        other: { memberId: 10, name: 'Max Muster' }
      },
      { kind: 'not_lead', trainingId: 2, date: wednesday(1), other: 'open' }
    ]);
    const all = set.members.flatMap((m) => m.trainings.flatMap((t) => t.lines));
    expect(all.filter((l) => l.trainingId === 1 && l.other === 'open')).toEqual([]);
  });

  it('8: a cancelled session: substitute and main trainer hear it, without a reason', () => {
    const baseline = told(
      plan({ sessions: [session(1, monday(1), 20), session(2, wednesday(1), 30)] })
    );
    const set = notices({
      ...baseline,
      sessions: [
        session(1, monday(1), 20, { cancelled: true }),
        session(1, monday(2), null, { cancelled: true }),
        // Dropped and nobody planned any more
        session(2, wednesday(1), null, { cancelled: true })
      ]
    });
    expect(lines(set, 20)).toEqual([
      { kind: 'cancelled', trainingId: 1, date: monday(1), reason: null }
    ]);
    expect(lines(set, 10)).toEqual([
      { kind: 'cancelled', trainingId: 1, date: monday(2), reason: null }
    ]);
    expect(lines(set, 30)).toEqual([
      { kind: 'not_lead', trainingId: 2, date: wednesday(1), other: 'cancelled' }
    ]);
  });

  it('9: a break closing the dojo cancels with its title; holidays the training goes on through do not', () => {
    const baseline = told(plan());
    const set = notices({
      ...baseline,
      breaks: [
        closing('Herbstferien', monday(2), addDays(monday(3), 2)),
        closing('Schulferien', monday(5), addDays(monday(6), 4), false)
      ],
      // Dropped by the TK during holidays: no reason, the holidays did not do it
      sessions: [session(1, monday(6), null, { cancelled: true })]
    });
    expect(lines(set, 10)).toEqual([
      { kind: 'cancelled', trainingId: 1, date: monday(2), reason: 'Herbstferien' },
      { kind: 'cancelled', trainingId: 1, date: monday(3), reason: 'Herbstferien' },
      { kind: 'cancelled', trainingId: 1, date: monday(6), reason: null }
    ]);
  });

  it('10: a session cancelled explicitly inside a closing break names the break', () => {
    const baseline = told(plan());
    const set = notices({
      ...baseline,
      sessions: [session(1, monday(2), null, { cancelled: true })],
      breaks: [closing('Herbstferien', monday(2))]
    });
    expect(lines(set, 10)).toEqual([
      { kind: 'cancelled', trainingId: 1, date: monday(2), reason: 'Herbstferien' }
    ]);
    // Stored either way (PlanGrid null, SessionDialog true): the same to the trainer
    const nulled = computeNotices(
      applyTold(
        { ...baseline, breaks: [closing('Herbstferien', monday(2))] },
        set.members.map((m) => m.told)
      ),
      TK
    );
    expect(nulled.members).toEqual([]);
  });

  it('11: held after all inside a closing break: takes place again', () => {
    const breaks = [closing('Herbstferien', monday(2))];
    const baseline = told(plan({ breaks }));
    const set = notices({
      ...baseline,
      sessions: [session(1, monday(2), null, { cancelled: false, topic: 'Randori' })]
    });
    expect(lines(set, 10)).toEqual([
      { kind: 'resumed', trainingId: 1, date: monday(2), topic: 'Randori' }
    ]);
  });

  it('12: cancelling a date someone else leads tells the main trainer nothing', () => {
    const baseline = told(plan({ sessions: [session(1, monday(1), 20)] }));
    const set = notices({
      ...baseline,
      sessions: [session(1, monday(1), 20, { cancelled: true })]
    });
    expect(member(set, 10)).toBeUndefined();
    expect(brief(set, 20)).toEqual([`cancelled ${monday(1)}`]);
  });

  it('13: a topic alone changes nothing, is shown on listed dates, and notes never appear', () => {
    const baseline = told(plan({ sessions: [session(1, monday(1), 20, { topic: 'Fallschule' })] }));
    expect(
      notices({
        ...baseline,
        sessions: [session(1, monday(1), 20, { topic: 'Randori', notes: 'GEHEIM' })]
      }).members
    ).toEqual([]);

    const set = notices(
      plan({
        sessions: [session(1, monday(1), 20, { topic: ' Fallschule ', notes: 'GEHEIM' })]
      })
    );
    expect(lines(set, 20)).toEqual([
      { kind: 'lead', trainingId: 1, date: monday(1), topic: 'Fallschule' }
    ]);
    const ctx = {
      locale: 'de' as const,
      clubName: 'Club',
      origin: 'https://x.ch',
      senderName: 'S'
    };
    for (const m of set.members) {
      expect(renderMail([m], ctx).text).not.toContain('GEHEIM');
      expect(JSON.stringify(memberBlocks(m, 'de'))).not.toContain('GEHEIM');
      expect(JSON.stringify(m)).not.toContain('GEHEIM');
    }
    expect(renderMail(set.members, ctx).text).toContain('(Thema: Fallschule)');
  });

  it('14: told dates before today are ignored', () => {
    const data = plan({
      toldTrainings: [
        {
          member_id: 20,
          training_id: 1,
          is_main: false,
          title: 'Judo Montag',
          weekday: 'Monday',
          time_from: '18:00',
          time_to: '19:30',
          told_at: '2026-10-01T10:00Z'
        },
        {
          member_id: 10,
          training_id: 1,
          is_main: true,
          title: 'Judo Montag',
          weekday: 'Monday',
          time_from: '18:00',
          time_to: '19:30',
          told_at: '2026-10-01T10:00Z'
        }
      ],
      toldDates: [
        { member_id: 20, training_id: 1, date: '2026-10-26', state: 'lead' },
        { member_id: 10, training_id: 1, date: '2026-10-26', state: 'not_lead' }
      ]
    });
    const set = notices(data);
    expect(set.members).toEqual([]);
    expect(set.firstTime).toBe(false);

    // A new time concerns the main trainer, not someone with only past dates
    const moved = notices({ ...data, trainings: [t1({ dateFrom: '18:30' }), t2()] });
    expect(moved.members.map((m) => [m.memberId, brief(moved, m.memberId)])).toEqual([
      [10, ['schedule']]
    ]);
  });

  it('15: a main trainer whose training moves to another weekday: one line and the new exceptions', () => {
    const baseline = told(plan({ sessions: [session(1, monday(1), 20)] }));
    const tuesday = (week: number) => addDays(monday(week), 1);
    const set = notices({
      ...baseline,
      trainings: [t1({ weekday: 'Tuesday' }), t2()],
      sessions: [session(1, monday(1), 20), session(1, tuesday(1), 30)],
      breaks: [closing('Brückentag', tuesday(2))]
    });
    expect(lines(set, 10)).toEqual([
      {
        kind: 'schedule',
        trainingId: 1,
        schedule: { ...MONDAY_1800, weekday: 'Tuesday' },
        before: MONDAY_1800
      },
      {
        kind: 'other_leads',
        trainingId: 1,
        date: tuesday(1),
        other: { memberId: 30, name: 'Lea Keller' }
      },
      { kind: 'cancelled', trainingId: 1, date: tuesday(2), reason: 'Brückentag' }
    ]);
    // The substitute's Monday is gone with the weekday
    expect(brief(set, 20)).toEqual(['schedule', `not_lead ${monday(1)}`]);
    expect(lines(set, 20)[1].other).toBeNull();
  });

  it('16: a substitute whose training moves: each told date is gone, the new ones are listed', () => {
    const baseline = told(
      plan({ sessions: [session(1, monday(1), 20), session(1, monday(2), 20)] })
    );
    const thursday = (week: number) => addDays(monday(week), 3);
    const set = notices({
      ...baseline,
      trainings: [t1({ weekday: 'Thursday' }), t2()],
      sessions: [session(1, thursday(1), 20)]
    });
    expect(brief(set, 20)).toEqual([
      'schedule',
      `not_lead ${monday(1)}`,
      `lead ${thursday(1)}`,
      `not_lead ${monday(2)}`
    ]);
    expect(lines(set, 20)[1]).toEqual({
      kind: 'not_lead',
      trainingId: 1,
      date: monday(1),
      other: null
    });
  });

  it('17: a new time is one line; 18.00 and 18:00 are the same', () => {
    const baseline = told(plan());
    const set = notices({ ...baseline, trainings: [t1({ dateFrom: '18.30' }), t2()] });
    expect(lines(set, 10)).toEqual([
      {
        kind: 'schedule',
        trainingId: 1,
        schedule: { ...MONDAY_1800, timeFrom: '18:30' },
        before: MONDAY_1800
      }
    ]);
    expect(
      notices({ ...baseline, trainings: [t1({ dateFrom: '18.00', dateTo: ' 19.30' }), t2()] })
        .members
    ).toEqual([]);
  });

  it('18: a new main trainer: the old one hears it, the new one gets the overview', () => {
    const baseline = told(
      plan({ sessions: [session(1, monday(1), 30), session(1, monday(2), 10, { topic: 'Kata' })] })
    );
    const set = notices({ ...baseline, trainings: [t1({ mainTrainerId: 40 }), t2()] });
    expect(lines(set, 10)).toEqual([
      { kind: 'main_gone', trainingId: 1 },
      { kind: 'still_lead', trainingId: 1, date: monday(2), topic: 'Kata' }
    ]);
    expect(lines(set, 40)).toEqual([
      { kind: 'main_new', trainingId: 1, schedule: MONDAY_1800 },
      {
        kind: 'other_leads',
        trainingId: 1,
        date: monday(1),
        other: { memberId: 30, name: 'Lea Keller' }
      },
      {
        kind: 'other_leads',
        trainingId: 1,
        date: monday(2),
        other: { memberId: 10, name: 'Max Muster' }
      }
    ]);
    expect(member(set, 30)).toBeUndefined();
    expect(member(set, 10)!.told.trainings).toEqual([
      expect.objectContaining({ training_id: 1, is_main: false })
    ]);

    // The main trainer removed, nobody new: just that
    const removed = notices({
      ...told(plan()),
      trainings: [t1({ mainTrainerId: null }), t2()]
    });
    expect(lines(removed, 10)).toEqual([{ kind: 'main_gone', trainingId: 1 }]);
    expect(removed.members.map((m) => m.memberId)).toEqual([10]);

    // No longer main trainer but planned on dates, at a new time
    const exMain = notices({
      ...told(
        plan({
          sessions: [session(1, monday(3), 30)],
          breaks: [closing('Herbstferien', monday(2))]
        })
      ),
      trainings: [t1({ mainTrainerId: 40, dateFrom: '18:30' }), t2()],
      sessions: [
        session(1, monday(2), 10, { cancelled: false }),
        session(1, monday(3), 10),
        session(1, monday(4), 10)
      ],
      breaks: [closing('Herbstferien', monday(2))]
    });
    expect(brief(exMain, 10)).toEqual([
      'main_gone',
      'schedule',
      `resumed ${monday(2)}`,
      `lead ${monday(3)}`,
      `still_lead ${monday(4)}`
    ]);

    // A substitute made main trainer: what they were told about dates counts
    const breaks = [closing('Herbstferien', monday(2))];
    const before = told(
      plan({
        sessions: [session(1, monday(1), 20), session(1, monday(2), 20), session(1, monday(3), 20)],
        breaks
      })
    );
    const promoted = notices({
      ...before,
      trainings: [t1({ mainTrainerId: 20 }), t2()],
      sessions: [
        session(1, monday(1), 20),
        session(1, monday(2), null, { cancelled: false }),
        session(1, monday(3), 30)
      ]
    });
    expect(lines(promoted, 20)).toEqual([
      { kind: 'main_new', trainingId: 1, schedule: MONDAY_1800 },
      { kind: 'resumed', trainingId: 1, date: monday(2), topic: null },
      {
        kind: 'not_lead',
        trainingId: 1,
        date: monday(3),
        other: { memberId: 30, name: 'Lea Keller' }
      }
    ]);
    expect(brief(promoted, 10)).toEqual(['main_gone']);
    expect(brief(promoted, 30)).toEqual([`lead ${monday(3)}`]);
  });

  it('19: a training taken out of the plan, for those who still had dates in it', () => {
    const baseline = told(plan({ sessions: [session(1, monday(1), 20)] }));
    const data: MailPlanData = {
      ...baseline,
      toldTrainings: [
        ...baseline.toldTrainings,
        {
          member_id: 30,
          training_id: 1,
          is_main: false,
          title: 'Judo Montag',
          weekday: 'Monday',
          time_from: '18:00',
          time_to: '19:30',
          told_at: '2026-10-01T10:00Z'
        }
      ],
      toldDates: [
        ...baseline.toldDates,
        { member_id: 30, training_id: 1, date: '2026-10-26', state: 'lead' },
        { member_id: 30, training_id: 1, date: monday(4), state: 'not_lead' }
      ],
      trainings: [t2()],
      sessions: []
    };
    const set = notices(data);
    expect(set.members.map((m) => [m.memberId, brief(set, m.memberId)])).toEqual([
      [20, ['training_gone']],
      [10, ['training_gone']]
    ]);
    expect(member(set, 10)!.trainings[0]).toMatchObject({
      title: 'Judo Montag',
      schedule: MONDAY_1800
    });
    expect(member(set, 10)!.told).toEqual({
      member_id: 10,
      training_ids: [1],
      trainings: [],
      dates: []
    });
    // A main trainer plans only what is planned and theirs
    expect(notices(data, { all: false, trainingIds: [2] }).members).toEqual([]);
  });

  it('20: a deleted training is named as it was told', () => {
    const baseline = told(plan());
    const set = notices({
      ...baseline,
      toldTrainings: baseline.toldTrainings.map((t) => ({
        ...t,
        title: 'Judo Montag (alt)',
        time_to: null
      })),
      trainings: [t2()]
    });
    expect(member(set, 10)!.trainings).toEqual([
      {
        trainingId: 1,
        title: 'Judo Montag (alt)',
        schedule: { weekday: 'Monday', timeFrom: '18:00', timeTo: null },
        lines: [{ kind: 'training_gone', trainingId: 1 }]
      }
    ]);
  });

  it('21: many dates of one kind and the dates of one break are compressed', () => {
    const subOn = (weeks: number) =>
      notices(
        plan({ sessions: Array.from({ length: weeks }, (_, i) => session(1, monday(i + 1), 20)) })
      );
    const training = (set: NoticeSet) => member(set, 20)!.trainings[0];

    const fourteen = compressTraining(training(subOn(14)));
    expect(fourteen).toEqual([
      {
        type: 'range',
        kind: 'lead',
        dates: Array.from({ length: 14 }, (_, i) => monday(i + 1))
      }
    ]);
    // Anna's first message: an overview, so not "Neu"
    expect(memberBlocks(member(subOn(14), 20)!, 'de')[0].lines).toEqual([
      'Du leitest 14 Termine: 9.11., 16.11., 23.11., 30.11., 7.12., 14.12., 21.12., ' +
        '28.12.2026, 4.1., 11.1., 18.1., 25.1., 1.2., 8.2.2027'
    ]);
    // However many, every date is listed: the mail is all a trainer without the app has
    expect(memberBlocks(member(subOn(30), 20)!, 'de')[0].lines).toEqual([
      'Du leitest 30 Termine: 9.11., 16.11., 23.11., 30.11., 7.12., 14.12., 21.12., 28.12.2026, ' +
        '4.1., 11.1., 18.1., 25.1., 1.2., 8.2., 15.2., 22.2., 1.3., 8.3., 15.3., 22.3., 29.3., ' +
        '5.4., 12.4., 19.4., 26.4., 3.5., 10.5., 17.5., 24.5., 31.5.2027'
    ]);
    // A rotation a year ahead, once everyone was told: each date by name
    const rotation = notices({
      ...told(plan()),
      sessions: Array.from({ length: 26 }, (_, i) => session(1, monday(2 * i + 1), 20))
    });
    const everyOther =
      '26 Termine: 9.11., 23.11., 7.12., 21.12.2026, 4.1., 18.1., 1.2., 15.2., 1.3., 15.3., ' +
      '29.3., 12.4., 26.4., 10.5., 24.5., 7.6., 21.6., 5.7., 19.7., 2.8., 16.8., 30.8., 13.9., ' +
      '27.9., 11.10., 25.10.2027';
    expect(memberBlocks(member(rotation, 10)!, 'de')[0].lines).toEqual([
      `Nicht mehr bei dir: ${everyOther}`
    ]);
    expect(memberBlocks(member(rotation, 20)!, 'de')[0].lines).toEqual([
      `Du leitest ${everyOther}`
    ]);
    expect(memberBlocks({ ...member(rotation, 20)!, firstTime: false }, 'de')[0].lines).toEqual([
      `Neu: du leitest ${everyOther}`
    ]);
    const six = compressTraining(training(subOn(6)));
    expect(six.map((d) => d.type)).toEqual(['line', 'line', 'line', 'line', 'line', 'line']);

    const baseline = told(plan());
    const breakOf = (weeks: number, title = 'Herbstferien', start = 1) =>
      closing(title, monday(start), addDays(monday(start + weeks - 1), 6));
    const eight = notices({ ...baseline, breaks: [breakOf(8)] });
    expect(compressTraining(member(eight, 10)!.trainings[0])).toEqual([
      {
        type: 'break',
        reason: 'Herbstferien',
        dates: Array.from({ length: 8 }, (_, i) => monday(i + 1))
      }
    ]);
    expect(memberBlocks(member(eight, 10)!, 'de')[0].lines).toEqual([
      'Fällt aus (Herbstferien): 8 Termine vom 9.11.2026 bis 28.12.2026'
    ]);
    const two = notices({ ...baseline, breaks: [breakOf(2)] });
    expect(memberBlocks(member(two, 10)!, 'de')[0].lines).toEqual([
      'Fällt aus (Herbstferien): 9.11., 16.11.2026'
    ]);
    // Only one stretch of weekly dates is a span: breaks of the same name a
    // year apart, single closed days, or a date held in between list each date
    const summers = notices({
      ...baseline,
      breaks: [breakOf(4, 'Sommerferien', 1), breakOf(4, 'Sommerferien', 50)]
    });
    expect(memberBlocks(member(summers, 10)!, 'de')[0].lines).toEqual([
      'Fällt aus (Sommerferien): 9.11., 16.11., 23.11., 30.11.2026, 18.10., 25.10., 1.11., 8.11.2027'
    ]);
    const days = notices({
      ...baseline,
      breaks: Array.from({ length: 7 }, (_, i) => closing('Dojo geschlossen', monday(1 + 5 * i)))
    });
    expect(memberBlocks(member(days, 10)!, 'de')[0].lines).toEqual([
      'Fällt aus (Dojo geschlossen): 9.11., 14.12.2026, 18.1., 22.2., 29.3., 3.5., 7.6.2027'
    ]);
    const held = notices({
      ...baseline,
      breaks: [breakOf(8)],
      sessions: [session(1, monday(4), 10, { cancelled: false })]
    });
    expect(memberBlocks(member(held, 10)!, 'de')[0].lines).toEqual([
      'Fällt aus (Herbstferien): 9.11., 16.11., 23.11., 7.12., 14.12., 21.12., 28.12.2026'
    ]);
    const both = notices({
      ...baseline,
      breaks: [breakOf(2), breakOf(3, 'Weihnachten', 7)],
      sessions: [session(1, monday(5), null, { cancelled: true })]
    });
    expect(compressTraining(member(both, 10)!.trainings[0])).toEqual([
      { type: 'break', reason: 'Herbstferien', dates: [monday(1), monday(2)] },
      {
        type: 'line',
        line: { kind: 'cancelled', trainingId: 1, date: monday(5), reason: null }
      },
      { type: 'break', reason: 'Weihnachten', dates: [monday(7), monday(8), monday(9)] }
    ]);
  });

  it('22: a member gets every display line: nothing told goes unsaid', () => {
    // Ten trainings with six dates each: 60 display lines
    const trainings = Array.from({ length: 10 }, (_, i) => ({
      trainingId: 100 + i,
      title: `Training ${i}`,
      schedule: null,
      lines: Array.from({ length: 6 }, (_, j): NoticeLine => ({
        kind: 'lead',
        trainingId: 100 + i,
        date: monday(j + 1),
        topic: null
      }))
    }));
    const notice: MemberNotice = {
      memberId: 20,
      firstname: 'Anna',
      lastname: 'Aebi',
      firstTime: false,
      unclearSince: null,
      trainings,
      told: { member_id: 20, training_ids: [], trainings: [], dates: [] }
    };
    const blocks = memberBlocks(notice, 'de');
    const all = blocks.flatMap((b) => b.lines);
    expect(blocks).toHaveLength(10);
    expect(all).toHaveLength(60);
    expect(all.at(-1)).toBe('Neu: Mo 14.12.2026 – du leitest');
    expect(all.join('\n')).not.toMatch(/weitere|more change/);
    // The mail too: what it left out would be stored as told all the same
    const mail = renderMail([notice], {
      locale: 'de',
      clubName: '',
      origin: 'https://app.example.ch',
      senderName: ''
    });
    expect(mail.text).toContain(
      'Training 9\n' +
        all
          .slice(54)
          .map((l) => `- ${l}`)
          .join('\n')
    );
  });

  it('23: one mail per address: families share one, the account address counts', () => {
    const set = notices(
      plan({
        sessions: [session(1, monday(1), 30), session(1, monday(2), 20), session(1, monday(3), 40)],
        addresses: [
          { member_id: 10, email: 'max@test.ch', source: 'member' },
          { member_id: 20, email: 'familie@test.ch', source: 'member' },
          { member_id: 30, email: ' Familie@Test.ch ', source: 'member' },
          { member_id: 40, email: 'konto@test.ch', source: 'account' }
        ]
      })
    );
    expect(
      set.groups.map((g) => [g.key, g.address, g.source, g.members.map((m) => m.memberId)])
    ).toEqual([
      ['familie@test.ch', 'familie@test.ch', 'member', [20, 30]],
      ['konto@test.ch', 'konto@test.ch', 'account', [40]],
      ['max@test.ch', 'max@test.ch', 'member', [10]]
    ]);
    expect(set.unreachable).toEqual([]);
  });

  it('24: no address, a broken one, a test address and an opt-out are not mailed', () => {
    const set = notices(
      plan({
        sessions: [
          session(1, monday(1), 20),
          session(1, monday(2), 30),
          session(1, monday(3), 40),
          session(1, monday(4), 50)
        ],
        optOuts: [50],
        addresses: [
          { member_id: 10, email: 'max@test.ch', source: 'member' },
          { member_id: 20, email: null, source: null },
          { member_id: 30, email: 'lea-at-test.ch', source: 'member' },
          { member_id: 40, email: 'member-40@example.invalid', source: 'member' },
          { member_id: 50, email: 'eva@test.ch', source: 'account' }
        ]
      })
    );
    expect(set.groups.map((g) => g.key)).toEqual(['max@test.ch']);
    // A test address is never mailed, wherever it comes from
    const linked = computeNotices(
      plan({
        sessions: [session(1, monday(1), 40)],
        addresses: [
          { member_id: 10, email: 'max@test.ch', source: 'member' },
          { member_id: 40, email: 'Member-40@Example.INVALID ', source: 'account' }
        ]
      }),
      TK
    );
    expect(linked.groups.map((g) => g.key)).toEqual(['max@test.ch']);
    expect(linked.unreachable.map((u) => [u.member.memberId, u.reason])).toEqual([
      [40, 'test_address']
    ]);
    expect(set.unreachable.map((u) => [u.member.memberId, u.reason, u.address])).toEqual([
      [20, 'no_address', null],
      [40, 'test_address', 'member-40@example.invalid'],
      [30, 'no_address', 'lea-at-test.ch'],
      [50, 'opted_out', 'eva@test.ch']
    ]);
  });

  it('25: a main trainer sees and tells only their own trainings', () => {
    const scope: MailScope = { all: false, trainingIds: [1] };
    const data = plan({
      trainings: [t1(), t2({ mainTrainerId: 50 })],
      sessions: [session(1, monday(1), 30), session(2, wednesday(1), 30)],
      toldTrainings: [
        {
          member_id: 40,
          training_id: 2,
          is_main: false,
          title: 'Judo Mittwoch',
          weekday: 'Wednesday',
          time_from: '18:30',
          time_to: '20:00',
          told_at: '2026-10-01T10:00Z'
        }
      ],
      toldDates: [{ member_id: 40, training_id: 2, date: wednesday(2), state: 'lead' }]
    });
    const set = notices(data, scope);
    expect(set.members.map((m) => m.memberId)).toEqual([30, 10]);
    expect(set.members.flatMap((m) => m.trainings.map((t) => t.trainingId))).toEqual([1, 1]);
    for (const m of set.members) expect(m.told.training_ids).toEqual([1]);
    // Nothing told in scope yet, whatever 40 heard about training 2
    expect(set.firstTime).toBe(true);
  });

  it("26: the sender's own members are never mailed, but told along", () => {
    const set = notices(plan({ sessions: [session(1, monday(1), 20)], ownMemberIds: [10, 50] }));
    expect(set.members.map((m) => m.memberId)).toEqual([20]);
    expect(set.groups.flatMap((g) => g.members.map((m) => m.memberId))).toEqual([20]);
    expect(set.own.map((o) => o.memberId)).toEqual([10]);
    expect(set.own[0].trainings).toHaveLength(1);
    expect(set.own[0].told.trainings[0]).toMatchObject({ training_id: 1, is_main: true });
  });

  it('27: the fingerprint follows the lines and the address, not the order', () => {
    const data = plan({
      sessions: [session(1, monday(1), 20, { topic: 'Kata' }), session(1, monday(2), 30)]
    });
    const set = notices(data);
    const print = fingerprint(set.members, null);
    expect(print).toMatch(/^[0-9a-f]{14}$/);
    expect(fingerprint([...set.members].reverse(), null)).toBe(print);
    const reversed = computeNotices(
      {
        ...data,
        trainings: [...data.trainings].reverse(),
        sessions: [...data.sessions].reverse(),
        members: [...data.members].reverse(),
        addresses: [...data.addresses].reverse()
      },
      TK
    );
    expect(fingerprint(reversed.members, null)).toBe(print);

    const moved = computeNotices(
      { ...data, sessions: [session(1, monday(3), 20, { topic: 'Kata' }), data.sessions[1]] },
      TK
    );
    expect(fingerprint(moved.members, null)).not.toBe(print);
    const renamed = computeNotices(
      {
        ...data,
        members: MEMBERS.map((m) => (m.id === 30 ? { ...m, lastname: 'Keller-Frei' } : m))
      },
      TK
    );
    expect(fingerprint(renamed.members, null)).not.toBe(print);
    const topic = computeNotices(
      { ...data, sessions: [session(1, monday(1), 20, { topic: 'Randori' }), data.sessions[1]] },
      TK
    );
    expect(fingerprint(topic.members, null)).not.toBe(print);

    const anna = [member(set, 20)!];
    expect(fingerprint(anna, 'anna@test.ch')).not.toBe(fingerprint(anna, 'familie@test.ch'));
    expect(fingerprint(anna, null)).not.toBe(fingerprint(anna, 'anna@test.ch'));
  });

  it('28: only dates up to 400 days ahead are compared', () => {
    const to = addDays(TODAY, MAIL_DAYS_AHEAD);
    const beyond = addDays(TODAY, 401);
    const inside = wednesday(56);
    expect(inside <= to && beyond > to).toBe(true);
    const set = notices(plan({ sessions: [session(2, beyond, 20), session(2, inside, 30)] }));
    expect(member(set, 20)).toBeUndefined();
    expect(brief(set, 30)).toEqual([`lead ${inside}`]);

    // A told date after the window is not looked at either
    const later = notices(
      plan({
        toldTrainings: [
          {
            member_id: 20,
            training_id: 2,
            is_main: false,
            title: 'Judo Mittwoch',
            weekday: 'Wednesday',
            time_from: '18:30',
            time_to: '20:00',
            told_at: '2026-10-01T10:00Z'
          }
        ],
        toldDates: [{ member_id: 20, training_id: 2, date: addDays(beyond, 7), state: 'lead' }]
      })
    );
    expect(member(later, 20)).toBeUndefined();
  });

  it('29: a training without a known weekday has no dates and does not fail', () => {
    for (const weekday of [null, 'Montag']) {
      const set = notices(
        plan({
          trainings: [t2(), t1({ id: 3, weekday: weekday as unknown as string, mainTrainerId: 50 })]
        })
      );
      expect(brief(set, 50)).toEqual(['main_new']);
      expect(member(set, 50)!.told.trainings[0].weekday).toBe(weekday);
      expect(member(set, 50)!.told.dates).toEqual([]);
    }
  });

  it('30: the told payload covers told and current trainings, with the dates by role', () => {
    const baseline = told(
      plan({
        trainings: [t1(), t2({ mainTrainerId: 50 })],
        sessions: [session(2, wednesday(1), 10)]
      })
    );
    const set = notices({
      ...baseline,
      trainings: [t1(), t2({ mainTrainerId: 50 })],
      sessions: [
        session(1, monday(1), 30),
        session(1, monday(2), null, { cancelled: true }),
        session(2, wednesday(2), 10),
        session(2, wednesday(3), 10, { cancelled: true })
      ]
    });
    const max = member(set, 10)!;
    expect(max.told).toEqual({
      member_id: 10,
      training_ids: [1, 2],
      trainings: [
        expect.objectContaining({ training_id: 1, is_main: true }),
        expect.objectContaining({ training_id: 2, is_main: false, time_from: '18:30' })
      ],
      dates: [
        { training_id: 1, date: monday(1), state: 'not_lead' },
        { training_id: 1, date: monday(2), state: 'cancelled' },
        { training_id: 2, date: wednesday(2), state: 'lead' },
        { training_id: 2, date: wednesday(3), state: 'cancelled' }
      ]
    });
    expect(brief(set, 10)).toEqual([
      `not_lead ${monday(1)}`,
      `cancelled ${monday(2)}`,
      `not_lead ${wednesday(1)}`,
      `lead ${wednesday(2)}`
    ]);
    // Monday before Wednesday, whatever the order of the data
    expect(max.trainings.map((t) => t.trainingId)).toEqual([1, 2]);
  });

  it('31: a substitute made main trainer hears of every dropped date, also those told as dropped', () => {
    const breaks = [closing('Weihnachten', monday(7), addDays(monday(8), 6))];
    // Anna leads 16.11. and 28.12. (closed); the TK cancels 23.11. before any mail
    const before = told(
      plan({
        sessions: [
          session(1, monday(2), 20),
          session(1, monday(3), 20, { cancelled: true }),
          session(1, monday(8), 20)
        ],
        breaks
      })
    );
    expect(before.toldDates.filter((d) => d.member_id === 20)).toEqual([
      { member_id: 20, training_id: 1, date: monday(2), state: 'lead' },
      { member_id: 20, training_id: 1, date: monday(3), state: 'cancelled' },
      { member_id: 20, training_id: 1, date: monday(8), state: 'cancelled' }
    ]);
    const promoted = notices({
      ...before,
      trainings: [t1({ mainTrainerId: 20 }), t2()],
      sessions: [session(1, monday(3), null, { cancelled: true })]
    });
    expect(brief(promoted, 20)).toEqual([
      'main_new',
      `cancelled ${monday(3)}`,
      `cancelled ${monday(7)}`,
      `cancelled ${monday(8)}`
    ]);
    expect(memberBlocks(member(promoted, 20)!, 'de')[0].lines).toEqual([
      'Du bist neu Haupttrainer/in und leitest alle Termine, ausser:',
      'Fällt aus: Mo 23.11.2026',
      'Fällt aus (Weihnachten): 21.12., 28.12.2026'
    ]);

    // Told "Fällt aus" as a substitute: the overview says it again
    const toldCancel = told({
      ...told(plan({ sessions: [session(1, monday(3), 20)] })),
      sessions: [session(1, monday(3), 20, { cancelled: true })]
    });
    const again = notices({
      ...toldCancel,
      trainings: [t1({ mainTrainerId: 20 }), t2()]
    });
    expect(brief(again, 20)).toEqual(['main_new', `cancelled ${monday(3)}`]);
  });

  it('32: a mail whose outcome is unknown marks its members until they are told', () => {
    const data = plan({ sessions: [session(1, monday(1), 20)] });
    const unclear = (d: MailPlanData) =>
      computeNotices(d, TK).members.map((m) => [m.memberId, m.unclearSince]);
    expect(unclear(data)).toEqual([
      [20, null],
      [10, null]
    ]);
    // Never told: any pending row counts, the newest wins
    const pending = {
      ...data,
      pendingMails: [
        { member_id: 20, created_at: '2026-11-02T08:00:00+00:00' },
        { member_id: 20, created_at: '2026-11-02T09:00:00.123456+00:00' }
      ]
    };
    expect(unclear(pending)).toEqual([
      [20, '2026-11-02T09:00:00.123456+00:00'],
      [10, null]
    ]);
    // Part of the fingerprint: a preview from before a send elsewhere is stale
    const anna = (d: MailPlanData) =>
      computeNotices(d, TK).members.filter((m) => m.memberId === 20);
    expect(fingerprint(anna(pending), 'anna@test.ch')).not.toBe(
      fingerprint(anna(data), 'anna@test.ch')
    );

    // Told after the pending row (marked, or a later mail): no longer unclear
    const baseline = told(data);
    const changed = { ...baseline, sessions: [session(1, monday(2), 20)] };
    const toldAt = (d: MailPlanData, at: string) => ({
      ...d,
      toldTrainings: d.toldTrainings.map((t) => ({ ...t, told_at: at }))
    });
    expect(
      unclear({
        ...toldAt(changed, '2026-11-02T10:00:00+00:00'),
        pendingMails: [{ member_id: 20, created_at: '2026-11-02T09:59:59+00:00' }]
      })
    ).toEqual([
      [20, null],
      [10, null]
    ]);
    // A pending row after the last telling: unclear, the lines unchanged
    const after = {
      ...toldAt(changed, '2026-11-02T10:00:00+00:00'),
      pendingMails: [{ member_id: 20, created_at: '2026-11-02T10:00:01+00:00' }]
    };
    expect(unclear(after)).toEqual([
      [20, '2026-11-02T10:00:01+00:00'],
      [10, null]
    ]);
    expect(lines(computeNotices(after, TK), 20)).toEqual(lines(computeNotices(changed, TK), 20));
  });
});
