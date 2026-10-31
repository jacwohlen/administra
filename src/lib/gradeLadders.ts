import type { GradeDefinition } from '$lib/models';
import { gradesBySection } from '$lib/gradeUtils';

/**
 * Editing grade ladders (/dashboard/settings/grades): one ladder per section,
 * saved whole through save_grade_ladder() (see docs/GRADE_LADDERS.md).
 */

/** One rung in the editor */
export interface LadderRow {
  /** Stable key for the list while editing */
  key: string;
  grade: string;
  /** The grade's saved name, null for a grade added in the editor */
  previous: string | null;
  beltColor: string;
  /** Second colour of a two-coloured (half) belt, null for one colour */
  beltColor2: string | null;
  isDan: boolean;
}

/** What save_grade_ladder() takes, lowest grade first */
export interface LadderPayloadRow {
  grade: string;
  previous: string | null;
  beltColor: string;
  beltColor2: string | null;
  isDan: boolean;
}

export type LadderProblem =
  | { kind: 'emptyName'; index: number }
  | { kind: 'nameTooLong'; index: number }
  | { kind: 'duplicate'; grade: string }
  | { kind: 'badColor'; index: number };

export const MAX_GRADE_NAME = 40;

const COLOR = /^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-zA-Z]{3,20})$/;

let keyCounter = 0;
export function newRowKey(): string {
  keyCounter += 1;
  return `new-${keyCounter}`;
}

/** The saved ladder of a section as editor rows, lowest grade first. */
export function ladderRows(definitions: GradeDefinition[], section: string): LadderRow[] {
  return (gradesBySection(definitions).get(section) ?? []).map((d) => ({
    key: `saved-${d.grade}`,
    grade: d.grade,
    previous: d.grade,
    beltColor: d.beltColor,
    beltColor2: d.beltColor2 ?? null,
    isDan: d.isDan
  }));
}

/** A copy of rows as new grades (for "start from another ladder" or a template). */
export function copyRows(rows: Omit<LadderRow, 'key' | 'previous'>[]): LadderRow[] {
  return rows.map((r) => ({ ...r, key: newRowKey(), previous: null }));
}

/** Rows as save_grade_ladder() takes them: names trimmed, empty second colour as none. */
export function ladderPayload(rows: LadderRow[]): LadderPayloadRow[] {
  return rows.map((r) => ({
    grade: r.grade.trim(),
    previous: r.previous,
    beltColor: r.beltColor.trim(),
    beltColor2: r.beltColor2?.trim() || null,
    isDan: r.isDan
  }));
}

/** What the database would refuse, checked before saving; empty when fine. */
export function ladderProblems(rows: LadderRow[]): LadderProblem[] {
  const problems: LadderProblem[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();
  rows.forEach((r, index) => {
    const name = r.grade.trim();
    if (!name) problems.push({ kind: 'emptyName', index });
    else if (name.length > MAX_GRADE_NAME) problems.push({ kind: 'nameTooLong', index });
    const lower = name.toLowerCase();
    if (name && seen.has(lower) && !reported.has(lower)) {
      problems.push({ kind: 'duplicate', grade: name });
      reported.add(lower);
    }
    seen.add(lower);
    const c2 = r.beltColor2?.trim();
    if (!COLOR.test(r.beltColor.trim()) || (c2 && !COLOR.test(c2))) {
      problems.push({ kind: 'badColor', index });
    }
  });
  return problems;
}

/** Whether the rows differ from the saved ladder. */
export function ladderChanged(rows: LadderRow[], saved: LadderRow[]): boolean {
  return JSON.stringify(ladderPayload(rows)) !== JSON.stringify(ladderPayload(saved));
}

/** Saved grades the rows no longer contain: they are deleted on save. */
export function removedGrades(rows: LadderRow[], saved: LadderRow[]): string[] {
  const kept = new Set(rows.map((r) => r.previous).filter((p): p is string => p !== null));
  return saved.filter((s) => s.previous !== null && !kept.has(s.previous)).map((s) => s.grade);
}

/** Move a row up (-1) or down (+1); out of range leaves the list as it is. */
export function moveRow<T>(rows: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The sections an admin can give a ladder: the club's sections first (in
 * their order), then sections that have a ladder but are no longer a club
 * section (so an old ladder can still be edited or removed).
 */
export function ladderSections(
  clubSections: string[],
  definitions: GradeDefinition[]
): { section: string; grades: number; isClubSection: boolean }[] {
  const counts = new Map<string, number>();
  for (const d of definitions) counts.set(d.section, (counts.get(d.section) ?? 0) + 1);
  const club = [...new Set(clubSections.map((s) => s.trim()).filter(Boolean))];
  const others = [...counts.keys()].filter((s) => !club.includes(s)).sort();
  return [
    ...club.map((section) => ({ section, grades: counts.get(section) ?? 0, isClubSection: true })),
    ...others.map((section) => ({ section, grades: counts.get(section)!, isClubSection: false }))
  ];
}

/** A ladder to start from: n kyu grades (highest number first) and m dan grades. */
export function kyuDanTemplate(kyu: number, dan: number): Omit<LadderRow, 'key' | 'previous'>[] {
  const KYU_COLORS = ['#f5f5f5', '#f4d03f', '#f0932b', '#27ae60', '#2e86de', '#7b4a2d'];
  const rows: Omit<LadderRow, 'key' | 'previous'>[] = [];
  for (let i = kyu; i >= 1; i--) {
    // The lowest kyu is white and 1. Kyu brown; the colours between follow the Judo order
    const step = kyu === 1 ? KYU_COLORS.length - 1 : Math.round(((kyu - i) * 5) / (kyu - 1));
    rows.push({ grade: `${i}. Kyu`, beltColor: KYU_COLORS[step], beltColor2: null, isDan: false });
  }
  for (let i = 1; i <= dan; i++) {
    rows.push({ grade: `${i}. Dan`, beltColor: '#111111', beltColor2: null, isDan: true });
  }
  return rows;
}

/** Which saved grades are in use (gradings, exam registrations, programs): "section\u0000grade". */
export function usageKey(section: string, grade: string): string {
  return `${section}\u0000${grade}`;
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  yellow: '#ffff00',
  orange: '#ffa500',
  green: '#008000',
  blue: '#0000ff',
  brown: '#a52a2a',
  red: '#ff0000',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080'
};

/** A colour as `<input type="color">` needs it (#rrggbb); unknown names give black. */
export function toHexColor(color: string | null | undefined): string {
  const c = (color ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return NAMED[c] ?? '#000000';
}
