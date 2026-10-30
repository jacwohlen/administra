import { describe, expect, it } from 'vitest';
import {
  bestMatch,
  normalizeName,
  rankMembers,
  sameName,
  scoreName,
  SUGGEST_SCORE
} from './nameMatch';

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

describe('sameName', () => {
  it('needs the exact last and first name', () => {
    expect(sameName('Muster Jana', { id: 1, firstname: 'Jana', lastname: 'Muster' })).toBe(true);
    expect(
      sameName('Mueller Anna-Lena', { id: 1, firstname: 'Anna-Lena', lastname: 'Müller' })
    ).toBe(true);
    for (const [written, firstname] of [
      ['Jan Muster', 'Jana'],
      ['Marco Muster', 'Marcel'],
      ['Daniel Muster', 'Daniela'],
      ['Muster', 'Muster']
    ]) {
      expect(sameName(written, { id: 1, firstname, lastname: 'Muster' }), written).toBe(false);
    }
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
    expect(bestMatch('Jose Garcia', members).member?.id).toBe(5);
  });

  it('takes an initial only for preferred members, a short form never', () => {
    expect(bestMatch('B. Keller', members).member).toBeNull();
    expect(bestMatch('B. Keller', members, { preferred: new Set([3]) }).member?.id).toBe(3);
    const short = bestMatch('Beni Keller', members, { preferred: new Set([3]) });
    expect(short.member).toBeNull();
    expect(short.candidates[0].member.id).toBe(3);
  });

  it('never takes a sibling on the roster for a guest', () => {
    const roster = [
      { id: 1, firstname: 'Marcel', lastname: 'Huber' },
      { id: 2, firstname: 'Janine', lastname: 'Müller' }
    ];
    const preferred = new Set([1, 2]);
    expect(bestMatch('Martin Huber', roster, { preferred }).member).toBeNull();
    expect(bestMatch('Jan Müller', roster, { preferred }).member).toBeNull();
    expect(bestMatch('Jan Müller', roster, { preferred }).candidates[0].member.id).toBe(2);
  });

  it('suggests a member for a last-name initial', () => {
    const club = [
      { id: 1, firstname: 'Lena', lastname: 'Meier' },
      { id: 2, firstname: 'Tim', lastname: 'Schmid' }
    ];
    const result = bestMatch('Lena M.', club);
    expect(result.member).toBeNull();
    expect(result.candidates[0].member.id).toBe(1);
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(SUGGEST_SCORE);
    expect(scoreName('Lena M.', club[0])).toBeGreaterThan(scoreName('Lena', club[0]));
  });

  it('suggests, but never takes, a last name with a typo', () => {
    const result = bestMatch('Kelller Benjamin', members);
    expect(result.member).toBeNull();
    expect(result.candidates[0].member.id).toBe(3);
  });

  it('never takes another family name that merely looks alike', () => {
    const club = [
      { id: 1, firstname: 'Lena', lastname: 'Hugentobler' },
      { id: 2, firstname: 'Peter', lastname: 'Meierhans' },
      { id: 3, firstname: 'Lena', lastname: 'Meier' },
      { id: 4, firstname: 'Marco', lastname: 'Schmid' },
      { id: 5, firstname: 'Janine', lastname: 'Müller' }
    ];
    for (const written of [
      'Lena Hug',
      'Peter Meier',
      'Lena Maier',
      'Marco Schmidt',
      'Jan Müller'
    ]) {
      expect(bestMatch(written, club).member, written).toBeNull();
    }
  });

  it('prefers the roster between members with the same name', () => {
    const twins = [
      { id: 5, firstname: 'Hans', lastname: 'Muster' },
      { id: 9, firstname: 'Hans', lastname: 'Muster' }
    ];
    const result = bestMatch('Muster Hans', twins, { preferred: new Set([9]) });
    expect(result.member).toBeNull();
    expect(result.candidates[0].member.id).toBe(9);
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
