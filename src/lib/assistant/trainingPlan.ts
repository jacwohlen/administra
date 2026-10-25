import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from '$lib/models';
import type { ImportBreak, ImportSession } from '$lib/trainingPlanImport';
import type { PlanTraining } from '$lib/trainingPlanUtils';
import { SUGGEST_SCORE, bestMatch, normalizeName, type MatchableMember } from './nameMatch';
import { MAX_LENGTH, cleanText, isIsoDate } from './proposals';
import type { HolidayEntry, PlanSessionEntry } from './types';

/**
 * Review of a training plan read by the Daten-Assistent (kind
 * 'training_plan'): maps each session the model read to a planned training
 * and a member, compares it with what the TK planned already
 * (training_plan_sessions, one row per training and date) and builds the
 * rows to write, plus the holidays (training_plan_breaks). Pure, so the
 * review dialog only renders and saves what comes out of here.
 *
 * Nothing planned is lost by default: an empty value in the document keeps
 * what is planned, a session that only adds values to empty fields is
 * completed, and one that contradicts the plan is only written when the
 * user ticks it.
 */

/** The written columns of training_plan_sessions, exactly as the sheet import writes them */
export type PlanSessionWrite = ImportSession;
/** The written columns of training_plan_breaks */
export type PlanBreakWrite = ImportBreak;

/** A member a session can be planned for (PlanMember of the training plan) */
export interface PlanReviewMember extends MatchableMember {
  /** Trainer of the planned trainings: preferred when names are alike */
  trainer: boolean;
}

/** What the TK planned already for a training and date */
export type PlannedSession = Pick<
  TrainingPlanSession,
  'id' | 'training_id' | 'date' | 'trainer_id' | 'topic' | 'notes' | 'cancelled'
>;

/** A holiday period, recorded or about to be */
export type PlannedBreak = Pick<
  TrainingPlanBreak,
  'title' | 'date_from' | 'date_to' | 'cancels_training'
>;

/** Rows per upsert, like the sheet import */
export const PORTION = 200;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** English weekday name of a YYYY-MM-DD date, like trainings.weekday */
export function weekdayOf(date: string): string {
  return WEEKDAYS[dayjs(date).day()];
}

const sessionKey = (trainingId: number, date: string) => `${trainingId}|${date}`;

/** First and last valid date, null when there is none */
export function dateSpan(dates: string[]): { from: string; to: string } | null {
  const valid = dates.filter(isIsoDate).sort();
  return valid.length > 0 ? { from: valid[0], to: valid[valid.length - 1] } : null;
}

// ----- Training -----

/**
 * The planned training a session goes to: the model's, if it is one of the
 * planned trainings, else the only planned training on the date's weekday
 * (guessed, flagged in the review), else none and the user picks.
 */
export function resolveTraining(
  entry: Pick<PlanSessionEntry, 'date' | 'trainingId'>,
  trainings: PlanTraining[]
): { trainingId: number | null; guessed: boolean } {
  if (entry.trainingId !== null && trainings.some((t) => t.id === entry.trainingId)) {
    return { trainingId: entry.trainingId, guessed: false };
  }
  if (!isIsoDate(entry.date)) return { trainingId: null, guessed: false };
  const day = weekdayOf(entry.date);
  const candidates = trainings.filter((t) => t.weekday === day);
  return candidates.length === 1
    ? { trainingId: candidates[0].id, guessed: true }
    : { trainingId: null, guessed: false };
}

// ----- Leaders -----

/** Leader entries that are not a person ("-", "kein Training", "offen", "N.N.") */
const NO_LEADER = /^(?:[-–?.\s]*|kein training|keine?r?|niemand|offen|tbd|n\.?\s?n\.?)$/i;

/** The written leader name, folded, to group spellings; '' when it names nobody */
export function leaderKey(name: string): string {
  return NO_LEADER.test(name.trim()) ? '' : normalizeName(name);
}

/**
 * 'auto': clearly this member; 'suggested': the best candidate, which the
 * user confirms; 'none': no member fits (guest trainer, "Trainersitzung").
 */
export type LeaderMatchKind = 'auto' | 'suggested' | 'none';

export interface LeaderMatch {
  key: string;
  /** The name as first written */
  name: string;
  memberId: number | null;
  kind: LeaderMatchKind;
  /** Sessions with this name */
  count: number;
}

/**
 * The members the written leader names stand for, one entry per name.
 * Trainers of the planned trainings are preferred when names are alike.
 */
export function matchLeaders(
  sessions: PlanSessionEntry[],
  members: PlanReviewMember[]
): Map<string, LeaderMatch> {
  const preferred = new Set(members.filter((m) => m.trainer).map((m) => m.id));
  const leaders = new Map<string, LeaderMatch>();
  for (const s of sessions) {
    const key = leaderKey(s.trainer);
    if (!key) continue;
    const known = leaders.get(key);
    if (known) {
      known.count++;
      continue;
    }
    const { member, candidates } = bestMatch(s.trainer, members, { preferred });
    const top = candidates[0];
    const [memberId, kind]: [number | null, LeaderMatchKind] = member
      ? [member.id, 'auto']
      : top && top.score >= SUGGEST_SCORE
        ? [top.member.id, 'suggested']
        : [null, 'none'];
    leaders.set(key, { key, name: s.trainer, memberId, kind, count: 1 });
  }
  return leaders;
}

/**
 * The notes with the written leader name in front, as the sheet import
 * keeps leaders without a member, or with it taken out again once a member
 * is chosen.
 */
export function withLeaderNote(notes: string, name: string, inNotes: boolean): string {
  const n = name.trim();
  const text = notes.trim();
  if (!n) return text;
  const has = text === n || text.startsWith(`${n}, `);
  if (inNotes) return has ? text : text ? `${n}, ${text}` : n;
  if (!has) return text;
  return text === n ? '' : text.slice(n.length + 2).trim();
}

// ----- The review -----

/** What the user can change per session. */
export interface PlanReviewInput {
  date: string;
  /** A planned training, null until picked */
  trainingId: number | null;
  /** Member who leads, null when open */
  trainerId: number | null;
  topic: string;
  notes: string;
  cancelled: boolean;
  /** Leave the row out: nothing is written for it */
  skip: boolean;
  /** The session contradicts what is planned: replace it (opt-in) */
  overwrite: boolean;
}

/** The trainer of one row changed: the written name moves into the notes or out of them. */
export function setRowTrainer(
  entry: PlanSessionEntry,
  input: PlanReviewInput,
  trainerId: number | null
): PlanReviewInput {
  const notes = leaderKey(entry.trainer)
    ? withLeaderNote(input.notes, entry.trainer, trainerId === null)
    : input.notes;
  return { ...input, trainerId, notes };
}

/**
 * The member for a written leader name was changed: every row with that
 * name that still had the previous choice follows, rows changed one by one
 * keep theirs.
 */
export function applyLeaderChoice(
  entries: PlanSessionEntry[],
  inputs: PlanReviewInput[],
  key: string,
  previous: number | null,
  next: number | null
): PlanReviewInput[] {
  return inputs.map((input, i) =>
    leaderKey(entries[i].trainer) === key && input.trainerId === previous
      ? setRowTrainer(entries[i], input, next)
      : input
  );
}

function hasValues(input: PlanReviewInput): boolean {
  return (
    input.cancelled ||
    input.trainerId !== null ||
    input.topic.trim() !== '' ||
    input.notes.trim() !== ''
  );
}

export function initialPlanInputs(
  sessions: PlanSessionEntry[],
  trainings: PlanTraining[],
  leaders: Map<string, LeaderMatch>
): PlanReviewInput[] {
  return sessions.map((s) => {
    const leader = leaders.get(leaderKey(s.trainer)) ?? null;
    const trainerId = leader?.memberId ?? null;
    let notes = s.notes;
    let topic = s.topic;
    // A dropped session has no topic: what the plan says goes into the notes
    if (s.cancelled && topic) {
      if (!notes.includes(topic)) notes = notes ? `${topic}, ${notes}` : topic;
      topic = '';
    }
    if (leader && trainerId === null) notes = withLeaderNote(notes, s.trainer, true);
    const input: PlanReviewInput = {
      date: s.date,
      trainingId: resolveTraining(s, trainings).trainingId,
      trainerId,
      topic,
      notes: cleanText(notes, MAX_LENGTH.notes),
      cancelled: s.cancelled,
      skip: false,
      overwrite: false
    };
    // A date with nothing on it: nothing to save
    return { ...input, skip: !hasValues(input) };
  });
}

export type PlanRowStatus = 'new' | 'exists' | 'fill' | 'changed' | 'duplicate' | 'invalid';

export type PlanIssue =
  | { code: 'badDate' }
  | { code: 'noTraining' }
  /** The training is on another weekday than the date (English weekday names) */
  | { code: 'weekday'; trainingWeekday: string; dateWeekday: string }
  /** Neither the document nor the plan has anything for the session */
  | { code: 'empty' }
  /** The written name was matched to a member by a guess */
  | { code: 'trainerUnconfirmed'; name: string; memberId: number }
  /** The model named no planned training; taken by the weekday */
  | { code: 'trainingGuessed' }
  /** No member for the written name; it stays in the notes */
  | { code: 'trainerUnmatched'; name: string }
  /** The dojo is closed that day: the training drops anyway */
  | { code: 'closedBreak'; title: string }
  /** A year far from today, often misread */
  | { code: 'unusualYear' };

/** One value that applying changes in a planned session */
export type PlanChange =
  | { field: 'trainer'; from: number | null; to: number | null; conflict: boolean }
  | { field: 'topic' | 'notes'; from: string | null; to: string | null; conflict: boolean }
  | { field: 'cancelled'; from: boolean | null; to: boolean | null; conflict: boolean };

export interface PlanReviewRow {
  entry: PlanSessionEntry;
  input: PlanReviewInput;
  training: PlanTraining | null;
  /** What is planned already for the training and date */
  existing: PlannedSession | null;
  /** false while the plan for the date is still loading */
  checked: boolean;
  status: PlanRowStatus;
  /** Index of the earlier row for the same training and date, for duplicates */
  duplicateOf: number | null;
  /** How the planned session changes ('fill' and 'changed') */
  changes: PlanChange[];
  /** What applying writes for the row, null when nothing */
  write: PlanSessionWrite | null;
  /** Missing or wrong values; such a row is never written */
  errors: PlanIssue[];
  /** Worth a second look, no reason not to save */
  warnings: PlanIssue[];
  /** Meant to be saved but not ready: apply waits for a fix, a skip or the plan */
  blocking: boolean;
}

export interface PlanReviewContext {
  /** The planned trainings */
  trainings: PlanTraining[];
  members: PlanReviewMember[];
  /** Sessions planned between from and to (all planned trainings), null while loading */
  planned: { from: string; to: string; sessions: PlannedSession[] } | null;
  /** Holidays recorded, plus those about to be added */
  breaks: PlannedBreak[];
  leaders: Map<string, LeaderMatch>;
  /** Leader keys whose suggested member the user confirmed */
  confirmed: ReadonlySet<string>;
  /** YYYY-MM-DD, local date */
  today: string;
}

type SessionValues = Pick<PlannedSession, 'trainer_id' | 'topic' | 'notes' | 'cancelled'>;

/** What the row says, cleaned: a dropped session has no trainer and no topic */
function proposedValues(input: PlanReviewInput): SessionValues & { cancelled: boolean } {
  return {
    trainer_id: input.cancelled ? null : input.trainerId,
    topic: input.cancelled ? null : cleanText(input.topic, MAX_LENGTH.topic) || null,
    notes: cleanText(input.notes, MAX_LENGTH.notes) || null,
    cancelled: input.cancelled
  };
}

function isEmptySession(s: SessionValues): boolean {
  return s.trainer_id === null && !s.topic?.trim() && !s.notes?.trim() && s.cancelled === null;
}

const sameText = (a: string | null, b: string | null) =>
  (a ?? '').replace(/\s+/g, ' ').trim() === (b ?? '').replace(/\s+/g, ' ').trim();

/** The written value, or the planned one when the document leaves it empty or says the same */
function keepOrTake(proposed: string | null, planned: string | null): string | null {
  return proposed === null || sameText(proposed, planned) ? planned : proposed;
}

/**
 * The session as it is after applying, and what changes. Empty values of
 * the document keep the planned ones; a planned "takes place even when the
 * dojo is closed" (cancelled false) stays. A change is a conflict when it
 * replaces a planned value rather than filling an empty one; dropping a
 * planned session or bringing a dropped one back always is.
 *
 * `leaderWithoutMember`: the document names a leader no member was chosen
 * for (guest trainer, unknown spelling). That is not an empty value: it
 * contradicts a planned trainer instead of keeping them.
 */
export function mergeSession(
  proposed: SessionValues & { cancelled: boolean },
  planned: PlannedSession | null,
  { leaderWithoutMember = false }: { leaderWithoutMember?: boolean } = {}
): { values: SessionValues; changes: PlanChange[] } {
  if (!planned || isEmptySession(planned)) {
    return {
      values: {
        trainer_id: proposed.trainer_id,
        topic: proposed.topic,
        notes: proposed.notes,
        cancelled: proposed.cancelled ? true : null
      },
      changes: []
    };
  }
  const takesPlace = proposed.trainer_id !== null || proposed.topic !== null || leaderWithoutMember;
  const values: SessionValues = proposed.cancelled
    ? {
        trainer_id: null,
        topic: null,
        notes: keepOrTake(proposed.notes, planned.notes),
        cancelled: true
      }
    : {
        trainer_id: proposed.trainer_id ?? (leaderWithoutMember ? null : planned.trainer_id),
        topic: keepOrTake(proposed.topic, planned.topic),
        notes: keepOrTake(proposed.notes, planned.notes),
        cancelled: planned.cancelled === true && takesPlace ? null : planned.cancelled
      };
  const changes: PlanChange[] = [];
  if (values.trainer_id !== planned.trainer_id) {
    changes.push({
      field: 'trainer',
      from: planned.trainer_id,
      to: values.trainer_id,
      conflict: planned.trainer_id !== null
    });
  }
  for (const field of ['topic', 'notes'] as const) {
    if (values[field] !== planned[field]) {
      changes.push({
        field,
        from: planned[field],
        to: values[field],
        conflict: !!planned[field]?.trim()
      });
    }
  }
  if (values.cancelled !== planned.cancelled) {
    // Whether a planned training takes place is never just filled in
    changes.push({
      field: 'cancelled',
      from: planned.cancelled,
      to: values.cancelled,
      conflict: true
    });
  }
  return { values, changes };
}

/**
 * One review row per session. Status: 'new' when nothing is planned for
 * the training and date, 'exists' when the plan says the same already,
 * 'fill' when the document only adds values to empty fields (written),
 * 'changed' when it contradicts the plan (written only if the user opts
 * in), 'duplicate' for a second row of the same training and date (the
 * first one counts), 'invalid' while a value is missing or wrong.
 */
export function reviewPlan(
  entries: PlanSessionEntry[],
  inputs: PlanReviewInput[],
  ctx: PlanReviewContext
): PlanReviewRow[] {
  const planned = new Map(
    (ctx.planned?.sessions ?? []).map((s) => [sessionKey(s.training_id, s.date), s])
  );
  const firstRow = new Map<string, number>();
  const year = +ctx.today.slice(0, 4);

  return entries.map((entry, i): PlanReviewRow => {
    const input = inputs[i];
    const training = ctx.trainings.find((t) => t.id === input.trainingId) ?? null;
    const validDate = isIsoDate(input.date);
    const key = training && validDate ? sessionKey(training.id, input.date) : null;
    const checked =
      !validDate ||
      (ctx.planned !== null && ctx.planned.from <= input.date && input.date <= ctx.planned.to);
    const existing = key ? (planned.get(key) ?? null) : null;
    const proposed = proposedValues(input);
    const leader = ctx.leaders.get(leaderKey(entry.trainer)) ?? null;
    const leaderWithoutMember = leader !== null && proposed.trainer_id === null && !input.cancelled;

    const errors: PlanIssue[] = [];
    if (!validDate) errors.push({ code: 'badDate' });
    if (!training) {
      errors.push({ code: 'noTraining' });
    } else if (validDate && weekdayOf(input.date) !== training.weekday) {
      errors.push({
        code: 'weekday',
        trainingWeekday: training.weekday,
        dateWeekday: weekdayOf(input.date)
      });
    }
    if (
      leader?.kind === 'suggested' &&
      leader.memberId !== null &&
      proposed.trainer_id === leader.memberId &&
      existing?.trainer_id !== leader.memberId &&
      !ctx.confirmed.has(leader.key)
    ) {
      errors.push({ code: 'trainerUnconfirmed', name: entry.trainer, memberId: leader.memberId });
    }
    if (
      key &&
      !hasValues(input) &&
      (!existing || isEmptySession(existing)) &&
      errors.length === 0
    ) {
      errors.push({ code: 'empty' });
    }

    const warnings: PlanIssue[] = [];
    if (training && entry.trainingId !== training.id) {
      const guess = resolveTraining(entry, ctx.trainings);
      if (guess.guessed && guess.trainingId === training.id) {
        warnings.push({ code: 'trainingGuessed' });
      }
    }
    if (leaderWithoutMember) {
      warnings.push({ code: 'trainerUnmatched', name: entry.trainer });
    }
    if (validDate && !input.cancelled) {
      const closed = ctx.breaks.find(
        (b) => b.cancels_training && b.date_from <= input.date && input.date <= b.date_to
      );
      if (closed) warnings.push({ code: 'closedBreak', title: closed.title });
    }
    if (validDate && Math.abs(+input.date.slice(0, 4) - year) > 1) {
      warnings.push({ code: 'unusualYear' });
    }

    let status: PlanRowStatus;
    let duplicateOf: number | null = null;
    let changes: PlanChange[] = [];
    let write: PlanSessionWrite | null = null;

    if (errors.length > 0 || !key || !training) {
      status = 'invalid';
    } else if (!input.skip && firstRow.has(key)) {
      status = 'duplicate';
      duplicateOf = firstRow.get(key)!;
    } else {
      if (!input.skip) firstRow.set(key, i);
      const merged = mergeSession(proposed, existing, { leaderWithoutMember });
      changes = merged.changes;
      status =
        !existing || isEmptySession(existing)
          ? 'new'
          : changes.length === 0
            ? 'exists'
            : changes.some((c) => c.conflict)
              ? 'changed'
              : 'fill';
      const writes =
        status === 'new' || status === 'fill' || (status === 'changed' && input.overwrite);
      if (writes && checked && !input.skip) {
        write = {
          training_id: training.id,
          date: input.date,
          trainer_id: merged.values.trainer_id,
          topic: merged.values.topic,
          notes: merged.values.notes,
          cancelled: merged.values.cancelled
        };
      }
    }

    return {
      entry,
      input,
      training,
      existing,
      checked,
      status,
      duplicateOf,
      changes,
      write,
      errors,
      warnings,
      blocking: !input.skip && (errors.length > 0 || !checked)
    };
  });
}

/** The values a row stands for, as saved: its write, else what the row says, cleaned */
export function rowValues(row: PlanReviewRow): SessionValues {
  if (row.write) {
    const { trainer_id, topic, notes, cancelled } = row.write;
    return { trainer_id, topic, notes, cancelled };
  }
  const proposed = proposedValues(row.input);
  return {
    trainer_id: proposed.trainer_id,
    topic: proposed.topic,
    notes: proposed.notes,
    cancelled: proposed.cancelled ? true : null
  };
}

/**
 * Leaves out every session that still needs a fix, so the rest can be
 * saved; rows only waiting for the plan to load are not touched.
 */
export function skipIncomplete(
  rows: PlanReviewRow[],
  inputs: PlanReviewInput[]
): PlanReviewInput[] {
  return inputs.map((input, i) =>
    rows[i]?.blocking && rows[i].errors.length > 0 ? { ...input, skip: true } : input
  );
}

// ----- Holidays -----

/** What the user can change per holiday period. */
export interface HolidayInput {
  /** Add it to the holidays */
  use: boolean;
  title: string;
  dateFrom: string;
  dateTo: string;
  /** Dojo closed: planned trainings drop (cancels_training) */
  closed: boolean;
}

export type HolidayStatus = 'new' | 'exists' | 'duplicate' | 'invalid';

export type HolidayIssue = { code: 'noTitle' } | { code: 'badDates' };

export interface HolidayReviewRow {
  entry: HolidayEntry;
  input: HolidayInput;
  status: HolidayStatus;
  /** The recorded holiday with the same title and dates */
  existing: PlannedBreak | null;
  /** Recorded holidays the period overlaps (other title or dates) */
  overlaps: PlannedBreak[];
  duplicateOf: number | null;
  errors: HolidayIssue[];
  write: PlanBreakWrite | null;
  /** Meant to be added but not valid yet */
  blocking: boolean;
}

/** Same title (case and spaces aside) and dates: recorded already, not added twice */
function sameBreak(
  a: Pick<PlannedBreak, 'title' | 'date_from' | 'date_to'>,
  b: Pick<PlannedBreak, 'title' | 'date_from' | 'date_to'>
): boolean {
  return (
    normalizeName(a.title) === normalizeName(b.title) &&
    a.date_from === b.date_from &&
    a.date_to === b.date_to
  );
}

function asBreak(input: HolidayInput): Pick<PlannedBreak, 'title' | 'date_from' | 'date_to'> {
  return {
    title: cleanText(input.title, MAX_LENGTH.heading),
    date_from: input.dateFrom,
    date_to: input.dateTo || input.dateFrom
  };
}

export function initialHolidayInputs(
  holidays: HolidayEntry[],
  breaks: PlannedBreak[]
): HolidayInput[] {
  return holidays.map((h) => {
    const input = {
      use: true,
      title: h.title,
      dateFrom: h.dateFrom,
      dateTo: h.dateTo || h.dateFrom,
      closed: h.closed
    };
    const b = asBreak(input);
    return { ...input, use: !breaks.some((e) => sameBreak(e, b)) };
  });
}

/**
 * One row per holiday period. 'exists' when the same title and dates are
 * recorded (never added twice), 'duplicate' for a second row of the same
 * period, 'invalid' while the title or the dates are missing or wrong.
 */
export function reviewHolidays(
  entries: HolidayEntry[],
  inputs: HolidayInput[],
  breaks: PlannedBreak[]
): HolidayReviewRow[] {
  const firstRow: { index: number; b: Pick<PlannedBreak, 'title' | 'date_from' | 'date_to'> }[] =
    [];
  return entries.map((entry, i): HolidayReviewRow => {
    const input = inputs[i];
    const b = asBreak(input);
    const errors: HolidayIssue[] = [];
    if (!b.title) errors.push({ code: 'noTitle' });
    if (!isIsoDate(b.date_from) || !isIsoDate(b.date_to) || b.date_to < b.date_from) {
      errors.push({ code: 'badDates' });
    }
    const existing = breaks.find((e) => sameBreak(e, b)) ?? null;
    const overlaps =
      errors.length > 0
        ? []
        : breaks.filter(
            (e) => e !== existing && e.date_from <= b.date_to && b.date_from <= e.date_to
          );
    let status: HolidayStatus;
    let duplicateOf: number | null = null;
    if (errors.length > 0) {
      status = 'invalid';
    } else if (existing) {
      status = 'exists';
    } else {
      const earlier = firstRow.find((f) => sameBreak(f.b, b));
      if (input.use && earlier) {
        status = 'duplicate';
        duplicateOf = earlier.index;
      } else {
        status = 'new';
        if (input.use) firstRow.push({ index: i, b });
      }
    }
    return {
      entry,
      input,
      status,
      existing,
      overlaps,
      duplicateOf,
      errors,
      write:
        status === 'new' && input.use
          ? {
              title: b.title,
              date_from: b.date_from,
              date_to: b.date_to,
              cancels_training: input.closed === true
            }
          : null,
      blocking: input.use && errors.length > 0
    };
  });
}

/** Leaves out every holiday period that is wanted but incomplete. */
export function skipIncompleteHolidays(
  rows: HolidayReviewRow[],
  inputs: HolidayInput[]
): HolidayInput[] {
  return inputs.map((input, i) => (rows[i]?.blocking ? { ...input, use: false } : input));
}

/** The holidays to add, checked once more and each period once. */
export function buildBreakWrites(rows: HolidayReviewRow[]): PlanBreakWrite[] {
  const out: PlanBreakWrite[] = [];
  for (const row of rows) {
    const w = row.write;
    if (!w || row.blocking || row.errors.length > 0) continue;
    if (!w.title.trim() || !isIsoDate(w.date_from) || !isIsoDate(w.date_to)) continue;
    if (w.date_to < w.date_from || out.some((o) => sameBreak(o, w))) continue;
    out.push({
      title: w.title,
      date_from: w.date_from,
      date_to: w.date_to,
      cancels_training: w.cancels_training === true
    });
  }
  return out;
}

// ----- What is written -----

/**
 * The sessions to write, checked once more: only planned trainings on
 * their weekday, real dates, members of the list (or the trainer planned
 * already), each training and date once.
 */
export function buildPlanWrites(
  rows: PlanReviewRow[],
  ctx: Pick<PlanReviewContext, 'trainings' | 'members'>
): PlanSessionWrite[] {
  const trainings = new Map(ctx.trainings.map((t) => [t.id, t]));
  const members = new Set(ctx.members.map((m) => m.id));
  const seen = new Set<string>();
  const out: PlanSessionWrite[] = [];
  for (const row of rows) {
    const w = row.write;
    if (!w || row.blocking || row.errors.length > 0 || !row.checked) continue;
    const training = trainings.get(w.training_id);
    if (!training || !isIsoDate(w.date) || weekdayOf(w.date) !== training.weekday) continue;
    if (
      w.trainer_id !== null &&
      !(Number.isInteger(w.trainer_id) && members.has(w.trainer_id)) &&
      w.trainer_id !== row.existing?.trainer_id
    ) {
      continue;
    }
    const key = sessionKey(w.training_id, w.date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      training_id: w.training_id,
      date: w.date,
      trainer_id: w.cancelled ? null : w.trainer_id,
      topic: w.cancelled ? null : w.topic,
      notes: w.notes,
      cancelled: w.cancelled
    });
  }
  return out;
}

export interface PlanReviewSummary {
  /** Sessions to write */
  sessions: number;
  /** Holidays to add */
  breaks: number;
  /** Rows that still need a fix or a skip */
  blocking: number;
  /** Rows waiting for the planned sessions to load */
  waiting: number;
  byStatus: Record<PlanRowStatus, number>;
  cancelled: number;
}

export function summarizePlan(
  rows: PlanReviewRow[],
  holidays: HolidayReviewRow[]
): PlanReviewSummary {
  const byStatus: Record<PlanRowStatus, number> = {
    new: 0,
    exists: 0,
    fill: 0,
    changed: 0,
    duplicate: 0,
    invalid: 0
  };
  for (const row of rows) byStatus[row.status]++;
  return {
    sessions: rows.filter((r) => r.write).length,
    breaks: holidays.filter((h) => h.write).length,
    blocking:
      rows.filter((r) => r.blocking && r.errors.length > 0).length +
      holidays.filter((h) => h.blocking).length,
    waiting: rows.filter((r) => !r.input.skip && !r.checked).length,
    byStatus,
    cancelled: rows.filter((r) => r.write?.cancelled).length
  };
}

// ----- Saving -----

export interface WriteOutcome<T> {
  saved: T[];
  failed: T[];
}

/**
 * Writes the items one portion at a time. A portion that fails is tried
 * again row by row, so one bad row does not take the others with it and
 * the failures are known per row.
 */
export async function writeInPortions<T>(
  items: T[],
  size: number,
  write: (portion: T[]) => Promise<boolean>,
  onProgress?: (done: number) => void
): Promise<WriteOutcome<T>> {
  const saved: T[] = [];
  const failed: T[] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) {
    const portion = items.slice(i, i + step);
    if (await write(portion)) {
      saved.push(...portion);
    } else if (portion.length === 1) {
      failed.push(...portion);
    } else {
      for (const item of portion) {
        if (await write([item])) saved.push(item);
        else failed.push(item);
        onProgress?.(saved.length + failed.length);
      }
    }
    onProgress?.(saved.length + failed.length);
  }
  return { saved, failed };
}
