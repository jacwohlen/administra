import { describe, expect, it } from 'vitest';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import {
  breakOn,
  buildPlan,
  hasAssignment,
  isCancelled,
  planTopics,
  rotate,
  slotPatch,
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
const autumn: TrainingPlanBreak = {
  id: 1,
  title: 'Herbstferien',
  date_from: '2026-10-03',
  date_to: '2026-10-18'
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
      { date: '2026-11-02', slot: a },
      { date: '2026-11-16', slot: b },
      { date: '2026-11-23', slot: a },
      { date: '2026-11-30', slot: b }
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
