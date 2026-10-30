import type { TrainerRole } from '$lib/models';
import {
  CONFIDENCES,
  type AssistantKind,
  type AttendanceEntry,
  type AttendanceProposal,
  type Confidence,
  type EventEntry,
  type EventsProposal,
  type GradeEntry,
  type GradesProposal,
  type HolidayEntry,
  type LessonPlanProposal,
  type LessonPlanSection,
  type PlanSessionEntry,
  type ProposalMap,
  type TrainingPlanProposal
} from './types';

/**
 * Model output is untrusted: a prompt-injected photo can make the model
 * return anything the schema allows. Everything it says goes through these
 * functions on the server before it reaches the browser: unknown fields are
 * dropped, strings are cleaned and capped, dates and times must be real,
 * enums must be known, and ids are only accepted from the list the server
 * gave the model. The review dialog checks the values once more against
 * the data the user can see.
 */

/** Longest values kept, by field. */
export const MAX_LENGTH = {
  name: 100,
  short: 60,
  title: 200,
  topic: 300,
  notes: 500,
  location: 200,
  description: 2000,
  remark: 300,
  warning: 300,
  heading: 120,
  item: 300
} as const;

/** Most rows kept per list; a real document never has more. */
export const MAX_ROWS = {
  grades: 40,
  attendance: 200,
  sessions: 400,
  holidays: 40,
  events: 100,
  sections: 12,
  items: 40,
  warnings: 10,
  dates: 60
} as const;

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

function list(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/** Control characters, zero-width and bidi overrides (they can disguise text) */
function isInvisible(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function stripInvisible(value: string, keepNewlines: boolean): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (keepNewlines && char === '\n') out += char;
    else out += isInvisible(code) ? ' ' : char;
  }
  return out;
}

/** Drops leading = + - @ (also repeated, also after spaces): a spreadsheet runs them as a formula. */
function stripFormula(text: string): string {
  let out = text;
  while (/^[=+\-@]/.test(out)) out = out.replace(/^[=+\-@\s]+/, '');
  return out;
}

/**
 * A plain string: invisible characters removed, whitespace collapsed,
 * capped at `max`. A leading = + - or @ is dropped, since such a value
 * would run as a formula in a spreadsheet export.
 */
export function cleanText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  let text = stripInvisible(value.normalize('NFC').replace(/\r\n?/g, '\n'), multiline);
  text = multiline
    ? text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : text.replace(/\s+/g, ' ').trim();
  text = stripFormula(text);
  return stripFormula(text.length > max ? text.slice(0, max).trim() : text);
}

/** A name: plain text without markup characters. */
export function cleanName(value: unknown): string {
  return cleanText(value, MAX_LENGTH.name)
    .replace(/[<>{}[\]\\|"`]/g, '')
    .trim();
}

/** Today in the club's time zone (Europe/Zurich), YYYY-MM-DD. */
export function clubToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real calendar day as YYYY-MM-DD (1900–2100). */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1900 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The date in «2026-01-05 00:00», «05.01.2026», «5.1.26» or «Mo, 05.01.2026», unchecked */
function findDate(value: string): string | null {
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const swiss = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(value);
  if (!swiss) return null;
  const year = swiss[3].length === 2 ? `20${swiss[3]}` : swiss[3].padStart(4, '0');
  return `${year}-${swiss[2].padStart(2, '0')}-${swiss[1].padStart(2, '0')}`;
}

/** YYYY-MM-DD, also from 05.03.2024 or 5.3.24; '' when not a real date. */
export function cleanDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const found = v ? findDate(v) : null;
  return found && isIsoDate(found) ? found : '';
}

/**
 * For grades: a full date, or YYYY-MM / YYYY when the pass only shows part
 * of it (the review then asks for the rest).
 */
export function cleanPartialDate(value: unknown): string {
  const full = cleanDate(value);
  if (full || typeof value !== 'string') return full;
  const v = value.trim();
  const month = /^(\d{4})-(\d{2})$/.exec(v);
  if (month && +month[1] >= 1900 && +month[1] <= 2100 && +month[2] >= 1 && +month[2] <= 12) {
    return v;
  }
  const year = /^(\d{4})$/.exec(v);
  if (year && +year[1] >= 1900 && +year[1] <= 2100) return v;
  return '';
}

/** HH:MM from 18:30, 18.30 or 8:00; '' otherwise. */
export function cleanTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function cleanConfidence(value: unknown): Confidence {
  return CONFIDENCES.includes(value as Confidence) ? (value as Confidence) : 'medium';
}

const ROLES: readonly TrainerRole[] = ['attendee', 'main_trainer', 'assistant'];

function cleanRole(value: unknown): TrainerRole {
  return ROLES.includes(value as TrainerRole) ? (value as TrainerRole) : 'attendee';
}

function cleanDates(value: unknown): string[] {
  const dates = list(value, MAX_ROWS.dates).map(cleanDate).filter(Boolean);
  return [...new Set(dates)].sort();
}

function cleanWarnings(value: unknown): string[] {
  return list(value, MAX_ROWS.warnings)
    .map((w) => cleanText(w, MAX_LENGTH.warning))
    .filter(Boolean);
}

/** Grade ladder entries the server knows, to accept only real grades. */
export interface LadderGrade {
  section: string;
  grade: string;
}

export function sanitizeGrades(raw: unknown, ladder: LadderGrade[]): GradesProposal {
  const r = obj(raw);
  const sections = [...new Set(ladder.map((g) => g.section))];
  // "Judo" or "Judo (SJV)": a section named as a word, if only one is
  const sectionText = cleanText(r.section, MAX_LENGTH.short).toLowerCase();
  const sectionWords = sectionText.split(/[^\p{L}]+/u);
  const named = sections.filter((s) => sectionWords.includes(s.toLowerCase()));
  const section =
    sections.find((s) => s.toLowerCase() === sectionText) ?? (named.length === 1 ? named[0] : '');
  const known = (grade: string) =>
    ladder.some((g) => g.grade === grade && (!section || g.section === section));
  const holder = obj(r.holder);
  const entries: GradeEntry[] = list(r.entries, MAX_ROWS.grades)
    .map((value) => {
      const e = obj(value);
      const grade = cleanText(e.grade, MAX_LENGTH.short);
      return {
        grade: known(grade) ? grade : '',
        gradeAsWritten: cleanText(e.gradeAsWritten, MAX_LENGTH.short),
        beltColor: cleanText(e.beltColor, MAX_LENGTH.short),
        date: cleanPartialDate(e.date),
        examiner: cleanText(e.examiner, MAX_LENGTH.name),
        confidence: cleanConfidence(e.confidence),
        remark: cleanText(e.remark, MAX_LENGTH.remark)
      };
    })
    .filter((e) => e.grade || e.gradeAsWritten || e.beltColor);
  return {
    section,
    holder: { name: cleanName(holder.name), birthday: cleanDate(holder.birthday) },
    entries,
    warnings: cleanWarnings(r.warnings)
  };
}

export function sanitizeAttendance(raw: unknown): AttendanceProposal {
  const r = obj(raw);
  const entries: AttendanceEntry[] = list(r.entries, MAX_ROWS.attendance)
    .map((value) => {
      const e = obj(value);
      return {
        name: cleanName(e.name),
        role: cleanRole(e.role),
        dates: cleanDates(e.dates),
        confidence: cleanConfidence(e.confidence),
        remark: cleanText(e.remark, MAX_LENGTH.remark)
      };
    })
    .filter((e) => e.name);
  const dates = new Set([...cleanDates(r.dates), ...entries.flatMap((e) => e.dates)]);
  return {
    trainingAsWritten: cleanText(r.trainingAsWritten, MAX_LENGTH.title),
    dates: [...dates].sort().slice(0, MAX_ROWS.dates),
    entries,
    warnings: cleanWarnings(r.warnings)
  };
}

/**
 * `trainingKeys` maps the keys the prompt listed ("T12") to training ids;
 * any other value the model returns becomes null.
 */
export function sanitizeTrainingPlan(
  raw: unknown,
  trainingKeys: Map<string, number>
): TrainingPlanProposal {
  const r = obj(raw);
  const sessions: PlanSessionEntry[] = list(r.sessions, MAX_ROWS.sessions)
    .map((value) => {
      const s = obj(value);
      const key = cleanText(s.training, MAX_LENGTH.short).toUpperCase();
      return {
        date: cleanDate(s.date),
        trainingId: trainingKeys.get(key) ?? null,
        trainingAsWritten: cleanText(s.trainingAsWritten, MAX_LENGTH.title),
        trainer: cleanName(s.trainer),
        topic: cleanText(s.topic, MAX_LENGTH.topic),
        notes: cleanText(s.notes, MAX_LENGTH.notes),
        cancelled: s.cancelled === true,
        confidence: cleanConfidence(s.confidence),
        remark: cleanText(s.remark, MAX_LENGTH.remark)
      };
    })
    // Kept without a date too: the review asks for it instead of losing the row
    .filter((s) => s.date || s.trainingAsWritten || s.trainer || s.topic || s.notes || s.cancelled);
  const holidays: HolidayEntry[] = list(r.holidays, MAX_ROWS.holidays)
    .map((value) => {
      const h = obj(value);
      const from = cleanDate(h.dateFrom) || cleanDate(h.dateTo);
      const to = cleanDate(h.dateTo) || from;
      return {
        title: cleanText(h.title, MAX_LENGTH.heading),
        dateFrom: from && to < from ? to : from,
        dateTo: from && to < from ? from : to,
        closed: h.closed === true
      };
    })
    // Kept without readable dates too: the review asks for them
    .filter((h) => h.title);
  return { sessions, holidays, warnings: cleanWarnings(r.warnings) };
}

export function sanitizeLessonPlan(raw: unknown): LessonPlanProposal {
  const r = obj(raw);
  const sections: LessonPlanSection[] = list(r.sections, MAX_ROWS.sections)
    .map((value) => {
      const s = obj(value);
      return {
        heading: cleanText(s.heading, MAX_LENGTH.heading),
        items: list(s.items, MAX_ROWS.items)
          .map((item) => cleanText(item, MAX_LENGTH.item))
          .filter(Boolean)
      };
    })
    .filter((s) => s.heading || s.items.length > 0);
  return {
    date: cleanDate(r.date),
    title: cleanText(r.title, MAX_LENGTH.title),
    sections,
    warnings: cleanWarnings(r.warnings)
  };
}

export function sanitizeEvents(raw: unknown): EventsProposal {
  const r = obj(raw);
  const events: EventEntry[] = list(r.events, MAX_ROWS.events)
    .map((value) => {
      const e = obj(value);
      const date = cleanDate(e.date);
      const dateTo = cleanDate(e.dateTo);
      return {
        title: cleanText(e.title, MAX_LENGTH.title),
        date,
        dateTo: date && dateTo > date ? dateTo : '',
        timeFrom: cleanTime(e.timeFrom),
        timeTo: cleanTime(e.timeTo),
        location: cleanText(e.location, MAX_LENGTH.location),
        section: cleanText(e.section, MAX_LENGTH.short),
        description: cleanText(e.description, MAX_LENGTH.description, true),
        confidence: cleanConfidence(e.confidence),
        remark: cleanText(e.remark, MAX_LENGTH.remark)
      };
    })
    .filter((e) => e.title);
  return { events, warnings: cleanWarnings(r.warnings) };
}

/** Reference data the server gave the model, needed to check its answer. */
export interface SanitizeContext {
  ladder?: LadderGrade[];
  trainingKeys?: Map<string, number>;
}

export function sanitizeProposal<K extends AssistantKind>(
  kind: K,
  raw: unknown,
  context: SanitizeContext = {}
): ProposalMap[K] {
  const result: { [Kind in AssistantKind]: () => ProposalMap[Kind] } = {
    grades: () => sanitizeGrades(raw, context.ladder ?? []),
    attendance: () => sanitizeAttendance(raw),
    training_plan: () => sanitizeTrainingPlan(raw, context.trainingKeys ?? new Map()),
    lesson_plan: () => sanitizeLessonPlan(raw),
    events: () => sanitizeEvents(raw)
  };
  return result[kind]() as ProposalMap[K];
}
