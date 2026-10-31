import { describe, expect, it } from 'vitest';
import type { GradeDefinition } from '$lib/models';
import {
  copyRows,
  kyuDanTemplate,
  ladderChanged,
  ladderPayload,
  ladderProblems,
  ladderRows,
  ladderSections,
  moveRow,
  removedGrades,
  toHexColor,
  type LadderRow
} from './gradeLadders';

const def = (
  section: string,
  grade: string,
  gradeRank: number,
  extra: Partial<GradeDefinition> = {}
): GradeDefinition => ({ section, grade, gradeRank, beltColor: '#f5f5f5', isDan: false, ...extra });

const defs: GradeDefinition[] = [
  def('Judo', '5. Kyu', 2, { beltColor: '#f4d03f' }),
  def('Judo', '6. Kyu', 1),
  def('Judo', '1. Dan', 3, { beltColor: '#111111', isDan: true }),
  def('Aikido', '6. Kyu', 1),
  def('Ringen', 'Stufe 1', 1)
];

const row = (grade: string, extra: Partial<LadderRow> = {}): LadderRow => ({
  key: grade,
  grade,
  previous: grade,
  beltColor: '#ffffff',
  beltColor2: null,
  isDan: false,
  ...extra
});

describe('ladderRows', () => {
  it('gives a section lowest grade first, each kept under its saved name', () => {
    const rows = ladderRows(defs, 'Judo');
    expect(rows.map((r) => r.grade)).toEqual(['6. Kyu', '5. Kyu', '1. Dan']);
    expect(rows.every((r) => r.previous === r.grade)).toBe(true);
    expect(rows[2].isDan).toBe(true);
    expect(rows[0].beltColor2).toBeNull();
  });

  it('is empty for a section without a ladder', () => {
    expect(ladderRows(defs, 'Karate')).toEqual([]);
  });
});

describe('ladderSections', () => {
  it('lists club sections first, then ladders of sections the club no longer has', () => {
    expect(ladderSections(['Judo', 'Karate', 'Aikido', ' Judo '], defs)).toEqual([
      { section: 'Judo', grades: 3, isClubSection: true },
      { section: 'Karate', grades: 0, isClubSection: true },
      { section: 'Aikido', grades: 1, isClubSection: true },
      { section: 'Ringen', grades: 1, isClubSection: false }
    ]);
  });
});

describe('ladderPayload', () => {
  it('trims names and turns an empty second colour into none', () => {
    expect(ladderPayload([row(' 5. Kyu ', { beltColor2: ' ' })])).toEqual([
      {
        grade: '5. Kyu',
        previous: ' 5. Kyu ',
        beltColor: '#ffffff',
        beltColor2: null,
        isDan: false
      }
    ]);
  });
});

describe('ladderProblems', () => {
  it('accepts a valid ladder', () => {
    expect(ladderProblems([row('6. Kyu'), row('5. Kyu', { beltColor2: '#f4d03f' })])).toEqual([]);
  });

  it('finds empty and long names, duplicates (any case, once) and bad colours', () => {
    expect(
      ladderProblems([
        row(' '),
        row('x'.repeat(41)),
        row('1. Dan'),
        row('1. dan'),
        row('1. DAN'),
        row('A', { beltColor: 'url(x)' }),
        row('B', { beltColor2: '#12' })
      ])
    ).toEqual([
      { kind: 'emptyName', index: 0 },
      { kind: 'nameTooLong', index: 1 },
      { kind: 'duplicate', grade: '1. dan' },
      { kind: 'badColor', index: 5 },
      { kind: 'badColor', index: 6 }
    ]);
  });
});

describe('changes', () => {
  const saved = [row('6. Kyu'), row('5. Kyu'), row('4. Kyu')];

  it('sees renames, reorders and colour changes, not untouched rows', () => {
    expect(
      ladderChanged(
        saved.map((r) => ({ ...r })),
        saved
      )
    ).toBe(false);
    expect(ladderChanged([saved[0], { ...saved[1], grade: '5 Kyu' }, saved[2]], saved)).toBe(true);
    expect(ladderChanged(moveRow(saved, 0, 1), saved)).toBe(true);
    expect(ladderChanged([saved[0], saved[1], { ...saved[2], isDan: true }], saved)).toBe(true);
  });

  it('lists the saved grades a save deletes, renamed ones not', () => {
    expect(removedGrades([{ ...saved[0], grade: 'Weiss' }, saved[2]], saved)).toEqual(['5. Kyu']);
    expect(removedGrades([], saved)).toEqual(['6. Kyu', '5. Kyu', '4. Kyu']);
  });
});

describe('moveRow', () => {
  it('swaps with the neighbour and ignores moves off the ends', () => {
    expect(moveRow(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveRow(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveRow(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('templates and copies', () => {
  it('builds kyu grades highest number first, white to brown, then black dan grades', () => {
    const t = kyuDanTemplate(6, 2);
    expect(t.map((r) => r.grade)).toEqual([
      '6. Kyu',
      '5. Kyu',
      '4. Kyu',
      '3. Kyu',
      '2. Kyu',
      '1. Kyu',
      '1. Dan',
      '2. Dan'
    ]);
    expect(t[0].beltColor).toBe('#f5f5f5');
    expect(t[5].beltColor).toBe('#7b4a2d');
    expect(t.filter((r) => r.isDan).every((r) => r.beltColor === '#111111')).toBe(true);
    expect(kyuDanTemplate(1, 0)).toEqual([
      { grade: '1. Kyu', beltColor: '#7b4a2d', beltColor2: null, isDan: false }
    ]);
    expect(kyuDanTemplate(10, 0)).toHaveLength(10);
  });

  it('copies rows as new grades with fresh keys', () => {
    const copied = copyRows(ladderRows(defs, 'Judo'));
    expect(copied.every((r) => r.previous === null)).toBe(true);
    expect(new Set(copied.map((r) => r.key)).size).toBe(3);
  });
});

describe('toHexColor', () => {
  it('gives what a colour input needs', () => {
    expect(toHexColor('#F4D03F')).toBe('#f4d03f');
    expect(toHexColor('#fff')).toBe('#ffffff');
    expect(toHexColor('White')).toBe('#ffffff');
    expect(toHexColor('chartreuse-ish')).toBe('#000000');
    expect(toHexColor(null)).toBe('#000000');
  });
});
