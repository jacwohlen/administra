import { describe, expect, it } from 'vitest';
import type { PlanTraining } from '$lib/trainingPlanUtils';
import {
  applyLeaderChoice,
  buildBreakWrites,
  buildPlanWrites,
  dateSpan,
  initialHolidayInputs,
  initialPlanInputs,
  leaderKey,
  matchLeaders,
  mergeSession,
  resolveTraining,
  reviewHolidays,
  reviewPlan,
  rowValues,
  setRowTrainer,
  skipIncomplete,
  skipIncompleteHolidays,
  summarizePlan,
  withLeaderNote,
  writeInPortions,
  type PlanReviewContext,
  type PlanReviewInput,
  type PlanReviewMember,
  type PlannedBreak,
  type PlannedSession
} from './trainingPlan';
import type { HolidayEntry, PlanSessionEntry } from './types';

// The planned adult trainings; Wednesday has two, so a Wednesday row needs a pick
const trainings: PlanTraining[] = [
  { id: 27, title: 'Judo Kampftraining', weekday: 'Monday', dateFrom: '20:00', section: 'Judo' },
  { id: 25, title: 'Ju-Jitsu', weekday: 'Wednesday', dateFrom: '18:30', section: 'Ju-Jitsu' },
  { id: 26, title: 'Judo Randori', weekday: 'Wednesday', dateFrom: '20:00', section: 'Judo' },
  { id: 23, title: 'Judo Techniktraining', weekday: 'Friday', dateFrom: '20:00', section: 'Judo' }
];

const members: PlanReviewMember[] = [
  { id: 1, firstname: 'Benjamin', lastname: 'Muster', trainer: true },
  { id: 2, firstname: 'Lara', lastname: 'Beispiel', trainer: true },
  { id: 3, firstname: 'Bea', lastname: 'Muster', trainer: false },
  { id: 4, firstname: 'Roland', lastname: 'Keller', trainer: true },
  { id: 5, firstname: 'Rolf', lastname: 'Keller', trainer: false },
  { id: 6, firstname: 'Hans', lastname: 'Meier', trainer: true }
];

function session(values: Partial<PlanSessionEntry> & { date: string }): PlanSessionEntry {
  return {
    trainingId: null,
    trainingAsWritten: '',
    trainer: '',
    topic: '',
    notes: '',
    cancelled: false,
    confidence: 'high',
    remark: '',
    ...values
  };
}

// January 2026 as the model read it from a photo of the TK's plan
const SESSIONS: PlanSessionEntry[] = [
  session({
    date: '2026-01-05',
    trainingId: 27,
    trainingAsWritten: 'Kampftraining',
    trainer: 'Beni Muster',
    topic: 'Topwurf'
  }),
  session({
    date: '2026-01-07',
    trainingId: 26,
    trainingAsWritten: 'Randori',
    trainer: 'Lara Beispiel',
    notes: 'SMM Training 1'
  }),
  session({
    date: '2026-01-09',
    trainingId: 23,
    trainingAsWritten: 'kein Training',
    notes: 'Gesamt Trainersitzung',
    cancelled: true
  }),
  session({
    date: '2026-01-12',
    trainingAsWritten: 'Kampftraining',
    trainer: 'Gast Trainerin',
    topic: 'Topwurf, Teil 2'
  }),
  session({
    date: '2026-01-14',
    trainingAsWritten: 'Training',
    trainer: 'Lara Beispiel',
    topic: 'Bodenarbeit'
  }),
  session({ date: '2026-01-16', trainingId: 23, trainer: 'Roli Keller', topic: 'Nage-no-kata' }),
  session({ date: '2026-01-19', trainingId: 26, trainer: 'Hans Meier', topic: 'Randori' }),
  session({
    date: '2026-01-05',
    trainingId: 27,
    trainer: 'Benjamin Muster',
    topic: 'Topwurf',
    confidence: 'low',
    remark: 'Zeile doppelt?'
  }),
  session({ date: '2026-01-21', trainingId: 26, trainer: '-' }),
  session({ date: '2026-01-23', trainingId: 23, trainer: 'Lara Beispiel', topic: 'Ne-waza' })
];

function planned(
  id: number,
  training_id: number,
  date: string,
  values: Partial<PlannedSession> = {}
): PlannedSession {
  return {
    id,
    training_id,
    date,
    trainer_id: null,
    topic: null,
    notes: null,
    cancelled: null,
    ...values
  };
}

const PLANNED: PlannedSession[] = [
  planned(101, 26, '2026-01-07', { trainer_id: 2, topic: 'Randori' }),
  planned(102, 23, '2026-01-09', { trainer_id: 6, topic: 'Kata' }),
  planned(103, 23, '2026-01-23', { trainer_id: 2, topic: 'Ne-waza' })
];

const leaders = matchLeaders(SESSIONS, members);

function context(values: Partial<PlanReviewContext> = {}): PlanReviewContext {
  return {
    trainings,
    members,
    planned: { from: '2026-01-05', to: '2026-01-23', sessions: PLANNED },
    breaks: [],
    leaders,
    confirmed: new Set(),
    today: '2026-01-02',
    ...values
  };
}

function review(inputs: PlanReviewInput[], values: Partial<PlanReviewContext> = {}) {
  return reviewPlan(SESSIONS, inputs, context(values));
}

const initial = () => initialPlanInputs(SESSIONS, trainings, leaders);

describe('the training of a session', () => {
  it('takes the model’s training if it is planned', () => {
    expect(resolveTraining({ date: '2026-01-05', trainingId: 27 }, trainings)).toEqual({
      trainingId: 27,
      guessed: false
    });
  });

  it('falls back to the only planned training of the weekday', () => {
    expect(resolveTraining({ date: '2026-01-12', trainingId: null }, trainings)).toEqual({
      trainingId: 27,
      guessed: true
    });
    // Not one of the planned trainings
    expect(resolveTraining({ date: '2026-01-09', trainingId: 99 }, trainings)).toEqual({
      trainingId: 23,
      guessed: true
    });
  });

  it('leaves the pick to the user when the weekday has none or several', () => {
    expect(resolveTraining({ date: '2026-01-14', trainingId: null }, trainings).trainingId).toBe(
      null
    );
    expect(resolveTraining({ date: '2026-01-13', trainingId: null }, trainings).trainingId).toBe(
      null
    );
    expect(resolveTraining({ date: '2026-02-31', trainingId: null }, trainings).trainingId).toBe(
      null
    );
  });
});

describe('the leaders', () => {
  it('groups the written names, leaving out entries that name nobody', () => {
    expect(leaderKey('-')).toBe('');
    expect(leaderKey('kein Training')).toBe('');
    expect(leaderKey('N.N.')).toBe('');
    expect(leaderKey(' Lara  Beispiel ')).toBe(leaderKey('lara beispiel'));
    expect([...leaders.keys()]).toEqual([
      'beni muster',
      'lara beispiel',
      'gast trainerin',
      'roli keller',
      'hans meier',
      'benjamin muster'
    ]);
    expect(leaders.get('lara beispiel')?.count).toBe(3);
  });

  it('takes clear names, suggests close ones and keeps the rest without a member', () => {
    expect(leaders.get('beni muster')).toMatchObject({ memberId: 1, kind: 'auto' });
    expect(leaders.get('hans meier')).toMatchObject({ memberId: 6, kind: 'auto' });
    // Roland and Rolf Keller both fit; the trainer is suggested, not taken
    expect(leaders.get('roli keller')).toMatchObject({ memberId: 4, kind: 'suggested' });
    expect(leaders.get('gast trainerin')).toMatchObject({ memberId: null, kind: 'none' });
  });

  it('keeps a name without a member in the notes, like the sheet import', () => {
    expect(withLeaderNote('', 'Gast Trainerin', true)).toBe('Gast Trainerin');
    expect(withLeaderNote('SMM Training 1', 'Gast Trainerin', true)).toBe(
      'Gast Trainerin, SMM Training 1'
    );
    expect(withLeaderNote('Gast Trainerin, SMM Training 1', 'Gast Trainerin', true)).toBe(
      'Gast Trainerin, SMM Training 1'
    );
    expect(withLeaderNote('Gast Trainerin, SMM Training 1', 'Gast Trainerin', false)).toBe(
      'SMM Training 1'
    );
    expect(withLeaderNote('Gast Trainerin', 'Gast Trainerin', false)).toBe('');
    expect(withLeaderNote('Leiter Sitzung', 'Gast Trainerin', false)).toBe('Leiter Sitzung');
  });

  it('moves the name out of the notes once a member is chosen for a row', () => {
    const inputs = initial();
    expect(inputs[3].notes).toBe('Gast Trainerin');
    const chosen = setRowTrainer(SESSIONS[3], inputs[3], 6);
    expect(chosen).toMatchObject({ trainerId: 6, notes: '' });
    expect(setRowTrainer(SESSIONS[3], chosen, null).notes).toBe('Gast Trainerin');
  });

  it('applies a new choice for a name to the rows that still follow it', () => {
    const inputs = initial();
    inputs[9] = setRowTrainer(SESSIONS[9], inputs[9], 6);
    const next = applyLeaderChoice(SESSIONS, inputs, 'lara beispiel', 2, null);
    expect(next[1]).toMatchObject({ trainerId: null, notes: 'Lara Beispiel, SMM Training 1' });
    expect(next[4]).toMatchObject({ trainerId: null, notes: 'Lara Beispiel' });
    // Changed on its own: stays
    expect(next[9].trainerId).toBe(6);
    expect(next[0]).toBe(inputs[0]);
  });
});

describe('the first proposal', () => {
  it('fills in training, trainer and notes', () => {
    const inputs = initial();
    expect(inputs[0]).toEqual({
      date: '2026-01-05',
      trainingId: 27,
      trainerId: 1,
      topic: 'Topwurf',
      notes: '',
      cancelled: false,
      skip: false,
      overwrite: false
    });
    expect(inputs[3]).toMatchObject({ trainingId: 27, trainerId: null, notes: 'Gast Trainerin' });
    expect(inputs[4].trainingId).toBeNull();
    expect(inputs[5].trainerId).toBe(4);
  });

  it('skips dates with nothing on them', () => {
    const inputs = initial();
    expect(inputs[8].skip).toBe(true);
    expect(inputs.filter((i) => i.skip)).toHaveLength(1);
  });

  it('keeps what a dropped session says in the notes', () => {
    const [input] = initialPlanInputs(
      [
        session({
          date: '2026-02-13',
          trainingId: 23,
          topic: 'Sportferien',
          notes: 'Halle zu',
          cancelled: true
        })
      ],
      trainings,
      new Map()
    );
    expect(input).toMatchObject({ topic: '', notes: 'Sportferien, Halle zu', cancelled: true });
  });
});

describe('comparing with the plan', () => {
  it('gives every row its status', () => {
    const rows = review(initial());
    expect(rows.map((r) => r.status)).toEqual([
      'new',
      'fill',
      'changed',
      'new',
      'invalid',
      'invalid',
      'invalid',
      'duplicate',
      'invalid',
      'exists'
    ]);
    expect(rows[7].duplicateOf).toBe(0);
    expect(rows[9].existing?.id).toBe(103);
  });

  it('writes new sessions with exactly the columns of the sheet import', () => {
    const rows = review(initial());
    expect(rows[0].write).toEqual({
      training_id: 27,
      date: '2026-01-05',
      trainer_id: 1,
      topic: 'Topwurf',
      notes: null,
      cancelled: null
    });
    expect(rows[3].write).toEqual({
      training_id: 27,
      date: '2026-01-12',
      trainer_id: null,
      topic: 'Topwurf, Teil 2',
      notes: 'Gast Trainerin',
      cancelled: null
    });
    expect(rows[3].warnings.map((w) => w.code)).toEqual(['trainingGuessed', 'trainerUnmatched']);
  });

  it('completes a planned session without touching its values', () => {
    const [, row] = review(initial());
    expect(row.changes).toEqual([
      { field: 'notes', from: null, to: 'SMM Training 1', conflict: false }
    ]);
    expect(row.write).toEqual({
      training_id: 26,
      date: '2026-01-07',
      trainer_id: 2,
      topic: 'Randori',
      notes: 'SMM Training 1',
      cancelled: null
    });
  });

  it('replaces a planned session only when the user opts in', () => {
    const inputs = initial();
    const before = review(inputs)[2];
    expect(before.write).toBeNull();
    expect(before.blocking).toBe(false);
    expect(before.changes).toEqual([
      { field: 'trainer', from: 6, to: null, conflict: true },
      { field: 'topic', from: 'Kata', to: null, conflict: true },
      { field: 'notes', from: null, to: 'Gesamt Trainersitzung', conflict: false },
      { field: 'cancelled', from: null, to: true, conflict: true }
    ]);
    inputs[2] = { ...inputs[2], overwrite: true };
    expect(review(inputs)[2].write).toEqual({
      training_id: 23,
      date: '2026-01-09',
      trainer_id: null,
      topic: null,
      notes: 'Gesamt Trainersitzung',
      cancelled: true
    });
  });

  it('flags what the user has to fix', () => {
    const rows = review(initial());
    expect(rows[4].errors).toEqual([{ code: 'noTraining' }]);
    expect(rows[5].errors).toEqual([
      { code: 'trainerUnconfirmed', name: 'Roli Keller', memberId: 4 }
    ]);
    expect(rows[6].errors).toEqual([
      { code: 'weekday', trainingWeekday: 'Wednesday', dateWeekday: 'Monday' }
    ]);
    expect(rows.filter((r) => r.blocking).map((r) => rows.indexOf(r))).toEqual([4, 5, 6]);
    // Skipped: shown, never blocking
    expect(rows[8]).toMatchObject({ status: 'invalid', blocking: false, write: null });
    expect(rows[8].errors).toEqual([{ code: 'empty' }]);
  });

  it('does not keep the planned trainer when the document names someone else', () => {
    // Planned: Lara leads; the document has a guest trainer nobody matched
    const sessions = [session({ date: '2026-01-12', trainingId: 27, trainer: 'Gast Trainerin' })];
    const ctx = context({
      leaders: matchLeaders(sessions, members),
      planned: {
        from: '2026-01-12',
        to: '2026-01-12',
        sessions: [planned(104, 27, '2026-01-12', { trainer_id: 2, topic: 'Topwurf' })]
      }
    });
    const inputs = initialPlanInputs(sessions, trainings, ctx.leaders);
    const [before] = reviewPlan(sessions, inputs, ctx);
    expect(before).toMatchObject({ status: 'changed', write: null, blocking: false });
    expect(before.changes).toEqual([
      { field: 'trainer', from: 2, to: null, conflict: true },
      { field: 'notes', from: null, to: 'Gast Trainerin', conflict: false }
    ]);
    const [after] = reviewPlan(sessions, [{ ...inputs[0], overwrite: true }], ctx);
    expect(after.write).toEqual({
      training_id: 27,
      date: '2026-01-12',
      trainer_id: null,
      topic: 'Topwurf',
      notes: 'Gast Trainerin',
      cancelled: null
    });
    // Once the user picks Lara for the name, the plan already says so
    const chosen = setRowTrainer(sessions[0], inputs[0], 2);
    expect(reviewPlan(sessions, [chosen], ctx)[0].status).toBe('exists');
  });

  it('drops a session with only a planned note just on opt-in', () => {
    const sessions = [session({ date: '2026-01-21', trainingId: 26, cancelled: true })];
    const ctx = context({
      planned: {
        from: '2026-01-21',
        to: '2026-01-21',
        sessions: [planned(105, 26, '2026-01-21', { notes: 'SMM Training 2' })]
      }
    });
    const [row] = reviewPlan(sessions, initialPlanInputs(sessions, trainings, new Map()), ctx);
    expect(row).toMatchObject({ status: 'changed', write: null });
    expect(row.changes).toEqual([{ field: 'cancelled', from: null, to: true, conflict: true }]);
  });

  it('accepts a suggested trainer once the user confirms the name', () => {
    const row = review(initial(), { confirmed: new Set(['roli keller']) })[5];
    expect(row.status).toBe('new');
    expect(row.write?.trainer_id).toBe(4);
  });

  it('accepts a fixed row', () => {
    const inputs = initial();
    inputs[4] = { ...inputs[4], trainingId: 26 };
    inputs[6] = { ...inputs[6], date: '2026-01-21' };
    const rows = review(inputs);
    expect(rows[4]).toMatchObject({ status: 'new', blocking: false });
    expect(rows[6]).toMatchObject({ status: 'new', blocking: false });
    expect(rows[6].write?.date).toBe('2026-01-21');
  });

  it('shows the cleaned values a row stands for', () => {
    const inputs = initial();
    inputs[0] = { ...inputs[0], topic: '  =Topwurf   links ' };
    inputs[2] = { ...inputs[2], trainerId: 1, topic: 'Kata' };
    const rows = review(inputs);
    expect(rowValues(rows[0])).toEqual({
      trainer_id: 1,
      topic: 'Topwurf links',
      notes: null,
      cancelled: null
    });
    // Not written (no opt-in): what the row says, a drop without trainer and topic
    expect(rowValues(rows[2])).toEqual({
      trainer_id: null,
      topic: null,
      notes: 'Gesamt Trainersitzung',
      cancelled: true
    });
  });

  it('skips all rows that still need a fix at once', () => {
    const inputs = initial();
    const rows = review(inputs);
    const next = skipIncomplete(rows, inputs);
    expect(next.map((input, i) => input.skip !== inputs[i].skip)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false
    ]);
    expect(review(next).filter((r) => r.blocking)).toEqual([]);
    // Rows only waiting for the plan stay as they are
    const waiting = review(inputs, { planned: null });
    expect(skipIncomplete(waiting, inputs)[9].skip).toBe(false);
  });

  it('never writes a skipped row', () => {
    const inputs = initial();
    inputs[0] = { ...inputs[0], skip: true };
    const rows = review(inputs);
    expect(rows[0].write).toBeNull();
    // The second row of the date counts now
    expect(rows[7]).toMatchObject({ status: 'new', duplicateOf: null });
  });

  it('waits for the plan of the dates before writing anything', () => {
    expect(review(initial(), { planned: null }).every((r) => r.write === null)).toBe(true);
    const rows = review(initial(), {
      planned: { from: '2026-01-05', to: '2026-01-12', sessions: PLANNED }
    });
    expect(rows[0].checked).toBe(true);
    expect(rows[9]).toMatchObject({ checked: false, blocking: true, write: null });
  });

  it('warns when the dojo is closed that day or the year looks misread', () => {
    const breaks: PlannedBreak[] = [
      {
        title: 'Dojo geschlossen',
        date_from: '2026-01-12',
        date_to: '2026-01-12',
        cancels_training: true
      },
      {
        title: 'Sportferien',
        date_from: '2026-01-05',
        date_to: '2026-01-07',
        cancels_training: false
      }
    ];
    const rows = review(initial(), { breaks, today: '2028-03-01' });
    expect(rows[3].warnings).toContainEqual({ code: 'closedBreak', title: 'Dojo geschlossen' });
    expect(rows[0].warnings).not.toContainEqual(expect.objectContaining({ code: 'closedBreak' }));
    expect(rows[0].warnings).toContainEqual({ code: 'unusualYear' });
    expect(review(initial())[0].warnings).toEqual([]);
  });
});

describe('mergeSession', () => {
  const values = { trainer_id: null, topic: null, notes: null, cancelled: false };

  it('keeps a session held while the dojo is closed', () => {
    const merged = mergeSession(
      { ...values, topic: 'Kata' },
      planned(1, 27, '2026-12-28', { trainer_id: 6, cancelled: false })
    );
    expect(merged.values).toEqual({ trainer_id: 6, topic: 'Kata', notes: null, cancelled: false });
    expect(merged.changes).toEqual([{ field: 'topic', from: null, to: 'Kata', conflict: false }]);
  });

  it('lets a planned training take place again only as a conflict', () => {
    const dropped = planned(1, 27, '2026-01-05', { cancelled: true, notes: 'Hallenputz' });
    const merged = mergeSession({ ...values, trainer_id: 1 }, dropped);
    expect(merged.values).toMatchObject({ trainer_id: 1, cancelled: null, notes: 'Hallenputz' });
    expect(merged.changes).toContainEqual({
      field: 'cancelled',
      from: true,
      to: null,
      conflict: true
    });
    // A note alone does not bring it back
    expect(mergeSession({ ...values, notes: 'Hallenputz' }, dropped).changes).toEqual([]);
  });

  it('treats different spacing as the same text', () => {
    const merged = mergeSession(
      { ...values, topic: 'Uchi-mata' },
      planned(1, 27, '2026-01-05', { topic: ' Uchi-mata ' })
    );
    expect(merged.changes).toEqual([]);
    expect(merged.values.topic).toBe(' Uchi-mata ');
  });

  it('writes a new session as true or null, never false', () => {
    expect(mergeSession({ ...values, trainer_id: 2 }, null).values.cancelled).toBeNull();
    expect(mergeSession({ ...values, cancelled: true }, null).values.cancelled).toBe(true);
  });
});

describe('buildPlanWrites', () => {
  it('writes the ready rows, each training and date once', () => {
    const inputs = initial();
    inputs[2] = { ...inputs[2], overwrite: true };
    const writes = buildPlanWrites(review(inputs), { trainings, members });
    expect(writes.map((w) => `${w.training_id}|${w.date}`)).toEqual([
      '27|2026-01-05',
      '26|2026-01-07',
      '23|2026-01-09',
      '27|2026-01-12'
    ]);
    for (const w of writes) {
      expect(Object.keys(w).sort()).toEqual([
        'cancelled',
        'date',
        'notes',
        'topic',
        'trainer_id',
        'training_id'
      ]);
    }
  });

  it('drops rows that do not fit the plan, whatever they claim', () => {
    const rows = review(initial());
    const tampered = [
      { ...rows[0], write: { ...rows[0].write!, training_id: 99 } },
      { ...rows[0], write: { ...rows[0].write!, trainer_id: 42 } },
      { ...rows[0], write: { ...rows[0].write!, date: '2026-02-30' } },
      { ...rows[0], write: { ...rows[0].write!, date: '2026-01-06' } },
      { ...rows[0], blocking: true },
      rows[0],
      rows[0]
    ];
    expect(buildPlanWrites(tampered, { trainings, members })).toEqual([rows[0].write]);
  });

  it('keeps a planned trainer who is not on the list any more', () => {
    const rows = reviewPlan(
      [session({ date: '2026-01-07', trainingId: 26, notes: 'SMM Training 2' })],
      [
        {
          date: '2026-01-07',
          trainingId: 26,
          trainerId: null,
          topic: '',
          notes: 'SMM Training 2',
          cancelled: false,
          skip: false,
          overwrite: false
        }
      ],
      context({
        planned: {
          from: '2026-01-07',
          to: '2026-01-07',
          sessions: [planned(101, 26, '2026-01-07', { trainer_id: 77 })]
        }
      })
    );
    expect(rows[0].status).toBe('fill');
    expect(buildPlanWrites(rows, { trainings, members })[0].trainer_id).toBe(77);
  });
});

const BREAKS: PlannedBreak[] = [
  { title: 'Weihnachten', date_from: '2025-12-24', date_to: '2026-01-04', cancels_training: true },
  {
    title: 'Sportferien Kinder',
    date_from: '2026-02-09',
    date_to: '2026-02-13',
    cancels_training: false
  }
];

const HOLIDAYS: HolidayEntry[] = [
  { title: 'Sportferien', dateFrom: '2026-02-07', dateTo: '2026-02-22', closed: false },
  { title: 'weihnachten', dateFrom: '2025-12-24', dateTo: '2026-01-04', closed: true },
  { title: 'Sportferien', dateFrom: '2026-02-07', dateTo: '2026-02-22', closed: false },
  { title: 'Fasnacht', dateFrom: '2026-02-16', dateTo: '2026-02-18', closed: true }
];

describe('holidays', () => {
  it('leaves out what is recorded already', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    expect(inputs.map((i) => i.use)).toEqual([true, false, true, true]);
  });

  it('adds each period once, with cancels_training always set', () => {
    const rows = reviewHolidays(HOLIDAYS, initialHolidayInputs(HOLIDAYS, BREAKS), BREAKS);
    expect(rows.map((r) => r.status)).toEqual(['new', 'exists', 'duplicate', 'new']);
    expect(rows[2].duplicateOf).toBe(0);
    expect(rows[0].overlaps).toEqual([BREAKS[1]]);
    expect(buildBreakWrites(rows)).toEqual([
      {
        title: 'Sportferien',
        date_from: '2026-02-07',
        date_to: '2026-02-22',
        cancels_training: false
      },
      { title: 'Fasnacht', date_from: '2026-02-16', date_to: '2026-02-18', cancels_training: true }
    ]);
  });

  it('blocks a period the user wants but that is incomplete', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    inputs[3] = { ...inputs[3], title: ' ', dateTo: '2026-02-10' };
    const rows = reviewHolidays(HOLIDAYS, inputs, BREAKS);
    expect(rows[3]).toMatchObject({ status: 'invalid', blocking: true, write: null });
    expect(rows[3].errors).toEqual([{ code: 'noTitle' }, { code: 'badDates' }]);
    inputs[3] = { ...inputs[3], use: false };
    expect(reviewHolidays(HOLIDAYS, inputs, BREAKS)[3].blocking).toBe(false);
  });

  it('leaves out incomplete periods at once, keeping the others', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    inputs[3] = { ...inputs[3], dateFrom: '' };
    const next = skipIncompleteHolidays(reviewHolidays(HOLIDAYS, inputs, BREAKS), inputs);
    expect(next.map((i) => i.use)).toEqual([true, false, true, false]);
    expect(buildBreakWrites(reviewHolidays(HOLIDAYS, next, BREAKS))).toHaveLength(1);
  });
});

describe('summarizePlan', () => {
  it('counts what is written and what still needs a fix', () => {
    const holidays = reviewHolidays(HOLIDAYS, initialHolidayInputs(HOLIDAYS, BREAKS), BREAKS);
    const summary = summarizePlan(review(initial()), holidays);
    expect(summary).toEqual({
      sessions: 3,
      breaks: 2,
      blocking: 3,
      waiting: 0,
      cancelled: 0,
      byStatus: { new: 2, exists: 1, fill: 1, changed: 1, duplicate: 1, invalid: 4 }
    });
    expect(summarizePlan(review(initial(), { planned: null }), []).waiting).toBe(9);
  });

  it('spans the valid dates', () => {
    expect(dateSpan(['2026-01-12', '', '2026-01-05', '2026-02-30'])).toEqual({
      from: '2026-01-05',
      to: '2026-01-12'
    });
    expect(dateSpan(['2026-13-01'])).toBeNull();
  });
});

describe('writeInPortions', () => {
  it('retries a failed portion row by row and reports the failures', async () => {
    const calls: number[][] = [];
    const progress: number[] = [];
    const outcome = await writeInPortions(
      [1, 2, 3, 4, 5],
      2,
      async (portion) => {
        calls.push(portion);
        return !portion.includes(3);
      },
      (done) => progress.push(done)
    );
    expect(outcome).toEqual({ saved: [1, 2, 4, 5], failed: [3] });
    expect(calls).toEqual([[1, 2], [3, 4], [3], [4], [5]]);
    expect(progress.at(-1)).toBe(5);
  });
});
