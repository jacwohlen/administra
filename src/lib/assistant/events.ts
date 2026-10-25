import { normalizeName } from './nameMatch';
import { cleanText, isIsoDate, MAX_LENGTH } from './proposals';
import type { EventEntry, EventsProposal } from './types';

/**
 * Review of club dates read by the Daten-Assistent (kind 'events'): one
 * editable row per date, checked against the events already recorded
 * (events has no natural key, so similar titles on nearby days count as
 * the same event) and turned into the rows the "Event erstellen" form
 * would insert. Existing events are never changed. Pure, so EventsReview
 * only renders and saves what comes out of here.
 */

/** Days apart two dates may be and still be one event (a date misread by one) */
export const DUPLICATE_DAYS = 1;
/** Share of the shorter title's words the other title must have to count as the same event */
export const SIMILAR_TITLE = 0.6;
/** An insert that hits a taken id is tried again this often (see insertEvents) */
export const ID_RETRIES = 10;

/** Part of the description the Webling sync writes into the events it creates */
const WEBLING_MARK = 'webling.ch/portal#/calendar/event/';

// ----- Titles and dates -----

/** Words that say nothing about which event it is */
const STOP_WORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'und',
  'oder',
  'mit',
  'fur',
  'im',
  'in',
  'am',
  'an',
  'auf',
  'zum',
  'zur',
  'vom',
  'von',
  'bei',
  'the',
  'and',
  'or',
  'of',
  'for',
  'at',
  'on',
  'to',
  'with'
]);

/**
 * The words of a title that tell events apart: folded like names (ü/ue →
 * u, ß → ss), without filler words, single letters and plain numbers such
 * as the year ("Kids Cup 2026" and "Kids Cup" are one event).
 */
export function titleWords(title: string): string[] {
  const words = normalizeName(title)
    .split(/[\s.-]+/)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** Whether a and b differ by at most one inserted, removed or replaced letter. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Compounds and endings: "lager" in "herbstlager", "meisterschaft" in "meisterschaften"
  if (short.length >= 4 && long.includes(short)) return true;
  // OCR noise: one wrong letter in a long word
  return short.length >= 6 && withinOneEdit(a, b);
}

/**
 * How alike two titles are, 0–1: the share of the shorter title's words
 * that the other one has, so "Kids Cup" and "Judo Kids Cup Wohlen" are
 * alike while "Judo Training" and "Aikido Training" are not.
 */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.length === 0 || wb.length === 0) {
    const na = normalizeName(a);
    return na && na === normalizeName(b) ? 1 : 0;
  }
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const shared = short.filter((w) => long.some((o) => sameWord(w, o))).length;
  return Math.round((shared / short.length) * 1000) / 1000;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Days between two YYYY-MM-DD dates, positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** 2026-11-14 → 14.11.2026 */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return d ? `${d}.${m}.${y}` : date;
}

/** HH:MM, 00:00–23:59, as the time inputs and the event form give it */
export function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Whether the event was created by the Webling sync (and is kept up to date by it). */
export function isWeblingEvent(description: string | null | undefined): boolean {
  return !!description && description.includes(WEBLING_MARK);
}

/** The club section the model's wording stands for ('judo' → 'Judo'), '' if none. */
export function matchSection(written: string, sections: readonly string[]): string {
  const key = normalizeName(written);
  if (!key) return '';
  return sections.find((s) => normalizeName(s) === key) ?? '';
}

// ----- The review -----

/** An event already recorded, as the events list loaded it. */
export interface KnownEvent {
  id: string | number;
  title: string;
  date: string;
  timeFrom?: string | null;
  location?: string | null;
  description?: string | null;
}

/** What the user can change per row. */
export interface EventRowInput {
  title: string;
  /** YYYY-MM-DD, '' while missing */
  date: string;
  /** Last day of a multi-day event, '' otherwise */
  dateTo: string;
  /** HH:MM or '' */
  timeFrom: string;
  timeTo: string;
  location: string;
  /** One of the club's sections, '' to use the default section */
  section: string;
  description: string;
  /**
   * Ticked or unticked; null: every row but a duplicate is created.
   * EventsReview fixes it once with `preselect`, so only the user's own
   * click changes it later.
   */
  include: boolean | null;
}

export type EventRowStatus = 'new' | 'duplicate' | 'invalid';

export type EventIssue =
  | { code: 'noTitle' }
  | { code: 'noDate' }
  | { code: 'badDate' }
  | { code: 'noSection' }
  /** The model's section is not one of the club's */
  | { code: 'unknownSection'; written: string }
  | { code: 'badTimeFrom' }
  | { code: 'badTimeTo' }
  /** The end time is not after the start time */
  | { code: 'timeOrder' }
  /** The last day is not a real date after the first */
  | { code: 'badDateTo' }
  | { code: 'past' }
  /** More than two years ahead: often a misread year */
  | { code: 'farFuture' };

/** The event a row seems to repeat. */
export type EventDuplicate =
  | { kind: 'existing'; event: KnownEvent; webling: boolean }
  /** An earlier row of the same document */
  | { kind: 'row'; index: number };

export interface EventReviewRow {
  entry: EventEntry;
  input: EventRowInput;
  /** The section written: the row's own, else the default */
  section: string;
  status: EventRowStatus;
  /** Created on apply */
  selected: boolean;
  duplicate: EventDuplicate | null;
  /** Missing or wrong values; such a row is never written */
  errors: EventIssue[];
  /** Worth a second look, no reason not to save */
  warnings: EventIssue[];
  /** Ticked but not valid yet: apply waits for a fix or an untick */
  blocking: boolean;
}

export interface EventReviewContext {
  /** The events already recorded */
  known: readonly KnownEvent[];
  /** The club's sections (clubConfig.sections) */
  sections: readonly string[];
  /** Section for rows without their own, '' for none */
  defaultSection: string;
  /** YYYY-MM-DD, local date */
  today: string;
}

export function initialInputs(
  proposal: EventsProposal,
  sections: readonly string[]
): EventRowInput[] {
  return proposal.events.map((entry) => {
    const date = isIsoDate(entry.date) ? entry.date : '';
    return {
      title: entry.title,
      date,
      dateTo: date && isIsoDate(entry.dateTo) && entry.dateTo > date ? entry.dateTo : '',
      timeFrom: isTime(entry.timeFrom) ? entry.timeFrom : '',
      timeTo: isTime(entry.timeTo) ? entry.timeTo : '',
      location: entry.location,
      section: matchSection(entry.section, sections),
      description: entry.description,
      include: null
    };
  });
}

/**
 * The section preselected for rows without one: only a club with a single
 * section has an obvious one; otherwise the user picks it.
 */
export function initialDefaultSection(sections: readonly string[]): string {
  return sections.length === 1 ? sections[0] : '';
}

/** Missing or wrong values of a row: the same check as before writing it. */
function inputErrors(
  input: EventRowInput,
  section: string,
  written: string,
  sections: readonly string[]
): EventIssue[] {
  const errors: EventIssue[] = [];
  if (!cleanText(input.title, MAX_LENGTH.title)) errors.push({ code: 'noTitle' });
  if (!input.date) errors.push({ code: 'noDate' });
  else if (!isIsoDate(input.date)) errors.push({ code: 'badDate' });
  if (!section) {
    errors.push(written ? { code: 'unknownSection', written } : { code: 'noSection' });
  } else if (!sections.includes(section)) {
    errors.push({ code: 'unknownSection', written: section });
  }
  if (input.timeFrom && !isTime(input.timeFrom)) errors.push({ code: 'badTimeFrom' });
  if (input.timeTo && !isTime(input.timeTo)) errors.push({ code: 'badTimeTo' });
  if (isTime(input.timeFrom) && isTime(input.timeTo) && input.timeTo <= input.timeFrom) {
    errors.push({ code: 'timeOrder' });
  }
  if (
    input.dateTo &&
    (!isIsoDate(input.dateTo) || (isIsoDate(input.date) && input.dateTo <= input.date))
  ) {
    errors.push({ code: 'badDateTo' });
  }
  return errors;
}

/** Two years after `today`, as YYYY-MM-DD (compared as text only) */
function twoYearsAfter(today: string): string {
  return `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`;
}

/** Whether another date is near enough to the row's and has an alike title. */
function isSameEvent(title: string, date: string, otherTitle: string, otherDate: string): boolean {
  if (!isIsoDate(otherDate)) return false;
  return (
    Math.abs(daysBetween(date, otherDate)) <= DUPLICATE_DAYS &&
    titleSimilarity(title, otherTitle) >= SIMILAR_TITLE
  );
}

/** The recorded event most like the row: the most alike title, then the nearest day. */
function findKnown(
  title: string,
  date: string,
  byDate: Map<string, KnownEvent[]>
): KnownEvent | null {
  let best: { event: KnownEvent; similarity: number; distance: number } | null = null;
  for (let offset = -DUPLICATE_DAYS; offset <= DUPLICATE_DAYS; offset++) {
    const day = new Date((dayNumber(date) + offset) * 86_400_000).toISOString().slice(0, 10);
    for (const event of byDate.get(day) ?? []) {
      const similarity = titleSimilarity(title, event.title);
      if (similarity < SIMILAR_TITLE) continue;
      const distance = Math.abs(offset);
      if (
        !best ||
        similarity > best.similarity ||
        (similarity === best.similarity && distance < best.distance)
      ) {
        best = { event, similarity, distance };
      }
    }
  }
  return best?.event ?? null;
}

/**
 * One review row per date read. Status: 'duplicate' when a recorded event
 * or an earlier row has an alike title on the same day or the day next to
 * it (not created unless the user ticks it), 'invalid' while a required
 * value is missing or wrong, else 'new'.
 */
export function reviewEvents(
  entries: EventEntry[],
  inputs: EventRowInput[],
  ctx: EventReviewContext
): EventReviewRow[] {
  const byDate = new Map<string, KnownEvent[]>();
  for (const event of ctx.known) {
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
  }
  const defaultSection = ctx.sections.includes(ctx.defaultSection) ? ctx.defaultSection : '';
  const later = twoYearsAfter(ctx.today);

  return entries.map((entry, i): EventReviewRow => {
    const input = inputs[i];
    const section = input.section || defaultSection;
    // Named only when the model's section is not one of the club's
    const written = section || matchSection(entry.section, ctx.sections) ? '' : entry.section;
    const errors = inputErrors(input, section, written, ctx.sections);
    const title = cleanText(input.title, MAX_LENGTH.title);
    const date = isIsoDate(input.date) ? input.date : '';

    let duplicate: EventDuplicate | null = null;
    if (title && date) {
      const known = findKnown(title, date, byDate);
      if (known) {
        duplicate = { kind: 'existing', event: known, webling: isWeblingEvent(known.description) };
      } else {
        const index = inputs
          .slice(0, i)
          .findIndex((other) => isSameEvent(title, date, other.title, other.date));
        if (index >= 0) duplicate = { kind: 'row', index };
      }
    }

    const warnings: EventIssue[] = [];
    if (date && date < ctx.today) warnings.push({ code: 'past' });
    if (date && date > later) warnings.push({ code: 'farFuture' });

    const status: EventRowStatus = duplicate ? 'duplicate' : errors.length > 0 ? 'invalid' : 'new';
    const selected = input.include ?? status !== 'duplicate';
    return {
      entry,
      input,
      section,
      status,
      selected,
      duplicate,
      errors,
      warnings,
      blocking: selected && errors.length > 0
    };
  });
}

/**
 * Fixes the default selection of the first review (duplicates unticked,
 * everything else ticked). Otherwise a row whose title or date is being
 * edited would untick itself, and fold away, the moment it looks like a
 * recorded event; it now stays ticked and shows the duplicate instead.
 */
export function preselect(inputs: EventRowInput[], rows: EventReviewRow[]): EventRowInput[] {
  return inputs.map((input, i) => ({ ...input, include: input.include ?? rows[i].selected }));
}

export interface EventReviewSummary {
  /** Rows created on apply */
  inserts: number;
  /** Rows that still need a fix or an untick */
  blocking: number;
  byStatus: Record<EventRowStatus, number>;
}

export function summarizeEvents(rows: EventReviewRow[]): EventReviewSummary {
  const byStatus: Record<EventRowStatus, number> = { new: 0, duplicate: 0, invalid: 0 };
  for (const row of rows) byStatus[row.status]++;
  return {
    inserts: rows.filter((r) => r.selected && r.errors.length === 0).length,
    blocking: rows.filter((r) => r.blocking).length,
    byStatus
  };
}

// ----- What is written -----

/** Exactly the columns of the "Event erstellen" form (dashboard/events/new). */
export interface EventInsert {
  title: string;
  description: string | null;
  date: string;
  timeFrom: string | null;
  timeTo: string | null;
  location: string | null;
  section: string;
  maxParticipants: null;
  registrationDeadline: null;
}

/**
 * The description as saved. events has no end date, so a multi-day event
 * is created on its first day with `untilLine(dateTo)` ("bis 16.11.2026")
 * as the description's first line.
 */
export function eventDescription(
  input: Pick<EventRowInput, 'date' | 'dateTo' | 'description'>,
  untilLine: (dateTo: string) => string
): string {
  const text = cleanText(input.description, MAX_LENGTH.description, true);
  const multiDay = isIsoDate(input.date) && isIsoDate(input.dateTo) && input.dateTo > input.date;
  if (!multiDay) return text;
  const line = untilLine(input.dateTo);
  return text.startsWith(line) ? text : `${line}\n${text}`.trim();
}

/**
 * The events to create, checked once more: only ticked rows without
 * errors, real dates, times as HH:MM with the end after the start, and a
 * section of the club. Nothing of the proposal is copied unchecked.
 */
export function buildEventInserts(
  rows: EventReviewRow[],
  sections: readonly string[],
  untilLine: (dateTo: string) => string
): EventInsert[] {
  const inserts: EventInsert[] = [];
  for (const row of rows) {
    const { input, section } = row;
    if (!row.selected || row.errors.length > 0) continue;
    if (inputErrors(input, section, '', sections).length > 0) continue;
    inserts.push({
      title: cleanText(input.title, MAX_LENGTH.title),
      description: eventDescription(input, untilLine) || null,
      date: input.date,
      timeFrom: input.timeFrom || null,
      timeTo: input.timeTo || null,
      location: cleanText(input.location, MAX_LENGTH.location) || null,
      section,
      maxParticipants: null,
      registrationDeadline: null
    });
  }
  return inserts;
}

// ----- Saving -----

/** What an insert into events answers, as far as insertEvents needs it */
export type InsertResult = PromiseLike<{ error: { code?: string; message?: string } | null }>;

export interface InsertOutcome {
  saved: EventInsert[];
  failed: EventInsert[];
}

/** The id the identity column handed out is already used (events has no other unique key) */
function isTakenId(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' && (error.message ?? '').includes('events_pkey');
}

/**
 * Creates the events one by one, so each succeeds or fails on its own and
 * the progress can be shown. events.id is an identity column that the
 * Webling sync also fills with its own ids (and the seed with fixed ones),
 * so the next id can be taken: such an insert (23505 on events_pkey) wrote
 * nothing and is tried again with the following id. Any other error ends
 * the row.
 */
export async function insertEvents(
  rows: EventInsert[],
  insert: (row: EventInsert) => InsertResult,
  onProgress?: (done: number) => void
): Promise<InsertOutcome> {
  const outcome: InsertOutcome = { saved: [], failed: [] };
  for (const row of rows) {
    let ok = false;
    try {
      for (let attempt = 0; attempt <= ID_RETRIES; attempt++) {
        const { error } = await insert(row);
        if (!error) {
          ok = true;
          break;
        }
        if (!isTakenId(error)) {
          console.error('Error creating an event from the assistant:', error);
          break;
        }
      }
    } catch (err) {
      console.error('Error creating an event from the assistant:', err);
    }
    (ok ? outcome.saved : outcome.failed).push(row);
    onProgress?.(outcome.saved.length + outcome.failed.length);
  }
  return outcome;
}
