import type { DirectoryMember } from '$lib/models';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Directory filter: every word of the query must start a word of the name
 * ("jo mü" finds "Jonas Müller"), and a section narrows the list further.
 */
export function filterDirectory<T extends DirectoryMember>(
  members: T[],
  query: string,
  section: string | null = null
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return members.filter((m) => {
    if (section && !m.sections.includes(section)) return false;
    if (terms.length === 0) return true;
    const words = normalize(`${m.firstname} ${m.lastname}`).split(/[\s-]+/);
    return terms.every((t) => words.some((w) => w.startsWith(t)));
  });
}

/** Sections present in the directory, alphabetically */
export function directorySections(members: DirectoryMember[]): string[] {
  return [...new Set(members.flatMap((m) => m.sections))].sort((a, b) => a.localeCompare(b));
}
