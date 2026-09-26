import { describe, expect, it } from 'vitest';
import type { DirectoryMember } from '$lib/models';
import { directorySections, filterDirectory } from './directory';

const member = (
  id: number,
  firstname: string,
  lastname: string,
  sections: string[] = []
): DirectoryMember => ({ id, firstname, lastname, sections, isMine: false });

const members = [
  member(1, 'Jonas', 'Müller', ['Judo']),
  member(2, 'Anna-Lena', 'Schmid', ['Aikido', 'Judo']),
  member(3, 'Noah', 'Weber', ['Aikido'])
];

describe('filterDirectory', () => {
  it('returns everybody for an empty query', () => {
    expect(filterDirectory(members, '  ')).toHaveLength(3);
  });

  it('matches word prefixes in any order, ignoring case and accents', () => {
    expect(filterDirectory(members, 'mu jo').map((m) => m.id)).toEqual([1]);
    expect(filterDirectory(members, 'MÜLLER').map((m) => m.id)).toEqual([1]);
    expect(filterDirectory(members, 'lena').map((m) => m.id)).toEqual([2]);
  });

  it('does not match inside a word', () => {
    expect(filterDirectory(members, 'nas')).toHaveLength(0);
  });

  it('narrows by section', () => {
    expect(filterDirectory(members, '', 'Aikido').map((m) => m.id)).toEqual([2, 3]);
    expect(filterDirectory(members, 'noah', 'Judo')).toHaveLength(0);
  });
});

describe('directorySections', () => {
  it('lists each section once, sorted', () => {
    expect(directorySections(members)).toEqual(['Aikido', 'Judo']);
  });
});
