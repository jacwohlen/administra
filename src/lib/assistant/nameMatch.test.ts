import { describe, expect, it } from 'vitest';
import { bestMatch, normalizeName, rankMembers, scoreName } from './nameMatch';

const members = [
  { id: 1, firstname: 'Lena', lastname: 'Müller' },
  { id: 2, firstname: 'Lukas', lastname: 'Müller' },
  { id: 3, firstname: 'Benjamin', lastname: 'Keller' },
  { id: 4, firstname: 'Anna-Lena', lastname: 'Muster' },
  { id: 5, firstname: 'José', lastname: 'García' },
  { id: 6, firstname: 'Tim', lastname: 'Schneider' },
  { id: 7, firstname: 'Tim', lastname: 'Weber' }
];

describe('normalizeName', () => {
  it('folds accents, umlauts and case', () => {
    expect(normalizeName('Müller')).toBe(normalizeName('MUELLER'));
    expect(normalizeName('José García')).toBe('jose garcia');
    expect(normalizeName('Strasse')).toBe(normalizeName('Straße'));
  });
});

describe('scoreName', () => {
  it('scores the full name in either order as a perfect match', () => {
    expect(scoreName('Lena Müller', members[0])).toBe(1);
    expect(scoreName('Müller Lena', members[0])).toBe(1);
    expect(scoreName('mueller lena', members[0])).toBe(1);
  });

  it('needs the last name', () => {
    expect(scoreName('Lena Keller', members[0])).toBeLessThan(0.6);
  });

  it('scores a single word low, so it is never taken alone', () => {
    expect(scoreName('Lena', members[0])).toBeLessThan(0.85);
    expect(scoreName('Müller', members[0])).toBeLessThan(0.85);
  });
});

describe('bestMatch', () => {
  it('takes a clear match', () => {
    expect(bestMatch('Keller Benjamin', members).member?.id).toBe(3);
    expect(bestMatch('Beni Keller', members).member?.id).toBe(3);
    expect(bestMatch('Jose Garcia', members).member?.id).toBe(5);
  });

  it('accepts a typo', () => {
    expect(bestMatch('Kelller Benjamin', members).member?.id).toBe(3);
  });

  it('leaves an initial shared by two members to the user', () => {
    const result = bestMatch('L. Müller', members);
    expect(result.member).toBeNull();
    expect(result.candidates.map((c) => c.member.id).sort()).toEqual([1, 2]);
  });

  it('offers first-name-only matches as candidates, never takes them alone', () => {
    const result = bestMatch('Tim', members);
    expect(result.member).toBeNull();
    expect(result.candidates.map((c) => c.member.id).sort()).toEqual([6, 7]);
  });

  it('prefers members of the roster on ties', () => {
    const ranked = rankMembers('Tim', members, { preferred: new Set([7]) });
    expect(ranked[0].member.id).toBe(7);
  });

  it('finds double first names', () => {
    expect(bestMatch('Anna-Lena Muster', members).member?.id).toBe(4);
  });

  it('returns nothing for unknown names', () => {
    expect(bestMatch('Hans Meier', members)).toEqual({ member: null, candidates: [] });
    expect(bestMatch('', members)).toEqual({ member: null, candidates: [] });
  });
});
