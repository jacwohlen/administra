import type { GradeDefinition, MemberCurrentGrade, MemberGrade } from '$lib/models';
import { AUTO_MATCH_SCORE, scoreName } from './nameMatch';
import { cleanText, isIsoDate } from './proposals';
import type { GradeEntry, GradesProposal } from './types';

/**
 * Review of a Judo pass read by the Daten-Assistent (kind 'grades'): maps
 * what the model read to the member's grade ladder, compares it with the
 * gradings already recorded (member_grades, one row per member, section and
 * grade) and builds the rows to write. Pure, so the review dialog only
 * renders and saves what comes out of here.
 */

/** Longest note written; the pass marker plus the examiner */
export const NOTE_MAX = 100;

// ----- Reading the grade -----

/** Lowercase, without accents, ß → ss, "5½" and "5 1/2" → "5.5". */
function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/(\d)\s*(?:½|1\/2)/g, '$1.5');
}

const ORDINAL = '(?:te|ter|th|st|nd|rd|er|eme|e)?';
// The number must not continue a date or another number ("12.06.2015 5. Kyu")
const KYU = new RegExp(`(?<![\\d.,])(\\d{1,2})(?:[.,](5))?\\s*\\.?\\s*${ORDINAL}\\s*kyu`, 'g');
const DAN = new RegExp(`(?<![\\d.,])(\\d{1,2})\\s*\\.?\\s*${ORDINAL}\\s*dan`, 'g');
const KYU_JP = /\b(ik|i|ni|san|yon|go|rok|ro)[\s-]?kyu/g;
const DAN_JP = /\b(sho|ni|san|yon|yo|go|roku|shichi|nana|hachi|ku|ju)[\s-]?dan/g;
const KYU_NUMBERS: Record<string, number> = {
  ik: 1,
  i: 1,
  ni: 2,
  san: 3,
  yon: 4,
  go: 5,
  rok: 6,
  ro: 6
};
const DAN_NUMBERS: Record<string, number> = {
  sho: 1,
  ni: 2,
  san: 3,
  yon: 4,
  yo: 4,
  go: 5,
  roku: 6,
  shichi: 7,
  nana: 7,
  hachi: 8,
  ku: 9,
  ju: 10
};

/**
 * Rungs of the ladder a written kyu or dan number stands for ("5. Kyu",
 * "5 Kyu", "5.5 Kyu", "1. Dan", "Shodan"); null when the text names none.
 * An empty list means a grade the ladder does not have (e.g. "6. Dan").
 */
export function gradesByNumber(text: string, ladder: GradeDefinition[]): GradeDefinition[] | null {
  const t = fold(text);
  const names = new Set<string>();
  for (const m of t.matchAll(KYU)) names.add(m[2] ? `${+m[1]}.5 Kyu` : `${+m[1]}. Kyu`);
  for (const m of t.matchAll(DAN)) names.add(`${+m[1]}. Dan`);
  for (const m of t.matchAll(KYU_JP)) names.add(`${KYU_NUMBERS[m[1]]}. Kyu`);
  for (const m of t.matchAll(DAN_JP)) names.add(`${DAN_NUMBERS[m[1]]}. Dan`);
  if (names.size === 0) return null;
  return ladder.filter((d) => names.has(d.grade));
}

type BeltColour = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'brown' | 'black' | 'red';

/** Reference shades: the ladder's colours (grade_definitions.beltColor), red for high dan belts */
const SHADES: [BeltColour, number, number, number][] = [
  ['white', 245, 245, 245],
  ['yellow', 244, 208, 63],
  ['orange', 240, 147, 43],
  ['green', 39, 174, 96],
  ['blue', 46, 134, 222],
  ['brown', 123, 74, 45],
  ['black', 17, 17, 17],
  ['red', 200, 40, 40]
];

/** The named colour closest to a ladder colour such as '#f4d03f'. */
function shadeOf(hex: string | null | undefined): BeltColour | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex?.trim() ?? '');
  if (!m) return null;
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  let best: BeltColour | null = null;
  let bestDistance = Infinity;
  for (const [name, R, G, B] of SHADES) {
    const distance = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [name, distance];
  }
  return best;
}

const COLOUR_WORDS: Record<string, BeltColour> = {
  weiss: 'white',
  white: 'white',
  gelb: 'yellow',
  yellow: 'yellow',
  orange: 'orange',
  gruen: 'green',
  grun: 'green',
  green: 'green',
  blau: 'blue',
  blue: 'blue',
  braun: 'brown',
  brown: 'brown',
  schwarz: 'black',
  black: 'black',
  rot: 'red',
  red: 'red'
};
// Inside compounds ("Halbgelbgurt"), except the short red words ("Protokoll")
const COLOUR_PATTERN =
  /weiss|white|gelb|yellow|orange|gruen|grun|green|blau|blue|braun|brown|schwarz|black|(?<![a-z])(?:rot|red)/g;

/**
 * Rungs of the ladder a belt colour stands for: "gelb" or "Gelbgurt" a
 * one-coloured belt, "weiss-gelb" or "Halbgelb" the half belt leading to
 * yellow. Null when the text names no colour; several rungs when the
 * colour is not unique (Aikido kyu grades are all white, dan all black).
 */
export function gradesByColour(text: string, ladder: GradeDefinition[]): GradeDefinition[] | null {
  const t = fold(text);
  const found = [...new Set([...t.matchAll(COLOUR_PATTERN)].map((m) => COLOUR_WORDS[m[0]]))];
  if (found.length === 0) return null;
  const half = /halb|half/.test(t);
  return ladder.filter((d) => {
    const first = shadeOf(d.beltColor);
    const second = d.beltColor2 ? shadeOf(d.beltColor2) : null;
    if (found.length === 1) return half ? second === found[0] : first === found[0] && !second;
    if (found.length === 2) {
      return (
        !!first && !!second && first !== second && found.includes(first) && found.includes(second)
      );
    }
    return false;
  });
}

/**
 * The ladder grade an entry stands for, '' when the user has to pick: the
 * model's grade if the ladder has it, else the written number, else the
 * colour, as long as it points to exactly one rung.
 */
export function mapGrade(entry: GradeEntry, ladder: GradeDefinition[]): string {
  if (ladder.some((d) => d.grade === entry.grade)) return entry.grade;
  const byNumber = gradesByNumber(entry.gradeAsWritten, ladder);
  if (byNumber) return byNumber.length === 1 ? byNumber[0].grade : '';
  const sets = [
    gradesByColour(entry.gradeAsWritten, ladder),
    gradesByColour(entry.beltColor, ladder)
  ].filter((s): s is GradeDefinition[] => s !== null);
  if (sets.length === 0) return '';
  const common = sets.reduce((all, s) => all.filter((d) => s.includes(d)));
  return common.length === 1 ? common[0].grade : '';
}

/** What the pass says ("Gelbgurt", "orange") if it does not fit `grade`, else null. */
export function writtenConflict(
  entry: GradeEntry,
  ladder: GradeDefinition[],
  grade: string
): string | null {
  for (const text of [entry.gradeAsWritten, entry.beltColor]) {
    const readings = [gradesByNumber(text, ladder), gradesByColour(text, ladder)];
    if (readings.some((r) => r !== null && !r.some((d) => d.grade === grade))) return text;
  }
  return null;
}

// ----- The review -----

/** What the user can change per row. */
export interface GradeRowInput {
  /** A grade of the chosen section's ladder, '' until picked */
  grade: string;
  /** YYYY-MM-DD, '' while missing */
  examDate: string;
  note: string;
  /** Leave the row out: nothing is written for it */
  skip: boolean;
  /** The grade is recorded with another date: replace that date (opt-in) */
  correct: boolean;
}

export type GradeRowStatus = 'new' | 'exists' | 'changed' | 'duplicate' | 'invalid';

export type GradeIssue =
  | { code: 'noGrade' }
  | { code: 'noDate' }
  | { code: 'partialDate'; written: string }
  | { code: 'badDate' }
  | { code: 'futureDate' }
  | { code: 'beforeBirthday'; birthday: string }
  /** This grade is dated before a lower one */
  | { code: 'beforeLower'; grade: string; date: string }
  /** This grade is dated after a higher one */
  | { code: 'afterHigher'; grade: string; date: string }
  | { code: 'mismatch'; written: string }
  /** Becomes the current belt; `badge`: the section's first dan, which gives the black belt badge */
  | { code: 'dan'; badge: boolean };

export interface GradeReviewRow {
  entry: GradeEntry;
  input: GradeRowInput;
  definition: GradeDefinition | null;
  /** The member's recorded grading of the same section and grade */
  existing: MemberGrade | null;
  status: GradeRowStatus;
  /** Index of the earlier row with the same grade, for duplicates */
  duplicateOf: number | null;
  /** What applying writes: a new grading, or the corrected date of `existing` */
  action: 'insert' | 'update' | null;
  /** Missing or wrong values; such a row is never written */
  errors: GradeIssue[];
  /** Worth a second look, no reason not to save */
  warnings: GradeIssue[];
  /** Meant to be saved but not valid yet: apply waits for a fix or a skip */
  blocking: boolean;
}

export interface GradeReviewContext {
  section: string;
  /** The section's ladder, lowest grade first */
  ladder: GradeDefinition[];
  /** The member's recorded gradings (all sections) */
  history: MemberGrade[];
  /** The member's birthday (YYYY-MM-DD) if known */
  birthday: string | null | undefined;
  /** YYYY-MM-DD, local date */
  today: string;
}

function isPartialDate(value: string): boolean {
  return /^\d{4}(-\d{2})?$/.test(value);
}

/** 2015-06-12 → 12.06.2015, 2015-06 → 06.2015, 2015 → 2015 */
export function formatPassDate(value: string): string {
  const [y, m, d] = value.split('-');
  if (d) return `${d}.${m}.${y}`;
  return m ? `${m}.${y}` : (y ?? '');
}

function dateErrors(examDate: string, written: string, today: string): GradeIssue[] {
  if (!examDate) {
    return isPartialDate(written)
      ? [{ code: 'partialDate', written: formatPassDate(written) }]
      : [{ code: 'noDate' }];
  }
  if (!isIsoDate(examDate)) return [{ code: 'badDate' }];
  if (examDate > today) return [{ code: 'futureDate' }];
  return [];
}

/** Whether the pass says nothing that contradicts the recorded date. */
function sameAsRecorded(examDate: string, written: string, recorded: string): boolean {
  if (examDate) return examDate === recorded;
  return isPartialDate(written) ? recorded.startsWith(written) : true;
}

/** The section the pass is reviewed in: the model's, else the member's current one, else the first. */
export function initialSection(
  proposal: GradesProposal,
  ladders: Map<string, GradeDefinition[]>,
  current: MemberCurrentGrade[]
): string {
  if (ladders.has(proposal.section)) return proposal.section;
  return current.find((g) => ladders.has(g.section))?.section ?? [...ladders.keys()][0] ?? '';
}

/** "Judo-Pass · H. Muster": where the grading comes from, for the history list. */
export function passNote(section: string, examiner: string): string {
  const marker = section ? `${section}-Pass` : 'Pass';
  return cleanText(examiner ? `${marker} · ${examiner}` : marker, NOTE_MAX);
}

export function initialInputs(
  proposal: GradesProposal,
  section: string,
  ladder: GradeDefinition[]
): GradeRowInput[] {
  return proposal.entries.map((entry) => ({
    grade: mapGrade(entry, ladder),
    examDate: isIsoDate(entry.date) ? entry.date : '',
    note: passNote(section, entry.examiner),
    skip: false,
    correct: false
  }));
}

/**
 * After a change of section: grades the new ladder lacks are read again,
 * and a note the user left as it was gets the new section's pass marker.
 */
export function remapInputs(
  entries: GradeEntry[],
  inputs: GradeRowInput[],
  change: { from: string; to: string; ladder: GradeDefinition[] }
): GradeRowInput[] {
  const { from, to, ladder } = change;
  return inputs.map((input, i) => {
    const examiner = entries[i].examiner;
    return {
      ...input,
      grade: ladder.some((d) => d.grade === input.grade)
        ? input.grade
        : mapGrade(entries[i], ladder),
      note: input.note === passNote(from, examiner) ? passNote(to, examiner) : input.note,
      correct: false
    };
  });
}

/**
 * One review row per entry. Status: 'exists' when the grade is recorded on
 * that date (or the pass gives no other date), 'changed' when it is
 * recorded with another date (written only if the user opts in to correct
 * it), 'duplicate' for a second row with the same grade (the first one
 * counts), 'invalid' while grade or date is missing or wrong.
 */
export function reviewGrades(
  entries: GradeEntry[],
  inputs: GradeRowInput[],
  ctx: GradeReviewContext
): GradeReviewRow[] {
  const recorded = ctx.history.filter((h) => h.section === ctx.section);
  const firstRow = new Map<string, number>();

  const rows = entries.map((entry, i): GradeReviewRow => {
    const input = inputs[i];
    const definition = ctx.ladder.find((d) => d.grade === input.grade) ?? null;
    const existing = definition
      ? (recorded.find((h) => h.grade === definition.grade) ?? null)
      : null;
    const dateProblems = dateErrors(input.examDate, entry.date, ctx.today);
    let status: GradeRowStatus;
    let duplicateOf: number | null = null;
    let errors: GradeIssue[] = [];

    if (!definition) {
      status = 'invalid';
      errors = [{ code: 'noGrade' }, ...dateProblems];
    } else if (!input.skip && firstRow.has(definition.grade)) {
      status = 'duplicate';
      duplicateOf = firstRow.get(definition.grade)!;
    } else {
      if (!input.skip) firstRow.set(definition.grade, i);
      if (existing) {
        status = sameAsRecorded(input.examDate, entry.date, existing.examDate)
          ? 'exists'
          : 'changed';
        if (status === 'changed' && input.correct) errors = dateProblems;
      } else {
        status = dateProblems.length > 0 ? 'invalid' : 'new';
        errors = dateProblems;
      }
    }

    const correcting = status === 'changed' && input.correct && !input.skip;
    const action =
      status === 'new' && !input.skip
        ? 'insert'
        : correcting && errors.length === 0
          ? 'update'
          : null;
    const blocking = (status === 'invalid' && !input.skip) || (correcting && errors.length > 0);
    return {
      entry,
      input,
      definition,
      existing,
      status,
      duplicateOf,
      action,
      errors,
      warnings: [],
      blocking
    };
  });

  // The member's gradings as they will be after saving, to check the order
  const timeline = new Map(recorded.map((h) => [h.grade, h.examDate]));
  for (const row of rows) {
    if (row.action && row.definition) timeline.set(row.definition.grade, row.input.examDate);
  }
  const birthday = ctx.birthday && isIsoDate(ctx.birthday) ? ctx.birthday : null;
  const danRecorded = recorded.some((h) => ctx.ladder.some((o) => o.grade === h.grade && o.isDan));

  for (const row of rows) {
    const d = row.definition;
    if (!d || row.status === 'exists' || row.status === 'duplicate') continue;
    const warnings: GradeIssue[] = [];
    const conflict = writtenConflict(row.entry, ctx.ladder, d.grade);
    if (conflict) warnings.push({ code: 'mismatch', written: conflict });
    // Only a dan that ends up the member's top grade changes belt and badge
    const outranked = ctx.ladder.some((o) => o.gradeRank > d.gradeRank && timeline.has(o.grade));
    if (d.isDan && row.status !== 'changed' && !outranked) {
      warnings.push({ code: 'dan', badge: !danRecorded });
    }

    const date = row.input.examDate;
    if (isIsoDate(date) && date <= ctx.today) {
      if (birthday && date < birthday) {
        warnings.push({ code: 'beforeBirthday', birthday: formatPassDate(birthday) });
      }
      const lower = ctx.ladder.find((o) => {
        const other = timeline.get(o.grade);
        return o.gradeRank < d.gradeRank && !!other && other > date;
      });
      if (lower) {
        const other = timeline.get(lower.grade)!;
        warnings.push({ code: 'beforeLower', grade: lower.grade, date: formatPassDate(other) });
      }
      const higher = ctx.ladder.find((o) => {
        const other = timeline.get(o.grade);
        return o.gradeRank > d.gradeRank && !!other && other < date;
      });
      if (higher) {
        const other = timeline.get(higher.grade)!;
        warnings.push({ code: 'afterHigher', grade: higher.grade, date: formatPassDate(other) });
      }
    }
    row.warnings = warnings;
  }
  return rows;
}

export interface GradeReviewSummary {
  inserts: number;
  updates: number;
  /** Rows that still need a fix or a skip */
  blocking: number;
  byStatus: Record<GradeRowStatus, number>;
}

export function summarizeGrades(rows: GradeReviewRow[]): GradeReviewSummary {
  const byStatus: Record<GradeRowStatus, number> = {
    new: 0,
    exists: 0,
    changed: 0,
    duplicate: 0,
    invalid: 0
  };
  for (const row of rows) byStatus[row.status]++;
  return {
    inserts: rows.filter((r) => r.action === 'insert').length,
    updates: rows.filter((r) => r.action === 'update').length,
    blocking: rows.filter((r) => r.blocking).length,
    byStatus
  };
}

// ----- The pass holder -----

export interface HolderCheck {
  /** The name printed in the pass, '' when none was read */
  name: string;
  birthday: string;
  /** null: not printed (or no birthday on record), nothing to compare */
  nameFits: boolean | null;
  birthdayFits: boolean | null;
}

/** Whether the pass looks like the member's own: name and birthday as printed. */
export function checkHolder(
  holder: GradesProposal['holder'],
  member: { firstname: string; lastname: string; birthday?: string | null }
): HolderCheck {
  const nameFits = holder.name
    ? scoreName(holder.name, { id: 0, firstname: member.firstname, lastname: member.lastname }) >=
      AUTO_MATCH_SCORE
    : null;
  const birthdayFits =
    holder.birthday && member.birthday && isIsoDate(member.birthday)
      ? holder.birthday === member.birthday
      : null;
  return { name: holder.name, birthday: holder.birthday, nameFits, birthdayFits };
}

// ----- What is written -----

/** Exactly the columns of the manual "Prüfung erfassen" form (MemberGrades.svelte). */
export interface GradeInsert {
  memberId: number;
  section: string;
  grade: string;
  examDate: string;
  note: string | null;
}

/** The new date of a recorded grading of this member */
export interface GradeCorrection {
  id: number;
  examDate: string;
}

export interface GradeWrites {
  inserts: GradeInsert[];
  corrections: GradeCorrection[];
}

/**
 * The rows to write, checked once more: only grades of the section's
 * ladder, real dates not in the future, each grade once, new ones only if
 * not recorded yet, corrections only of the member's own recorded gradings.
 */
export function buildGradeWrites(
  memberId: number,
  rows: GradeReviewRow[],
  ctx: Pick<GradeReviewContext, 'section' | 'ladder' | 'history' | 'today'>
): GradeWrites {
  const writes: GradeWrites = { inserts: [], corrections: [] };
  if (!Number.isInteger(memberId) || memberId <= 0) return writes;
  const seen = new Set<string>();
  for (const row of rows) {
    const d = row.definition;
    const examDate = row.input.examDate;
    if (!row.action || !d || row.errors.length > 0 || seen.has(d.grade)) continue;
    const onLadder = ctx.ladder.some((l) => l.section === d.section && l.grade === d.grade);
    if (d.section !== ctx.section || !onLadder) continue;
    if (!isIsoDate(examDate) || examDate > ctx.today) continue;
    seen.add(d.grade);
    if (row.action === 'insert') {
      if (ctx.history.some((h) => h.section === d.section && h.grade === d.grade)) continue;
      writes.inserts.push({
        memberId,
        section: d.section,
        grade: d.grade,
        examDate,
        note: cleanText(row.input.note, NOTE_MAX) || null
      });
    } else {
      const existing = ctx.history.find(
        (h) =>
          h.id === row.existing?.id &&
          Number(h.memberId) === memberId &&
          h.section === d.section &&
          h.grade === d.grade
      );
      if (existing && existing.examDate !== examDate) {
        writes.corrections.push({ id: existing.id, examDate });
      }
    }
  }
  return writes;
}
