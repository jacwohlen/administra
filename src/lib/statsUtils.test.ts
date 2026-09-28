import { describe, it, expect } from 'vitest';
import {
  groupBySection,
  resolveYearParam,
  resolveYearForRpc,
  seriesColors,
  SERIES_COLORS,
  ageGroup,
  churnByAge,
  churnByTraining,
  countByAge,
  countByTraining,
  type NewMemberRow,
  type RetentionRow
} from './statsUtils';
import type { Athletes } from '$lib/models';

function makeAthlete(overrides: Partial<Athletes> = {}): Athletes {
  return {
    section: 'Judo',
    memberId: 1,
    lastname: 'Doe',
    firstname: 'John',
    count: 10,
    rank: 1,
    ...overrides
  };
}

describe('groupBySection', () => {
  it('returns empty object for empty array', () => {
    expect(groupBySection([])).toEqual({});
  });

  it('groups athletes into their sections', () => {
    const data: Athletes[] = [
      makeAthlete({ section: 'Judo', memberId: 1 }),
      makeAthlete({ section: 'Karate', memberId: 2 }),
      makeAthlete({ section: 'Judo', memberId: 3 })
    ];

    const result = groupBySection(data);
    expect(Object.keys(result)).toEqual(['Judo', 'Karate']);
    expect(result['Judo']).toHaveLength(2);
    expect(result['Karate']).toHaveLength(1);
  });

  it('sorts sections alphabetically', () => {
    const data: Athletes[] = [
      makeAthlete({ section: 'Zumba' }),
      makeAthlete({ section: 'Aikido' }),
      makeAthlete({ section: 'Karate' })
    ];

    const result = groupBySection(data);
    expect(Object.keys(result)).toEqual(['Aikido', 'Karate', 'Zumba']);
  });

  it('preserves order of athletes within a section', () => {
    const data: Athletes[] = [
      makeAthlete({ section: 'Judo', memberId: 1, firstname: 'Alice' }),
      makeAthlete({ section: 'Judo', memberId: 2, firstname: 'Bob' }),
      makeAthlete({ section: 'Judo', memberId: 3, firstname: 'Charlie' })
    ];

    const result = groupBySection(data);
    expect(result['Judo'].map((a) => a.firstname)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('handles a single section', () => {
    const data: Athletes[] = [makeAthlete({ section: 'Judo' })];
    const result = groupBySection(data);
    expect(Object.keys(result)).toEqual(['Judo']);
    expect(result['Judo']).toHaveLength(1);
  });
});

describe('resolveYearParam', () => {
  it('defaults to current year and YEAR mode when param is undefined', () => {
    const result = resolveYearParam(undefined);
    expect(result.yearmode).toBe('YEAR');
    expect(result.year).toBe(new Date().getFullYear());
  });

  it('returns ALL mode when param is "ALL"', () => {
    const result = resolveYearParam('ALL');
    expect(result.yearmode).toBe('ALL');
    expect(result.year).toBe(new Date().getFullYear());
  });

  it('parses numeric year string', () => {
    const result = resolveYearParam('2023');
    expect(result.yearmode).toBe('YEAR');
    expect(result.year).toBe(2023);
  });

  it('handles empty string same as undefined', () => {
    const result = resolveYearParam('');
    expect(result.yearmode).toBe('YEAR');
    expect(result.year).toBe(new Date().getFullYear());
  });
});

describe('resolveYearForRpc', () => {
  it('returns empty string for undefined', () => {
    expect(resolveYearForRpc(undefined)).toBe('');
  });

  it('returns empty string for "ALL"', () => {
    expect(resolveYearForRpc('ALL')).toBe('');
  });

  it('returns the year string for a numeric year', () => {
    expect(resolveYearForRpc('2023')).toBe('2023');
  });

  it('returns empty string for empty string', () => {
    expect(resolveYearForRpc('')).toBe('');
  });
});

describe('seriesColors', () => {
  it('assigns colors by sorted group name, independent of input order', () => {
    const a = seriesColors(['Judo', 'Aikido', 'Judo'], false);
    const b = seriesColors(['Aikido', 'Judo'], false);
    expect(a).toEqual(b);
    expect(a).toEqual({ Aikido: SERIES_COLORS.light[0], Judo: SERIES_COLORS.light[1] });
  });

  it('uses the dark steps in dark mode', () => {
    expect(seriesColors(['Judo'], true)).toEqual({ Judo: SERIES_COLORS.dark[0] });
  });
});

function row(overrides: Partial<RetentionRow>): RetentionRow {
  return {
    memberId: 1,
    firstname: 'Anna',
    lastname: 'Muster',
    age: 10,
    trainingId: 1,
    title: 'Judo Kinder',
    section: 'Judo',
    weekday: 'Monday',
    dateFrom: '17:30',
    last_date: '2025-12-01',
    churned: false,
    ...overrides
  };
}

describe('ageGroup', () => {
  it('puts ages into inclusive groups', () => {
    expect(ageGroup(9)).toBe('0-9');
    expect(ageGroup(10)).toBe('10-13');
    expect(ageGroup(17)).toBe('14-17');
    expect(ageGroup(65)).toBe('50+');
    expect(ageGroup(null)).toBe('unknown');
  });
});

describe('churnByAge', () => {
  it('counts churned and active members per group, youngest first', () => {
    const groups = churnByAge([
      row({ memberId: 1, age: 30, churned: true }),
      row({ memberId: 2, age: null, churned: true }),
      row({ memberId: 3, age: 8, churned: true }),
      row({ memberId: 4, age: 7 })
    ]);
    expect(groups.map((g) => g.key)).toEqual(['0-9', '30-49', 'unknown']);
    expect(groups[0]).toEqual({ key: '0-9', active: 2, churned: 1, rate: 0.5 });
  });
});

describe('churnByTraining', () => {
  it('lists trainings with churn, most churned members first', () => {
    const groups = churnByTraining([
      row({ memberId: 1, trainingId: 1, churned: true }),
      row({ memberId: 2, trainingId: 2, churned: true }),
      row({ memberId: 3, trainingId: 2, churned: true }),
      row({ memberId: 4, trainingId: 3 })
    ]);
    expect(groups.map((g) => [g.key, g.churned])).toEqual([
      ['2', 2],
      ['1', 1]
    ]);
  });
});

describe('countByAge / countByTraining', () => {
  const rows: NewMemberRow[] = [
    { ...row({ memberId: 1, age: 8, trainingId: 2 }), first_date: '2026-01-05' },
    { ...row({ memberId: 2, age: 40, trainingId: 2 }), first_date: '2026-02-05' },
    { ...row({ memberId: 3, age: 9, trainingId: 1 }), first_date: '2026-03-05' },
    { ...row({ memberId: 4, age: 12, trainingId: 2 }), first_date: '2026-04-05' }
  ];

  it('counts new members per age group with their share', () => {
    expect(countByAge(rows)).toEqual([
      { key: '0-9', count: 2, share: 0.5 },
      { key: '10-13', count: 1, share: 0.25 },
      { key: '30-49', count: 1, share: 0.25 }
    ]);
  });

  it('counts new members per training, biggest first', () => {
    expect(countByTraining(rows).map((g) => [g.key, g.count])).toEqual([
      ['2', 3],
      ['1', 1]
    ]);
  });
});
