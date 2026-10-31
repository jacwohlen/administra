import { describe, expect, it } from 'vitest';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import {
  breakOn,
  buildPlan,
  hasAssignment,
  isCancelled,
  parseTrainingIds,
  pickedTrainings,
  planKey,
  planTopics,
  plannableTrainingIds,
  rotate,
  slotPatch,
  togglePicked,
  topicLabel,
  trainerCounts,
  trainingDates,
  type PlanTraining
} from './trainingPlanUtils';

const monday: PlanTraining = {
  id: 27,
  title: 'Judo Kampftraining',
  weekday: 'Monday',
  dateFrom: '20:00',
  section: 'Judo'
};
const friday: PlanTraining = {
  id: 23,
  title: 'Judo Techniktraining',
  weekday: 'Friday',
  dateFrom: '20:00',
  section: 'Judo'
};
// Dojo closed (e.g. Christmas); the dates are only for the tests
const autumn: TrainingPlanBreak = {
  id: 1,
  title: 'Herbstferien',
  date_from: '2026-10-03',
  date_to: '2026-10-18',
  cancels_training: true
};
// School holidays: the adults train on
const spring: TrainingPlanBreak = {
  id: 2,
  title: 'Frühlingsferien',
  date_from: '2026-04-03',
  date_to: '2026-04-19',
  cancels_training: false
};
const goodFriday: TrainingPlanBreak = {
  id: 3,
  title: 'Karfreitag',
  date_from: '2026-04-03',
  date_to: '2026-04-03',
  cancels_training: true
};

function session(p: Partial<TrainingPlanSession>): TrainingPlanSession {
  return {
    id: 1,
    training_id: monday.id,
    date: '2026-10-05',
    trainer_id: null,
    topic: null,
    notes: null,
    cancelled: null,
    updated_at: '',
    ...p
  };
}

describe('trainingDates', () => {
  it('lists every weekday in the range, both ends included', () => {
    expect(trainingDates('Monday', '2026-11-02', '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30'
    ]);
  });

  it('starts at the first matching day after the start', () => {
    expect(trainingDates('Friday', '2026-11-02', '2026-11-14')).toEqual([
      '2026-11-06',
      '2026-11-13'
    ]);
  });

  it('returns nothing for an unknown weekday', () => {
    expect(trainingDates('Funday', '2026-11-02', '2026-11-30')).toEqual([]);
  });
});

describe('breaks and cancellation', () => {
  it('finds the break a date falls into', () => {
    expect(breakOn('2026-10-03', [autumn])).toBe(autumn);
    expect(breakOn('2026-10-18', [autumn])).toBe(autumn);
    expect(breakOn('2026-10-19', [autumn])).toBeNull();
  });

  it('prefers the break that closes the dojo', () => {
    expect(breakOn('2026-04-03', [spring, goodFriday])).toBe(goodFriday);
    expect(breakOn('2026-04-10', [spring, goodFriday])).toBe(spring);
  });

  it('keeps trainings in holidays that do not close the dojo', () => {
    expect(isCancelled(null, spring)).toBe(false);
  });

  it('follows the break unless the session decides', () => {
    expect(isCancelled(null, autumn)).toBe(true);
    expect(isCancelled(null, null)).toBe(false);
    expect(isCancelled(session({ cancelled: false }), autumn)).toBe(false);
    expect(isCancelled(session({ cancelled: true }), null)).toBe(true);
  });
});

describe('buildPlan', () => {
  it('merges trainings, sessions, breaks and events by date', () => {
    const rows = buildPlan(
      [friday, monday],
      [session({ date: '2026-10-19', trainer_id: 7, topic: 'Uchi-mata' })],
      [autumn],
      [{ id: 3, title: 'Vereinsmeisterschaft', date: '2026-10-23' }],
      '2026-10-12',
      '2026-10-25'
    );
    expect(rows.map((r) => [r.date, r.training.id, r.cancelled])).toEqual([
      ['2026-10-12', 27, true],
      ['2026-10-16', 23, true],
      ['2026-10-19', 27, false],
      ['2026-10-23', 23, false]
    ]);
    expect(rows[0].break).toBe(autumn);
    expect(rows[2].session?.topic).toBe('Uchi-mata');
    expect(rows[3].events.map((e) => e.title)).toEqual(['Vereinsmeisterschaft']);
  });

  it('shows a multi-day event on every training of its days, also across the year', () => {
    const camp = { id: 4, title: 'Herbstlager', date: '2026-10-11', date_to: '2026-10-19' };
    const rows = buildPlan([friday, monday], [], [], [camp], '2026-10-12', '2026-10-25');
    expect(rows.map((r) => [r.date, r.events.length])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-16', 1],
      ['2026-10-19', 1],
      ['2026-10-23', 0]
    ]);
    // Begun in the year before: on the year's first Monday
    const silvester = { id: 5, title: 'Silvesterlager', date: '2025-12-29', date_to: '2026-01-05' };
    const january = buildPlan([monday], [], [], [silvester], '2026-01-01', '2026-01-12');
    expect(january.map((r) => [r.date, r.events.map((e) => e.id)])).toEqual([
      ['2026-01-05', [5]],
      ['2026-01-12', []]
    ]);
  });

  it('falls back to the main trainer of the training', () => {
    const fixed = { ...monday, mainTrainerId: 5 };
    const rows = buildPlan(
      [fixed],
      [session({ date: '2026-11-09', trainer_id: 7 })],
      [],
      [],
      '2026-11-02',
      '2026-11-09'
    );
    expect(rows.map((r) => [r.trainerId, r.defaultTrainer])).toEqual([
      [5, true],
      [7, false]
    ]);
  });

  it('orders trainings of the same day by start time, whatever the separator', () => {
    const early = { ...monday, id: 28, title: 'Judo Kinder', dateFrom: '18.30' };
    const rows = buildPlan([monday, early], [], [], [], '2026-11-02', '2026-11-02');
    expect(rows.map((r) => r.training.id)).toEqual([28, 27]);
  });
});

describe('rotate', () => {
  const dates = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];
  const held = dates.map((date) => ({ date, cancelled: false }));
  const a = { kind: 'trainer', memberId: 1 } as const;
  const b = { kind: 'trainer', memberId: 2 } as const;

  it('numbers the dates within a slot', () => {
    const r = rotate(held, ['Seoi-nage', 'Uchi-mata'], { perSlot: 2, skipCancelled: true });
    expect(r.map((x) => topicLabel(x.slot, x.part, 2, true))).toEqual([
      'Seoi-nage, Teil 1',
      'Seoi-nage, Teil 2',
      'Uchi-mata, Teil 1',
      'Uchi-mata, Teil 2',
      'Seoi-nage, Teil 1'
    ]);
    expect(topicLabel('Randori', 1, 1, true)).toBe('Randori');
    expect(topicLabel('Kombinationen', 2, 4, false)).toBe('Kombinationen');
  });

  it('alternates the slots date by date', () => {
    const r = rotate(held, [a, b], { perSlot: 1, skipCancelled: true });
    expect(r.map((x) => x.slot)).toEqual([a, b, a, b, a]);
  });

  it('keeps each slot for several dates', () => {
    const r = rotate(held, [a, b], { perSlot: 2, skipCancelled: true });
    expect(r.map((x) => x.slot)).toEqual([a, a, b, b, a]);
  });

  it('continues after a holiday when dropped dates do not count', () => {
    const rows = held.map((r, i) => ({ ...r, cancelled: i === 1 }));
    const r = rotate(rows, [a, b], { perSlot: 1, skipCancelled: true });
    expect(r).toEqual([
      { date: '2026-11-02', slot: a, part: 1 },
      { date: '2026-11-16', slot: b, part: 1 },
      { date: '2026-11-23', slot: a, part: 1 },
      { date: '2026-11-30', slot: b, part: 1 }
    ]);
  });

  it('follows the calendar weeks otherwise', () => {
    const rows = held.map((r, i) => ({ ...r, cancelled: i === 1 }));
    const r = rotate(rows, [a, b], { perSlot: 1, skipCancelled: false });
    expect(r.map((x) => x.slot)).toEqual([a, a, b, a]);
  });

  it('can leave every other week without training', () => {
    const none = { kind: 'none' } as const;
    const r = rotate(held, [a, none], { perSlot: 1, skipCancelled: true });
    expect(r.map((x) => slotPatch(x.slot))).toEqual([
      { trainer_id: 1, cancelled: null },
      { trainer_id: null, cancelled: true },
      { trainer_id: 1, cancelled: null },
      { trainer_id: null, cancelled: true },
      { trainer_id: 1, cancelled: null }
    ]);
  });

  it('does nothing without slots', () => {
    expect(rotate(held, [], { perSlot: 1, skipCancelled: true })).toEqual([]);
  });
});

describe('helpers', () => {
  it('knows when the TK already decided', () => {
    expect(hasAssignment(null)).toBe(false);
    expect(hasAssignment(session({ topic: 'Ukemi' }))).toBe(false);
    expect(hasAssignment(session({ trainer_id: 3 }))).toBe(true);
    expect(hasAssignment(session({ cancelled: false }))).toBe(true);
  });

  it('lists distinct topics', () => {
    expect(
      planTopics([{ topic: ' Ukemi ' }, { topic: 'Kata' }, { topic: 'Ukemi' }, { topic: null }])
    ).toEqual(['Kata', 'Ukemi']);
  });

  it('counts held sessions per trainer', () => {
    const rows = buildPlan(
      [monday],
      [
        session({ date: '2026-10-12', trainer_id: 1 }),
        session({ date: '2026-10-19', trainer_id: 1 }),
        session({ date: '2026-10-26', trainer_id: 2 })
      ],
      [autumn],
      [],
      '2026-10-12',
      '2026-10-26'
    );
    expect([...trainerCounts(rows)]).toEqual([
      [1, 1],
      [2, 1]
    ]);
  });
});

describe('trainings of the table', () => {
  const kids: PlanTraining = { ...friday, id: 31, title: 'Judo Kinder', dateFrom: '17:30' };

  it('keys a row by training and date', () => {
    const rows = buildPlan([friday, kids], [], [], [], '2026-11-06', '2026-11-06');
    expect(rows.map(planKey)).toEqual(['31|2026-11-06', '23|2026-11-06']);
  });

  it('reads the ids the browser kept, also the single one from before', () => {
    expect(parseTrainingIds('27,23')).toEqual([27, 23]);
    expect(parseTrainingIds('27')).toEqual([27]);
    expect(parseTrainingIds(' 27 , x,,-1,2.5,23')).toEqual([27, 23]);
    expect(parseTrainingIds('')).toEqual([]);
    expect(parseTrainingIds(null)).toEqual([]);
  });

  it('picks the trainings still planned, in their order, else the first', () => {
    const trainings = [monday, friday, kids];
    expect(pickedTrainings([31, 27], trainings)).toEqual([monday, kids]);
    expect(pickedTrainings([99, 23], trainings)).toEqual([friday]);
    expect(pickedTrainings([99], trainings)).toEqual([monday]);
    expect(pickedTrainings([], trainings)).toEqual([monday]);
    expect(pickedTrainings([27], [])).toEqual([]);
  });

  it("falls back to a main trainer's own training, not just the first", () => {
    const trainings = [monday, friday, kids];
    expect(pickedTrainings([], trainings, [31, 23])).toEqual([friday]);
    expect(pickedTrainings([99], trainings, [31])).toEqual([kids]);
    // What was picked before stays, also another training
    expect(pickedTrainings([27], trainings, [31])).toEqual([monday]);
    expect(pickedTrainings([], trainings, [99])).toEqual([monday]);
  });

  it('lets the TK plan every training, a main trainer his own, others none', () => {
    const trainings = [monday, friday, kids];
    expect(plannableTrainingIds(trainings, true, [])).toEqual([27, 23, 31]);
    // Only what is in the plan, in its order
    expect(plannableTrainingIds(trainings, false, [31, 99, 27])).toEqual([27, 31]);
    expect(plannableTrainingIds(trainings, false, [])).toEqual([]);
  });

  it('picks and drops a training, but keeps the last one', () => {
    expect(togglePicked([27], 23)).toEqual([27, 23]);
    expect(togglePicked([27, 23], 27)).toEqual([23]);
    expect(togglePicked([23], 23)).toEqual([23]);
  });
});
