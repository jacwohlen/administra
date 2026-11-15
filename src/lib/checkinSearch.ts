/**
 * The one field above a check-in list (trainings and events): it searches the
 * list and offers to add whoever is not on it yet. Helpers for the part that
 * searches the club's members.
 */
import { matchesCheckinSearch } from './eventUtils.ts';

/** From two letters on, the field also looks for people to add */
export const ADD_SEARCH_MIN_LENGTH = 2;

/**
 * The words to look up in the database: characters with a meaning in a
 * PostgREST filter (`%`, `_`, `,`, `(`, `)`, `*`, `\`) are dropped.
 */
export function searchWords(term: string): string[] {
  return term
    .replace(/[%_,()*\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** True when the term is long enough to look for people to add */
export function searchesToAdd(term: string): boolean {
  return term.trim().length >= ADD_SEARCH_MIN_LENGTH;
}

interface Person {
  id: string | number;
  lastname: string;
  firstname: string;
}

/**
 * The people to offer: those matching every word at the start of a name (as
 * the list does), not already on the list, sorted by name.
 */
export function addCandidates<T extends Person>(
  found: T[],
  listed: Iterable<string | number>,
  term: string
): T[] {
  const onList = new Set([...listed].map(String));
  return found
    .filter((p) => !onList.has(String(p.id)))
    .filter((p) => matchesCheckinSearch({ ...p, attended: false }, term))
    .sort(
      (a, b) =>
        a.lastname.localeCompare(b.lastname, 'de') || a.firstname.localeCompare(b.firstname, 'de')
    );
}

/** "Muster Hans Peter" → last name Muster, first name Hans Peter (as the list shows names) */
export function newMemberName(term: string): { lastname: string; firstname: string } {
  const [lastname = '', ...rest] = term.trim().split(/\s+/);
  return { lastname, firstname: rest.join(' ') };
}
