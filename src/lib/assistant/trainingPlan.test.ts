import { describe, expect, it } from 'vitest';
import type { PlanTraining } from '$lib/trainingPlanUtils';
import {
  applyLeaderChoice,
  buildBreakWrites,
  buildPlanWrites,
  confirmTraining,
  dateSpan,
  holidayRowsOf,
  initialHolidayInputs,
  initialPlanInputs,
  insertBreaks,
  leaderKey,
  markSaved,
  matchLeaders,
  mergeSession,
  resolveTraining,
  reviewHolidays,
  reviewPlan,
  rowValues,
  sessionRowsOf,
  setRowTrainer,
  setRowTraining,
  skipIncomplete,
  skipIncompleteHolidays,
  summarizePlan,
  trainingGuessGroup,
  withLeaderNote,
  writeInPortions,
  type PlanBreakWrite,
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
    trainer: 'Benjamin Muster',
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
      'benjamin muster',
      'lara beispiel',
      'gast trainerin',
      'roli keller',
      'hans meier'
    ]);
    expect(leaders.get('lara beispiel')?.count).toBe(3);
  });

  it('takes clear names, suggests close ones and keeps the rest without a member', () => {
    expect(leaders.get('benjamin muster')).toMatchObject({ memberId: 1, kind: 'auto' });
    expect(leaders.get('hans meier')).toMatchObject({ memberId: 6, kind: 'auto' });
    // Roland and Rolf Keller both fit; the trainer is suggested, not taken
    expect(leaders.get('roli keller')).toMatchObject({ memberId: 4, kind: 'suggested' });
    expect(leaders.get('gast trainerin')).toMatchObject({ memberId: null, kind: 'none' });
  });

  it('keeps a name without a member in the notes', () => {
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
      trainingGuess: null,
      trainerId: 1,
      topic: 'Topwurf',
      notes: '',
      cancelled: false,
      skip: false,
      overwrite: false,
      saved: false
    });
    // Taken by the weekday: to be confirmed
    expect(inputs[3]).toMatchObject({
      trainingId: 27,
      trainingGuess: 'open',
      trainerId: null,
      notes: 'Gast Trainerin'
    });
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
      'invalid',
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

  it('writes new sessions with exactly the columns of training_plan_sessions', () => {
    const rows = review(confirmTraining(review(initial()), initial(), 3));
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
    expect(rows[3].warnings.map((w) => w.code)).toEqual(['trainerUnmatched']);
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
    expect(rows[3].errors).toEqual([{ code: 'trainingUnconfirmed' }]);
    expect(rows[4].errors).toEqual([{ code: 'noTraining' }]);
    expect(rows[5].errors).toEqual([
      { code: 'trainerUnconfirmed', name: 'Roli Keller', memberId: 4 }
    ]);
    expect(rows[6].errors).toEqual([
      { code: 'weekday', trainingWeekday: 'Wednesday', dateWeekday: 'Monday' }
    ]);
    expect(rows.filter((r) => r.blocking).map((r) => rows.indexOf(r))).toEqual([3, 4, 5, 6]);
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
      true,
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
    const inputs = confirmTraining(review(initial()), initial(), 3);
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
          trainingGuess: null,
          trainerId: null,
          topic: '',
          notes: 'SMM Training 2',
          cancelled: false,
          skip: false,
          overwrite: false,
          saved: false
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
  it('leaves out what is recorded already or overlaps it', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    // Sportferien overlap the recorded Sportferien Kinder: only on a tick
    expect(inputs.map((i) => i.use)).toEqual([false, false, false, true]);
    expect(inputs[0]).toEqual({
      use: false,
      title: 'Sportferien',
      dateFrom: '2026-02-07',
      dateTo: '2026-02-22',
      closed: false,
      saved: false
    });
  });

  it('adds each period once, with cancels_training always set', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS).map((i) => ({ ...i, use: true }));
    const rows = reviewHolidays(HOLIDAYS, inputs, BREAKS);
    expect(rows.map((r) => r.status)).toEqual(['new', 'exists', 'duplicate', 'new']);
    expect(rows[2].duplicateOf).toBe(0);
    expect(rows[0].overlaps).toEqual([BREAKS[1]]);
    expect(rows[1].write).toBeNull();
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

  it('lists overlaps between the periods being added', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    // Only Fasnacht is added: nothing it overlaps is being added
    expect(reviewHolidays(HOLIDAYS, inputs, BREAKS)[3].overlapsRows).toEqual([]);
    inputs[0] = { ...inputs[0], use: true };
    inputs[2] = { ...inputs[2], use: true };
    const rows = reviewHolidays(HOLIDAYS, inputs, BREAKS);
    // Fasnacht lies within the Sportferien; the second Sportferien row is a duplicate, not an overlap
    expect(rows[3].overlapsRows).toEqual([0]);
    expect(rows[0].overlapsRows).toEqual([3]);
    expect(rows[2]).toMatchObject({ status: 'duplicate', overlapsRows: [3] });
  });

  it('needs a tick and shows the conflict when a closed dojo meets recorded school holidays', () => {
    const recorded: PlannedBreak[] = [
      {
        title: 'Herbstferien',
        date_from: '2026-10-03',
        date_to: '2026-10-18',
        cancels_training: false
      }
    ];
    const proposed: HolidayEntry[] = [
      { title: 'Herbstferien', dateFrom: '2026-10-05', dateTo: '2026-10-16', closed: true },
      {
        title: 'Herbstferien (Schule)',
        dateFrom: '2026-10-03',
        dateTo: '2026-10-18',
        closed: true
      },
      { title: 'Herbstlager', dateFrom: '2026-10-10', dateTo: '2026-10-11', closed: false }
    ];
    const inputs = initialHolidayInputs(proposed, recorded);
    expect(inputs.map((i) => i.use)).toEqual([false, false, false]);
    expect(buildBreakWrites(reviewHolidays(proposed, inputs, recorded))).toEqual([]);

    const ticked = inputs.map((i) => ({ ...i, use: true }));
    const rows = reviewHolidays(proposed, ticked, recorded);
    expect(rows.map((r) => r.status)).toEqual(['new', 'new', 'new']);
    expect(rows[0].closesOpen).toEqual(recorded);
    expect(rows[1].closesOpen).toEqual(recorded);
    // An open period does not override anything
    expect(rows[2]).toMatchObject({ overlaps: recorded, closesOpen: [] });
    expect(rows[0].overlapsRows).toEqual([1, 2]);
    // Without "dojo closed" there is no conflict, only the overlap
    ticked[0] = { ...ticked[0], closed: false };
    expect(reviewHolidays(proposed, ticked, recorded)[0].closesOpen).toEqual([]);
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

  it('never adds a holiday Webling maintains, but a closure within it', () => {
    const recorded: PlannedBreak[] = [
      {
        title: 'Herbstferien',
        date_from: '2026-10-03',
        date_to: '2026-10-18',
        cancels_training: false,
        connection: 'webling'
      }
    ];
    const proposed: HolidayEntry[] = [
      // Same dates, another title
      { title: 'Herbstferien Schule', dateFrom: '2026-10-03', dateTo: '2026-10-18', closed: false },
      // Same title, dates read a bit off
      { title: 'herbstferien', dateFrom: '2026-10-05', dateTo: '2026-10-16', closed: false },
      // The dojo closed for a weekend within them: the TK's own
      { title: 'Dojo zu', dateFrom: '2026-10-10', dateTo: '2026-10-11', closed: true }
    ];
    const ticked = initialHolidayInputs(proposed, recorded).map((i) => ({ ...i, use: true }));
    const rows = reviewHolidays(proposed, ticked, recorded);
    expect(rows.map((r) => r.status)).toEqual(['provider', 'provider', 'new']);
    expect(rows[0]).toMatchObject({ provider: recorded[0], overlaps: [], write: null });
    expect(rows[1].blocking).toBe(false);
    expect(rows[2]).toMatchObject({ overlaps: recorded, closesOpen: recorded });
    expect(buildBreakWrites(rows).map((w) => w.title)).toEqual(['Dojo zu']);
    // The TK's own holiday with the same title and dates is simply recorded
    const own = [{ ...recorded[0], connection: null }];
    expect(reviewHolidays(proposed, ticked, own)[0].status).toBe('new');
    expect(reviewHolidays(proposed.slice(1), ticked.slice(1), own)[0].status).toBe('new');
  });

  it('leaves out incomplete periods at once, keeping the others', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    inputs[0] = { ...inputs[0], use: true };
    inputs[3] = { ...inputs[3], dateFrom: '' };
    const next = skipIncompleteHolidays(reviewHolidays(HOLIDAYS, inputs, BREAKS), inputs);
    expect(next.map((i) => i.use)).toEqual([true, false, false, false]);
    expect(buildBreakWrites(reviewHolidays(HOLIDAYS, next, BREAKS))).toHaveLength(1);
  });
});

describe('summarizePlan', () => {
  it('counts what is written and what still needs a fix', () => {
    const holidays = reviewHolidays(HOLIDAYS, initialHolidayInputs(HOLIDAYS, BREAKS), BREAKS);
    const summary = summarizePlan(review(initial()), holidays);
    expect(summary).toEqual({
      sessions: 2,
      breaks: 1,
      blocking: 4,
      waiting: 0,
      cancelled: 0,
      byStatus: { new: 1, exists: 1, fill: 1, changed: 1, duplicate: 1, invalid: 5 }
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

describe('a training taken by the weekday', () => {
  // Only the adult Monday training is planned; the document also lists the
  // unplanned kids' group on the same evening, before the adult session
  const monday = [trainings[0]];
  const KIDS_FIRST: PlanSessionEntry[] = [
    session({
      date: '2026-01-05',
      trainingAsWritten: 'Judo Kinder 18:30',
      trainer: 'Anna Kind',
      topic: 'Fallschule'
    }),
    session({
      date: '2026-01-05',
      trainingId: 27,
      trainingAsWritten: 'Kampftraining',
      trainer: 'Benjamin Muster',
      topic: 'Topwurf'
    })
  ];
  const ctx = (values: Partial<PlanReviewContext> = {}) =>
    context({
      trainings: monday,
      leaders: matchLeaders(KIDS_FIRST, members),
      planned: { from: '2026-01-05', to: '2026-01-05', sessions: [] },
      ...values
    });
  const start = () => initialPlanInputs(KIDS_FIRST, monday, ctx().leaders);

  it('leaves the date to the row the document gave the training', () => {
    const rows = reviewPlan(KIDS_FIRST, start(), ctx());
    expect(rows[0]).toMatchObject({
      status: 'duplicate',
      duplicateOf: 1,
      blocking: false,
      write: null,
      errors: []
    });
    expect(rows[1]).toMatchObject({ status: 'new', duplicateOf: null, blocking: false });
    expect(buildPlanWrites(rows, { trainings: monday, members })).toEqual([
      {
        training_id: 27,
        date: '2026-01-05',
        trainer_id: 1,
        topic: 'Topwurf',
        notes: null,
        cancelled: null
      }
    ]);
    // Nothing to confirm there; and a confirmed guess does not take the date either
    expect(confirmTraining(rows, start(), 0)).toEqual(start());
    const inputs = start();
    inputs[0] = { ...inputs[0], trainingGuess: 'confirmed' };
    expect(reviewPlan(KIDS_FIRST, inputs, ctx()).map((r) => r.status)).toEqual([
      'duplicate',
      'new'
    ]);
  });

  it('never saves a guess unasked, also when the plan has the session half filled', () => {
    const kids = [KIDS_FIRST[0]];
    const leaders = matchLeaders(kids, members);
    const plannedCtx = ctx({
      leaders,
      planned: {
        from: '2026-01-05',
        to: '2026-01-05',
        sessions: [planned(110, 27, '2026-01-05', { trainer_id: 1 })]
      }
    });
    const inputs = initialPlanInputs(kids, monday, leaders);
    const [row] = reviewPlan(kids, inputs, plannedCtx);
    expect(row).toMatchObject({ status: 'invalid', blocking: true, write: null });
    expect(row.errors).toEqual([{ code: 'trainingUnconfirmed' }]);
    expect(summarizePlan([row], []).blocking).toBe(1);
    expect(skipIncomplete([row], inputs)[0].skip).toBe(true);
  });

  it('is saved once the user confirms it or picks the training', () => {
    const kids = [KIDS_FIRST[0]];
    const leaders = matchLeaders(kids, members);
    const inputs = initialPlanInputs(kids, monday, leaders);
    const confirmed = confirmTraining(reviewPlan(kids, inputs, ctx({ leaders })), inputs, 0);
    expect(confirmed[0].trainingGuess).toBe('confirmed');
    const [row] = reviewPlan(kids, confirmed, ctx({ leaders }));
    expect(row).toMatchObject({ status: 'new', blocking: false });
    expect(row.write).toMatchObject({ training_id: 27, topic: 'Fallschule', notes: 'Anna Kind' });
    const picked = setRowTraining(inputs[0], 27);
    expect(picked).toMatchObject({ trainingId: 27, trainingGuess: null });
    expect(reviewPlan(kids, [picked], ctx({ leaders }))[0].status).toBe('new');
  });

  it('needs no confirmation when the plan says the same already', () => {
    const kids = [session({ date: '2026-01-05', topic: 'Topwurf' })];
    const [row] = reviewPlan(
      kids,
      initialPlanInputs(kids, monday, new Map()),
      ctx({
        leaders: new Map(),
        planned: {
          from: '2026-01-05',
          to: '2026-01-05',
          sessions: [planned(111, 27, '2026-01-05', { trainer_id: 1, topic: 'Topwurf' })]
        }
      })
    );
    expect(row).toMatchObject({ status: 'exists', errors: [], blocking: false, write: null });
  });

  it('confirms the guesses of the same written training at once', () => {
    const entries = [
      session({ date: '2026-01-05', trainingAsWritten: 'Judo Kinder', topic: 'Fallschule' }),
      session({ date: '2026-01-12', trainingAsWritten: 'judo  kinder', topic: 'Rollen' }),
      session({ date: '2026-01-19', trainingAsWritten: 'Randori', topic: 'Kumikata' }),
      session({ date: '2026-01-26', topic: 'Ukemi' }),
      session({ date: '2026-02-02', topic: 'Kata' }),
      // The document has the adult session that Monday: nothing to confirm for the kids
      session({ date: '2026-02-09', trainingAsWritten: 'Judo Kinder', topic: 'Spiele' }),
      session({ date: '2026-02-09', trainingId: 27, topic: 'Uchi-mata' })
    ];
    const groupCtx = ctx({
      leaders: new Map(),
      planned: { from: '2026-01-05', to: '2026-02-09', sessions: [] }
    });
    const inputs = initialPlanInputs(entries, monday, new Map());
    expect(inputs.map((i) => i.trainingGuess)).toEqual([
      'open',
      'open',
      'open',
      'open',
      'open',
      'open',
      null
    ]);
    const rows = reviewPlan(entries, inputs, groupCtx);
    expect(rows[5].status).toBe('duplicate');
    expect(trainingGuessGroup(rows, 0)).toEqual([0, 1]);
    // Nothing written: only the row itself
    expect(trainingGuessGroup(rows, 3)).toEqual([3]);
    expect(trainingGuessGroup(rows, 5)).toEqual([]);
    const next = confirmTraining(rows, inputs, 1);
    expect(next.map((i) => i.trainingGuess)).toEqual([
      'confirmed',
      'confirmed',
      'open',
      'open',
      'open',
      'open',
      null
    ]);
    expect(trainingGuessGroup(reviewPlan(entries, next, groupCtx), 0)).toEqual([]);
  });

  it('gives the date to the guess the user confirmed, whatever its place in the document', () => {
    // Two unnamed groups the same Monday, only one training planned
    const entries = [
      session({ date: '2026-01-05', trainingAsWritten: 'Judo Kinder', topic: 'Fallschule' }),
      session({ date: '2026-01-05', trainingAsWritten: 'Kampftraining', topic: 'Topwurf' })
    ];
    const pairCtx = ctx({ leaders: new Map() });
    const inputs = initialPlanInputs(entries, monday, new Map());
    expect(reviewPlan(entries, inputs, pairCtx).map((r) => r.status)).toEqual([
      'invalid',
      'invalid'
    ]);
    // The second one is confirmed: the first one is left out, nothing to confirm there
    const next = confirmTraining(reviewPlan(entries, inputs, pairCtx), inputs, 1);
    const rows = reviewPlan(entries, next, pairCtx);
    expect(rows[0]).toMatchObject({
      status: 'duplicate',
      duplicateOf: 1,
      errors: [],
      blocking: false,
      write: null
    });
    expect(rows[1]).toMatchObject({ status: 'new', blocking: false });
    expect(buildPlanWrites(rows, { trainings: monday, members }).map((w) => w.topic)).toEqual([
      'Topwurf'
    ]);
  });
});

describe('a session without a readable date', () => {
  const entries = [
    session({
      date: '',
      trainingId: 26,
      trainer: 'Lara Beispiel',
      topic: 'Ne-waza',
      confidence: 'low',
      remark: 'Datum unleserlich'
    }),
    session({ date: '2026-01-07', trainingId: 26, trainer: 'Lara Beispiel', topic: 'Randori' })
  ];
  const leaders = matchLeaders(entries, members);

  it('is shown for repair and blocks the apply until fixed or left out', () => {
    const inputs = initialPlanInputs(entries, trainings, leaders);
    expect(inputs[0]).toMatchObject({ date: '', trainingId: 26, trainerId: 2, skip: false });
    // The plan is loaded for the readable dates only
    expect(dateSpan(inputs.map((i) => i.date))).toEqual({ from: '2026-01-07', to: '2026-01-07' });
    const ctx = context({
      leaders,
      planned: { from: '2026-01-07', to: '2026-01-07', sessions: PLANNED }
    });
    const rows = reviewPlan(entries, inputs, ctx);
    expect(rows[0]).toMatchObject({
      status: 'invalid',
      checked: true,
      blocking: true,
      write: null,
      errors: [{ code: 'badDate' }]
    });
    expect(summarizePlan(rows, []).blocking).toBe(1);
    expect(buildPlanWrites(rows, { trainings, members })).toHaveLength(0);
    expect(skipIncomplete(rows, inputs)[0].skip).toBe(true);

    // Fixed: compared with the plan once it is loaded for the new date
    inputs[0] = { ...inputs[0], date: '2026-01-14' };
    expect(reviewPlan(entries, inputs, ctx)[0]).toMatchObject({
      checked: false,
      blocking: true,
      errors: []
    });
    const loaded = context({
      leaders,
      planned: { from: '2026-01-07', to: '2026-01-14', sessions: PLANNED }
    });
    expect(reviewPlan(entries, inputs, loaded)[0]).toMatchObject({
      status: 'new',
      blocking: false
    });
  });
});

describe('the leaders, matched strictly', () => {
  const people: PlanReviewMember[] = [
    { id: 11, firstname: 'Peter', lastname: 'Meierhans', trainer: true },
    { id: 12, firstname: 'Lena', lastname: 'Meier', trainer: true },
    { id: 13, firstname: 'Christian', lastname: 'Weber', trainer: false },
    { id: 14, firstname: 'Benjamin', lastname: 'Keller', trainer: true },
    { id: 15, firstname: 'Janine', lastname: 'Müller', trainer: false }
  ];
  const names = [
    'Peter Meier',
    'Lena Maier',
    'L. Meier',
    'Beni Keller',
    'Chris Weber',
    'Christian Weber',
    'Jan Mueller'
  ];
  const matched = matchLeaders(
    names.map((trainer) => session({ date: '2026-01-05', trainingId: 27, trainer })),
    people
  );
  const kind = (name: string) => {
    const m = matched.get(leaderKey(name));
    return [m?.memberId, m?.kind];
  };

  it('takes a plan trainer by the exact name or the exact last name with an initial', () => {
    expect(kind('L. Meier')).toEqual([12, 'auto']);
    expect(kind('Christian Weber')).toEqual([13, 'auto']);
  });

  it('only suggests a similar last name or a short form of someone else', () => {
    expect(kind('Peter Meier')).toEqual([11, 'suggested']);
    expect(kind('Lena Maier')).toEqual([12, 'suggested']);
    expect(kind('Chris Weber')).toEqual([13, 'suggested']);
    expect(kind('Beni Keller')).toEqual([14, 'suggested']);
    expect(kind('Jan Mueller')).toEqual([15, 'suggested']);
  });
});

describe('after a partial save', () => {
  it('finds the rows of the writes that went through and never writes them again', () => {
    const inputs = initial();
    const rows = review(inputs);
    const writes = buildPlanWrites(rows, { trainings, members });
    expect(sessionRowsOf(rows, writes)).toEqual([0, 1]);
    expect(sessionRowsOf(rows, [writes[1]])).toEqual([1]);

    const next = markSaved(inputs, [0]);
    expect(next[0].saved).toBe(true);
    expect(next[1]).toBe(inputs[1]);
    const after = review(next);
    expect(after[0]).toMatchObject({ write: null, blocking: false });
    // The saved row keeps the date: the other row of it stays a duplicate
    expect(after[7]).toMatchObject({ status: 'duplicate', duplicateOf: 0, write: null });
    // Not waiting for the plan either
    expect(summarizePlan(review(next, { planned: null }), []).waiting).toBe(8);
    expect(buildPlanWrites(after, { trainings, members }).map((w) => w.date)).toEqual([
      '2026-01-07'
    ]);
  });

  it('keeps the leader of a saved row when the name is matched to someone else', () => {
    const inputs = markSaved(initial(), [1]);
    const next = applyLeaderChoice(SESSIONS, inputs, 'lara beispiel', 2, null);
    expect(next[1]).toBe(inputs[1]);
    expect(next[4]).toMatchObject({ trainerId: null, notes: 'Lara Beispiel' });
  });

  it('finds the holiday rows and never adds a saved one again', () => {
    const inputs = initialHolidayInputs(HOLIDAYS, BREAKS);
    inputs[0] = { ...inputs[0], use: true };
    const rows = reviewHolidays(HOLIDAYS, inputs, BREAKS);
    const writes = buildBreakWrites(rows);
    expect(holidayRowsOf(rows, writes)).toEqual([0, 3]);
    const next = markSaved(inputs, [3]);
    const after = reviewHolidays(HOLIDAYS, next, BREAKS);
    expect(after[3]).toMatchObject({ status: 'new', write: null, blocking: false });
    expect(buildBreakWrites(after).map((w) => w.title)).toEqual(['Sportferien']);
    // Still counted as being added: a copy of it is a duplicate, not another period
    const copy = [...HOLIDAYS, HOLIDAYS[3]];
    const copyRows = reviewHolidays(copy, [...next, { ...next[3], saved: false }], BREAKS);
    expect(copyRows[4]).toMatchObject({ status: 'duplicate', duplicateOf: 3 });
  });
});

describe('insertBreaks', () => {
  const herbst: PlanBreakWrite = {
    title: 'Herbstferien',
    date_from: '2026-10-03',
    date_to: '2026-10-18',
    cancels_training: false
  };
  const fasnacht: PlanBreakWrite = {
    title: 'Fasnacht',
    date_from: '2026-02-16',
    date_to: '2026-02-18',
    cancels_training: true
  };
  const lager: PlanBreakWrite = {
    title: 'Lager',
    date_from: '2026-07-06',
    date_to: '2026-07-10',
    cancels_training: false
  };

  /** A table without a unique key, as training_plan_breaks */
  function table(rows: PlannedBreak[] = []) {
    const db = [...rows];
    const spans: { from: string; to: string }[] = [];
    return {
      db,
      spans,
      read: async (span: { from: string; to: string }) => {
        spans.push(span);
        return db.filter((b) => b.date_from <= span.to && span.from <= b.date_to);
      }
    };
  }

  it('inserts all at once when it works', async () => {
    const t = table();
    const calls: PlanBreakWrite[][] = [];
    const outcome = await insertBreaks(
      [fasnacht, herbst],
      async (portion) => {
        calls.push(portion);
        t.db.push(...portion);
        return true;
      },
      t.read
    );
    expect(outcome).toEqual({ saved: [fasnacht, herbst], failed: [] });
    expect(calls).toHaveLength(1);
    expect(t.spans).toEqual([]);
  });

  it('does not add twice what was saved although the answer got lost', async () => {
    const t = table();
    let calls = 0;
    const outcome = await insertBreaks(
      [fasnacht, lager, herbst],
      async (portion) => {
        calls++;
        // Committed, but the browser sees "Failed to fetch"
        t.db.push(...portion);
        return false;
      },
      t.read
    );
    expect(outcome).toEqual({ saved: [fasnacht, lager, herbst], failed: [] });
    expect(calls).toBe(1);
    expect(t.db).toHaveLength(3);
    // Read again for the whole period of the holidays
    expect(t.spans).toEqual([{ from: '2026-02-16', to: '2026-10-18' }]);
  });

  it('retries one by one only what is not recorded', async () => {
    const t = table();
    const calls: string[][] = [];
    const outcome = await insertBreaks(
      [fasnacht, lager, herbst],
      async (portion) => {
        calls.push(portion.map((b) => b.title));
        if (portion.some((b) => b.title === 'Lager')) return false;
        t.db.push(...portion);
        return true;
      },
      t.read
    );
    expect(outcome).toEqual({ saved: [fasnacht, herbst], failed: [lager] });
    expect(calls).toEqual([
      ['Fasnacht', 'Lager', 'Herbstferien'],
      ['Fasnacht'],
      ['Lager'],
      ['Herbstferien']
    ]);
    expect(t.db).toEqual([fasnacht, herbst]);
  });

  it('tries nothing again when the recorded holidays cannot be read', async () => {
    let calls = 0;
    const outcome = await insertBreaks(
      [fasnacht, herbst],
      async () => {
        calls++;
        return false;
      },
      async () => null
    );
    expect(outcome).toEqual({ saved: [], failed: [fasnacht, herbst] });
    expect(calls).toBe(1);
  });

  it('checks first on a new attempt and skips what is recorded meanwhile', async () => {
    const t = table([{ ...herbst, title: ' herbstferien ' }]);
    const calls: string[][] = [];
    const progress: number[] = [];
    const outcome = await insertBreaks(
      [fasnacht, herbst],
      async (portion) => {
        calls.push(portion.map((b) => b.title));
        t.db.push(...portion);
        return true;
      },
      t.read,
      { checkFirst: true, onProgress: (done) => progress.push(done) }
    );
    expect(outcome).toEqual({ saved: [herbst, fasnacht], failed: [] });
    expect(calls).toEqual([['Fasnacht']]);
    expect(t.db).toHaveLength(2);
    expect(progress.at(-1)).toBe(2);
    // Cannot check: nothing is inserted
    const blind = await insertBreaks(
      [fasnacht],
      async () => true,
      async () => null,
      {
        checkFirst: true
      }
    );
    expect(blind).toEqual({ saved: [], failed: [fasnacht] });
  });
});
