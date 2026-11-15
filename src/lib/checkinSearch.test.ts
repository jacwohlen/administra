import { describe, expect, it } from 'vitest';
import { addCandidates, newMemberName, searchesToAdd, searchWords } from './checkinSearch.ts';

const people = [
  { id: 3, lastname: 'Müller', firstname: 'Ben' },
  { id: 1, lastname: 'Müller', firstname: 'Anna' },
  { id: 2, lastname: 'Amüller', firstname: 'Carla' },
  { id: 4, lastname: 'Meier', firstname: 'Müller' }
];

describe('searchWords', () => {
  it('splits on whitespace and drops filter characters', () => {
    expect(searchWords('  mül  an ')).toEqual(['mül', 'an']);
    expect(searchWords('a%b_c,(d)*\\')).toEqual(['a', 'b', 'c', 'd']);
    expect(searchWords('')).toEqual([]);
  });
});

describe('searchesToAdd', () => {
  it('needs two characters', () => {
    expect(searchesToAdd('m')).toBe(false);
    expect(searchesToAdd(' m ')).toBe(false);
    expect(searchesToAdd('mü')).toBe(true);
  });
});

describe('addCandidates', () => {
  it('leaves out who is on the list, matches word starts, sorts by name', () => {
    expect(addCandidates(people, ['1'], 'mül').map((p) => p.id)).toEqual([4, 3]);
    expect(addCandidates(people, [], 'mül an').map((p) => p.id)).toEqual([1]);
    expect(addCandidates(people, [1, 3, 4], 'mül')).toEqual([]);
  });
});

describe('newMemberName', () => {
  it('takes the first word as last name', () => {
    expect(newMemberName(' Muster  Hans Peter ')).toEqual({
      lastname: 'Muster',
      firstname: 'Hans Peter'
    });
    expect(newMemberName('Muster')).toEqual({ lastname: 'Muster', firstname: '' });
  });
});
