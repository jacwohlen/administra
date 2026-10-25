import type { GradeDefinition, Medal, MemberMedal } from '$lib/models';

export const MEDALS: Medal[] = ['gold', 'silver', 'bronze'];

const MEDAL_EMOJI: Record<Medal, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

export function medalEmoji(medal: Medal): string {
  return MEDAL_EMOJI[medal];
}

export interface MedalTally {
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export function medalTally(medals: Pick<MemberMedal, 'medal'>[]): MedalTally {
  const tally: MedalTally = { gold: 0, silver: 0, bronze: 0, total: 0 };
  for (const m of medals) {
    if (m.medal in tally) {
      tally[m.medal] += 1;
      tally.total += 1;
    }
  }
  return tally;
}

/**
 * How high a grade is, comparable across sections whose ladders have different
 * lengths (Judo has half belts, Aikido does not): any dan above any kyu, a higher
 * dan above a lower one, a lower kyu number above a higher one ("5.5 Kyu" reads
 * as 5.5). Grades without a number fall back to their rank.
 */
function crossSectionLevel(g: { gradeRank: number; grade?: string; isDan?: boolean }): number {
  const n = parseFloat(g.grade ?? '');
  if (Number.isNaN(n)) return g.gradeRank;
  return g.isDan ? 100 + n : 10 - n;
}

/** The highest of a member's grades (one per section), used for the ring around an avatar. */
export function highestGrade<T extends { gradeRank: number; grade?: string; isDan?: boolean }>(
  grades: T[]
): T | undefined {
  return grades.reduce<T | undefined>((best, g) => {
    if (best === undefined) return g;
    const d = crossSectionLevel(g) - crossSectionLevel(best);
    return d > 0 || (d === 0 && g.gradeRank > best.gradeRank) ? g : best;
  }, undefined);
}

/**
 * A white belt is invisible as a ring on a light page and a black belt vanishes on a
 * dark one, so both get a neutral that reads on either ground. A half belt shows the
 * colour it leads to.
 */
export function beltRingColor(beltColor: string, beltColor2?: string | null): string {
  const c = (beltColor2 || beltColor).trim().toLowerCase();
  if (c === '#f5f5f5' || c === '#fff' || c === '#ffffff' || c === 'white') return '#c8c8c8';
  if (c === '#111111' || c === '#000' || c === '#000000' || c === 'black') return '#5a5a5a';
  return beltColor2 || beltColor;
}

/**
 * Dan level (1–6) from a grade name such as "2. Dan", used for the stripes on a black
 * belt. Anything else — kyu grades, levels beyond 6, unparseable names — gives null.
 */
export function danLevel(grade: string): number | null {
  const m = /(\d+)\.?\s*dan\b/i.exec(grade);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : null;
}

/** Ladder per section, lowest grade first. */
export function gradesBySection(definitions: GradeDefinition[]): Map<string, GradeDefinition[]> {
  const map = new Map<string, GradeDefinition[]>();
  for (const d of definitions) {
    const list = map.get(d.section) ?? [];
    list.push(d);
    map.set(d.section, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.gradeRank - b.gradeRank);
  return map;
}

/** Medals newest first; same-day results keep gold before bronze. */
export function sortMedals(medals: MemberMedal[]): MemberMedal[] {
  const order: Record<Medal, number> = { gold: 0, silver: 1, bronze: 2 };
  return [...medals].sort(
    (a, b) => b.date.localeCompare(a.date) || order[a.medal] - order[b.medal]
  );
}
