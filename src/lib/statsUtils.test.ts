import { describe, it, expect } from 'vitest';
import { groupBySection, resolveYearParam, resolveYearForRpc } from './statsUtils';
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
