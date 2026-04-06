import { describe, it, expect } from 'vitest';
import { buildStreakMap, buildMembersWithStreaks, compareTrainings } from './trainingUtils';
import type { Training } from '$lib/models';

describe('buildStreakMap', () => {
  it('returns empty map and zero dates for empty input', () => {
    const { memberSeqs, totalDates } = buildStreakMap([]);
    expect(memberSeqs.size).toBe(0);
    expect(totalDates).toBe(0);
  });

  it('correctly maps a single member with multiple dates', () => {
    const rows = [
      { memberId: 1, date: '2024-01-01', seq: 1 },
      { memberId: 1, date: '2024-01-08', seq: 2 },
      { memberId: 1, date: '2024-01-15', seq: 3 }
    ];
    const { memberSeqs, totalDates } = buildStreakMap(rows);
    expect(totalDates).toBe(3);
    expect(memberSeqs.get(1)).toEqual(new Set([1, 2, 3]));
  });

  it('correctly maps multiple members', () => {
    const rows = [
      { memberId: 1, date: '2024-01-01', seq: 1 },
      { memberId: 2, date: '2024-01-01', seq: 1 },
      { memberId: 1, date: '2024-01-08', seq: 2 }
    ];
    const { memberSeqs, totalDates } = buildStreakMap(rows);
    expect(totalDates).toBe(2);
    expect(memberSeqs.get(1)).toEqual(new Set([1, 2]));
    expect(memberSeqs.get(2)).toEqual(new Set([1]));
  });

  it('counts distinct seq values for totalDates', () => {
    const rows = [
      { memberId: 1, date: '2024-01-01', seq: 1 },
      { memberId: 2, date: '2024-01-01', seq: 1 },
      { memberId: 3, date: '2024-01-01', seq: 1 }
    ];
    const { totalDates } = buildStreakMap(rows);
    expect(totalDates).toBe(1);
  });
});

describe('buildMembersWithStreaks', () => {
  it('returns empty array for empty checklist', () => {
    expect(buildMembersWithStreaks([], [])).toEqual([]);
  });

  it('builds members with correct present status', () => {
    const checklist = [
      {
        memberId: '1',
        firstname: 'Alice',
        lastname: 'Smith',
        labels: ['Judo'],
        img: '',
        date: '2024-01-01',
        trainerRole: 'attendee' as const
      },
      {
        memberId: '2',
        firstname: 'Bob',
        lastname: 'Jones',
        labels: [],
        img: '',
        date: null,
        trainerRole: 'attendee' as const
      }
    ];

    const result = buildMembersWithStreaks(checklist, []);
    expect(result[0].isPresent).toBe(true);
    expect(result[1].isPresent).toBe(false);
  });

  it('defaults trainerRole to attendee when falsy', () => {
    const checklist = [
      {
        memberId: '1',
        firstname: 'Alice',
        lastname: 'Smith',
        labels: [],
        img: '',
        date: null,
        trainerRole: '' as never
      }
    ];

    const result = buildMembersWithStreaks(checklist, []);
    expect(result[0].trainerRole).toBe('attendee');
  });

  it('builds correct streak boolean arrays', () => {
    const checklist = [
      {
        memberId: '1',
        firstname: 'Alice',
        lastname: 'Smith',
        labels: [],
        img: '',
        date: '2024-01-15',
        trainerRole: 'attendee' as const
      },
      {
        memberId: '2',
        firstname: 'Bob',
        lastname: 'Jones',
        labels: [],
        img: '',
        date: null,
        trainerRole: 'main_trainer' as const
      }
    ];

    const streakRows = [
      { memberId: 1, date: '2024-01-01', seq: 1 },
      { memberId: 1, date: '2024-01-08', seq: 2 },
      { memberId: 2, date: '2024-01-01', seq: 1 }
      // member 2 missed seq 2
    ];

    const result = buildMembersWithStreaks(checklist, streakRows);

    // Member 1 attended both sessions
    expect(result[0].streak).toEqual([true, true]);
    // Member 2 attended only first session
    expect(result[1].streak).toEqual([true, false]);
  });

  it('returns empty streak arrays when no streak data exists', () => {
    const checklist = [
      {
        memberId: '1',
        firstname: 'Alice',
        lastname: 'Smith',
        labels: [],
        img: '',
        date: null,
        trainerRole: 'attendee' as const
      }
    ];

    const result = buildMembersWithStreaks(checklist, []);
    expect(result[0].streak).toEqual([]);
  });

  it('preserves trainer role from checklist data', () => {
    const checklist = [
      {
        memberId: '1',
        firstname: 'Alice',
        lastname: 'Smith',
        labels: [],
        img: '',
        date: '2024-01-01',
        trainerRole: 'main_trainer' as const
      },
      {
        memberId: '2',
        firstname: 'Bob',
        lastname: 'Jones',
        labels: [],
        img: '',
        date: '2024-01-01',
        trainerRole: 'assistant' as const
      }
    ];

    const result = buildMembersWithStreaks(checklist, []);
    expect(result[0].trainerRole).toBe('main_trainer');
    expect(result[1].trainerRole).toBe('assistant');
  });
});

describe('compareTrainings', () => {
  function makeTraining(weekday: string, dateFrom: string): Training {
    return {
      id: '1',
      title: 'Test',
      dateFrom,
      dateTo: '20:00',
      weekday,
      section: 'Judo',
      participants: []
    };
  }

  it('sorts Monday before Tuesday', () => {
    const a = makeTraining('Monday', '18:00');
    const b = makeTraining('Tuesday', '18:00');
    expect(compareTrainings(a, b)).toBeLessThan(0);
  });

  it('sorts Saturday after Friday', () => {
    const a = makeTraining('Saturday', '10:00');
    const b = makeTraining('Friday', '10:00');
    expect(compareTrainings(a, b)).toBeGreaterThan(0);
  });

  it('sorts by time when weekday is the same', () => {
    const a = makeTraining('Monday', '18:00');
    const b = makeTraining('Monday', '20:00');
    expect(compareTrainings(a, b)).toBeLessThan(0);
  });

  it('returns 0 for identical weekday and time', () => {
    const a = makeTraining('Wednesday', '18:00');
    const b = makeTraining('Wednesday', '18:00');
    expect(compareTrainings(a, b)).toBe(0);
  });

  it('sorts Sunday (0) before Monday (1)', () => {
    const a = makeTraining('Sunday', '10:00');
    const b = makeTraining('Monday', '10:00');
    expect(compareTrainings(a, b)).toBeLessThan(0);
  });

  it('correctly handles early morning vs evening on same day', () => {
    const a = makeTraining('Wednesday', '07:00');
    const b = makeTraining('Wednesday', '19:30');
    expect(compareTrainings(a, b)).toBeLessThan(0);
  });
});
