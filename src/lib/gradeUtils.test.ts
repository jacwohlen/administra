import { describe, it, expect } from 'vitest';
import {
  beltRingColor,
  gradesBySection,
  highestGrade,
  medalEmoji,
  medalTally,
  sortMedals
} from './gradeUtils';
import type { GradeDefinition, MemberMedal } from './models';

const def = (section: string, grade: string, gradeRank: number): GradeDefinition => ({
  section,
  grade,
  gradeRank,
  beltColor: '#000',
  isDan: gradeRank >= 7
});

const medal = (id: number, date: string, m: MemberMedal['medal']): MemberMedal => ({
  id,
  memberId: 1,
  eventId: null,
  competition: 'c',
  date,
  medal: m
});

describe('medalTally', () => {
  it('counts each colour and the total', () => {
    const tally = medalTally([
      medal(1, '2026-01-01', 'gold'),
      medal(2, '2026-01-02', 'bronze'),
      medal(3, '2026-01-03', 'bronze')
    ]);
    expect(tally).toEqual({ gold: 1, silver: 0, bronze: 2, total: 3 });
  });

  it('is all zero without medals', () => {
    expect(medalTally([])).toEqual({ gold: 0, silver: 0, bronze: 0, total: 0 });
  });
});

describe('medalEmoji', () => {
  it('maps every colour', () => {
    expect(medalEmoji('gold')).toBe('🥇');
    expect(medalEmoji('silver')).toBe('🥈');
    expect(medalEmoji('bronze')).toBe('🥉');
  });
});

describe('highestGrade', () => {
  it('returns the grade with the highest rank', () => {
    const best = highestGrade([
      { section: 'Judo', gradeRank: 4 },
      { section: 'Aikido', gradeRank: 2 }
    ]);
    expect(best?.section).toBe('Judo');
  });

  it('is undefined without grades', () => {
    expect(highestGrade([])).toBeUndefined();
  });
});

describe('beltRingColor', () => {
  it('replaces white and black with neutrals that show on both themes', () => {
    expect(beltRingColor('#f5f5f5')).toBe('#c8c8c8');
    expect(beltRingColor('#111111')).toBe('#5a5a5a');
  });

  it('keeps coloured belts as they are', () => {
    expect(beltRingColor('#27ae60')).toBe('#27ae60');
  });
});

describe('gradesBySection', () => {
  it('groups by section and orders each ladder lowest first', () => {
    const map = gradesBySection([
      def('Judo', '1. Dan', 7),
      def('Judo', '6. Kyu', 1),
      def('Aikido', '5. Kyu', 2)
    ]);
    expect([...map.keys()]).toEqual(['Judo', 'Aikido']);
    expect(map.get('Judo')?.map((d) => d.grade)).toEqual(['6. Kyu', '1. Dan']);
  });
});

describe('sortMedals', () => {
  it('orders newest first, gold before bronze on the same day', () => {
    const sorted = sortMedals([
      medal(1, '2025-11-08', 'bronze'),
      medal(2, '2026-03-15', 'bronze'),
      medal(3, '2026-03-15', 'gold')
    ]);
    expect(sorted.map((m) => m.id)).toEqual([3, 2, 1]);
  });
});
