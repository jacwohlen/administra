import type {
  ExamCandidate,
  ExamItem,
  ExamPart,
  ExamResult,
  ExamScore,
  GradeDefinition
} from '$lib/models';

/**
 * The sheet's general feedback is stored as an exam_scores row under this key, so
 * it follows the sheet's rules like the scores (internal, locked once the result
 * is in). Program item keys never start with an underscore.
 */
export const FEEDBACK_KEY = '_feedback';

/** Points per scored side, as in the legend of the TK's sheets. */
export const SCORE_VALUES = [0, 1, 2] as const;
export const MAX_SIDE_POINTS = 2;

export type ScoreSide = 'left' | 'right' | 'single';
export type ScoreColumn = 'left_points' | 'right_points' | 'points' | 'note';

export function itemSides(item: Pick<ExamItem, 'sides'>): ScoreSide[] {
  return item.sides === 2 ? ['left', 'right'] : ['single'];
}

export function scoreColumn(side: ScoreSide): Exclude<ScoreColumn, 'note'> {
  if (side === 'left') return 'left_points';
  if (side === 'right') return 'right_points';
  return 'points';
}

export function itemMaxPoints(item: Pick<ExamItem, 'sides'>): number {
  return itemSides(item).length * MAX_SIDE_POINTS;
}

export function partMaxPoints(part: ExamPart): number {
  return part.items.reduce((sum, item) => sum + itemMaxPoints(item), 0);
}

export function programMaxPoints(parts: ExamPart[]): number {
  return parts.reduce((sum, part) => sum + partMaxPoints(part), 0);
}

/** Points given for one side of an item, null while not scored. */
export function sidePoints(score: ExamScore | undefined, side: ScoreSide): number | null {
  return score?.[scoreColumn(side)] ?? null;
}

export function scoresByItem(scores: ExamScore[]): Map<string, ExamScore> {
  return new Map(scores.map((s) => [s.item_key, s]));
}

export interface PartEvaluation {
  key: string;
  points: number;
  max: number;
  minPoints: number | null;
  /** The part minimum is reached (always true without one) */
  met: boolean;
  /** Sides scored so far, out of `sides` */
  scored: number;
  sides: number;
}

export interface ExamEvaluation {
  points: number;
  max: number;
  minPoints: number;
  parts: PartEvaluation[];
  scored: number;
  sides: number;
  /** Every side of every item has points */
  complete: boolean;
  /** Overall minimum and every part minimum reached: the suggested result */
  passed: boolean;
}

/** Totals of a sheet; unscored sides count as 0. */
export function evaluateExam(
  parts: ExamPart[],
  minPoints: number,
  scores: ExamScore[] | Map<string, ExamScore>
): ExamEvaluation {
  const byItem = scores instanceof Map ? scores : scoresByItem(scores);
  const partResults = parts.map((part): PartEvaluation => {
    let points = 0;
    let scored = 0;
    let sides = 0;
    for (const item of part.items) {
      for (const side of itemSides(item)) {
        sides += 1;
        const p = sidePoints(byItem.get(item.key), side);
        if (p !== null) {
          points += p;
          scored += 1;
        }
      }
    }
    const min = part.minPoints ?? null;
    return {
      key: part.key,
      points,
      max: partMaxPoints(part),
      minPoints: min,
      met: min === null || points >= min,
      scored,
      sides
    };
  });

  const points = partResults.reduce((sum, p) => sum + p.points, 0);
  const scored = partResults.reduce((sum, p) => sum + p.scored, 0);
  const sides = partResults.reduce((sum, p) => sum + p.sides, 0);
  return {
    points,
    max: programMaxPoints(parts),
    minPoints,
    parts: partResults,
    scored,
    sides,
    complete: scored === sides,
    passed: points >= minPoints && partResults.every((p) => p.met)
  };
}

/** The local copy of the scores after one change, as the upsert will leave it. */
export function applyScore(
  scores: ExamScore[],
  candidateId: number,
  itemKey: string,
  column: ScoreColumn,
  value: number | string | null
): ExamScore[] {
  const existing = scores.find((s) => s.candidate_id === candidateId && s.item_key === itemKey);
  if (existing) {
    return scores.map((s) => (s === existing ? { ...s, [column]: value } : s));
  }
  const fresh: ExamScore = {
    candidate_id: candidateId,
    item_key: itemKey,
    left_points: null,
    right_points: null,
    points: null,
    note: null
  };
  return [...scores, { ...fresh, [column]: value }];
}

/** 'examined' is the member's view of a result: done, without saying how it went */
export type CandidateState =
  ExamResult | 'registered' | 'invited' | 'withdrawn' | 'grading' | 'examined';

/** One label for where a candidate stands, from registration to result. */
export function candidateState(
  c: Pick<ExamCandidate, 'status' | 'started_at' | 'result'>
): CandidateState {
  if (c.result) return c.result;
  if (c.status === 'withdrawn') return 'withdrawn';
  if (c.started_at) return 'grading';
  return c.status;
}

/**
 * Kyu grades a member can register for: everything above their current grade
 * in that section (all kyu grades without one). Dan gradings happen outside
 * the club.
 */
export function registrableGrades(
  ladder: GradeDefinition[],
  currentGrade?: string | null
): GradeDefinition[] {
  const sorted = [...ladder].sort((a, b) => a.gradeRank - b.gradeRank);
  const currentRank = sorted.find((g) => g.grade === currentGrade)?.gradeRank ?? 0;
  return sorted.filter((g) => !g.isDan && g.gradeRank > currentRank);
}

/**
 * The grade to suggest for a registration: the next one after the current grade.
 * Without a grade in the section, the first one with a program, which skips the
 * white belt everybody starts with in Judo.
 */
export function suggestedGrade(
  ladder: GradeDefinition[],
  currentGrade: string | null | undefined,
  hasProgram: (grade: string) => boolean
): GradeDefinition | undefined {
  const grades = registrableGrades(ladder, currentGrade);
  if (currentGrade) return grades[0];
  return grades.find((g) => hasProgram(g.grade)) ?? grades[0];
}

export interface CandidateGroup {
  /** Exam group from the call-up, null for candidates not yet assigned */
  name: string | null;
  candidates: ExamCandidate[];
}

function byCallTimeAndName(a: ExamCandidate, b: ExamCandidate): number {
  return (
    (a.call_time ?? '99:99').localeCompare(b.call_time ?? '99:99') ||
    (a.member?.lastname ?? '').localeCompare(b.member?.lastname ?? '') ||
    (a.member?.firstname ?? '').localeCompare(b.member?.firstname ?? '')
  );
}

/** Candidates by exam group in call-up order; unassigned candidates come last. */
export function groupCandidates(candidates: ExamCandidate[]): CandidateGroup[] {
  const groups = new Map<string | null, ExamCandidate[]>();
  for (const c of [...candidates].sort(byCallTimeAndName)) {
    const name = c.group_name?.trim() || null;
    groups.set(name, [...(groups.get(name) ?? []), c]);
  }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, candidates: list }))
    .sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return byCallTimeAndName(a.candidates[0], b.candidates[0]);
    });
}

/**
 * Candidates graded side by side on one sheet must be scored on the same items:
 * those sharing a grade go together, and among started sheets only those with the
 * same program snapshot. Candidates not started yet join the first sheet of their
 * grade and get its snapshot when they are first scored.
 */
export function sheetGroups(candidates: ExamCandidate[]): ExamCandidate[][] {
  const groups = new Map<string, ExamCandidate[]>();
  const firstOfGrade = new Map<string, string>();
  const waiting: [string, ExamCandidate][] = [];
  for (const c of candidates) {
    const grade = `${c.section}\u0000${c.grade}`;
    if (!c.program) {
      waiting.push([grade, c]);
      continue;
    }
    const key = `${grade}\u0000${JSON.stringify(c.program)}`;
    if (!firstOfGrade.has(grade)) firstOfGrade.set(grade, key);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [grade, c] of waiting) {
    const key = firstOfGrade.get(grade) ?? grade;
    if (!firstOfGrade.has(grade)) firstOfGrade.set(grade, key);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  // In the order the candidates were picked
  const order = (c: ExamCandidate) => candidates.indexOf(c);
  return [...groups.values()]
    .map((g) => g.sort((a, b) => order(a) - order(b)))
    .sort((a, b) => order(a[0]) - order(b[0]));
}

/**
 * A key for a new item. Random rather than counted, so a deleted item's key is
 * never handed to a different technique: sheets started with the old program
 * still hold scores under it.
 */
export function newItemKey(part: Pick<ExamPart, 'key'>, parts: ExamPart[]): string {
  const used = new Set(parts.flatMap((p) => p.items.map((i) => i.key)));
  let key: string;
  do {
    key = `${part.key}-${crypto.randomUUID().slice(0, 8)}`;
  } while (used.has(key));
  return key;
}

/** A key for a new part, derived from its title and unique within the program. */
export function newPartKey(title: string, parts: ExamPart[]): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'part';
  const used = new Set(parts.map((p) => p.key));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export type ProgramProblem =
  | 'noParts'
  | 'emptyPartTitle'
  | 'emptyPart'
  | 'emptyItemName'
  | 'duplicateKey'
  | 'partMinTooHigh'
  | 'minTooHigh';

/** What keeps a program from being saved, as i18n keys (page.exams.programs.problems.*). */
export function programProblems(parts: ExamPart[], minPoints: number): ProgramProblem[] {
  const problems = new Set<ProgramProblem>();
  if (parts.length === 0) problems.add('noParts');
  const keys = new Set<string>();
  for (const part of parts) {
    if (!part.title.trim()) problems.add('emptyPartTitle');
    if (part.items.length === 0) problems.add('emptyPart');
    if ((part.minPoints ?? 0) > partMaxPoints(part)) problems.add('partMinTooHigh');
    for (const item of part.items) {
      if (!item.name.trim()) problems.add('emptyItemName');
      if (keys.has(item.key)) problems.add('duplicateKey');
      keys.add(item.key);
    }
  }
  if (minPoints > programMaxPoints(parts)) problems.add('minTooHigh');
  return [...problems];
}

/** Three quarters of the maximum, rounded down, as on the TK's sheets. */
export function defaultMinPoints(max: number): number {
  return Math.floor(max * 0.75);
}

/** Name examiners sign with: full name, else the part of the e-mail before the @. */
export function examinerName(profile: { full_name?: string | null; email: string }): string {
  return profile.full_name?.trim() || profile.email.split('@')[0];
}
