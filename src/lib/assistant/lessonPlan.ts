import type { LessonPlan } from '$lib/models';
import { cleanText, isIsoDate, MAX_LENGTH } from './proposals';
import type { LessonPlanProposal } from './types';

/**
 * Review of a lesson plan read by the Daten-Assistent (kind 'lesson_plan'):
 * turns the proposal into the editor's text format, compares it with the
 * plan already saved for the training and date (lesson_plans, one row per
 * training and date) and builds the one write. Pure, so LessonPlanReview
 * only renders and saves what comes out of here.
 */

/** Longest imported text accepted; a real lesson plan has a few thousand characters */
export const CONTENT_MAX = 20_000;

// ----- Text format -----

/** Bullet signs the model may keep from the document ("- ", "• ", "* ") */
const BULLET = /^(?:[-*–—](?:\s+|$)|[•·▪◦‣]\s*)+/;

function cleanHeading(text: string): string {
  return text
    .replace(/^#+\s*/, '')
    .replace(BULLET, '')
    .replace(/\s*:+$/, '')
    .trim();
}

function cleanItem(text: string): string {
  return text.replace(BULLET, '').trim();
}

/**
 * The proposal in the editor's format (page.trainings.defaultTemplate):
 * '## Heading', one '- item' per line, a blank line between the parts.
 */
export function proposalToContent(proposal: Pick<LessonPlanProposal, 'sections'>): string {
  return proposal.sections
    .map((section) => {
      const heading = cleanHeading(section.heading);
      const items = section.items.map(cleanItem).filter(Boolean);
      return [...(heading ? [`## ${heading}`] : []), ...items.map((item) => `- ${item}`)];
    })
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join('\n'))
    .join('\n\n');
}

/** Unified line endings, trimmed like the editor's save (content.trim()). */
export function normalizeContent(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

export interface LessonPlanLine {
  kind: 'h1' | 'h2' | 'h3' | 'item' | 'text';
  text: string;
}

/**
 * How the lesson plan card shows the text: '# ', '## ' and '### ' start a
 * heading, '- ' a bullet point, every other line is a paragraph.
 */
export function lessonPlanLines(content: string): LessonPlanLine[] {
  return content.split('\n').map((line): LessonPlanLine => {
    if (line.startsWith('# ')) return { kind: 'h1', text: line.slice(2) };
    if (line.startsWith('## ')) return { kind: 'h2', text: line.slice(3) };
    if (line.startsWith('### ')) return { kind: 'h3', text: line.slice(4) };
    if (line.startsWith('- ')) return { kind: 'item', text: line.slice(2) };
    return { kind: 'text', text: line };
  });
}

// ----- Target and saved plan -----

export interface LessonPlanTarget {
  trainingId: number;
  /** YYYY-MM-DD */
  date: string;
}

/** The page's training and date, or null when they cannot key a lesson plan. */
export function lessonPlanTarget(
  trainingId: string | number,
  date: string
): LessonPlanTarget | null {
  const id = Number(trainingId);
  // lesson_plans."trainingId" is a smallint; the date must match the check-in URLs
  if (!/^\d+$/.test(String(trainingId)) || id < 1 || id > 32767 || !isIsoDate(date)) return null;
  return { trainingId: id, date };
}

/**
 * Same training and date. Also checks that the plan the card holds was
 * loaded for the target: while another date loads (or after its load
 * failed) the card still holds the previous date's plan.
 */
export function sameTarget(a: LessonPlanTarget | null, b: LessonPlanTarget | null): boolean {
  return a !== null && b !== null && a.trainingId === b.trainingId && a.date === b.date;
}

/** The plan saved for the training and date, as far as the review needs it. */
export interface ExistingLessonPlan {
  id: string;
  title: string;
  content: string;
  fileName: string | null;
  /** Storage path in 'lesson-plans'; a plan with a file shows the file, not the text */
  filePath: string | null;
  /** updated_at as loaded: the update only goes through while it is unchanged */
  updatedAt: string | null;
}

export function toExistingPlan(plan: LessonPlan | null): ExistingLessonPlan | null {
  if (!plan) return null;
  return {
    id: plan.id,
    title: plan.title ?? '',
    content: plan.content ?? '',
    fileName: plan.fileName || null,
    filePath: plan.filePath || null,
    updatedAt: plan.updatedAt || null
  };
}

// ----- Review -----

/**
 * Replace the saved plan, or keep its text and add the import below it.
 * A saved text plan is extended by default and only replaced when the user
 * picks it; a saved file is only replaced after its own tick.
 */
export type LessonPlanMode = 'replace' | 'append';

export interface LessonPlanInput {
  title: string;
  /** The text read from the document, as edited in the review */
  content: string;
  mode: LessonPlanMode;
  /** Storage path of the saved file the user agreed to replace, null if none */
  replaceFile: string | null;
  /** Ticked: save for the page's date although the document names another */
  otherDate: boolean;
}

/** Replace keeps the saved title only when the document has none; append keeps it. */
export function defaultTitle(
  mode: LessonPlanMode,
  proposal: Pick<LessonPlanProposal, 'title'>,
  existing: ExistingLessonPlan | null
): string {
  return mode === 'append'
    ? existing?.title || proposal.title
    : proposal.title || existing?.title || '';
}

/**
 * The mode the review starts with: a saved text plan is kept and the
 * import added below it, so nothing written is lost by accident. With no
 * plan there is nothing to keep; a file cannot be extended (its tick
 * guards it instead).
 */
export function defaultMode(existing: ExistingLessonPlan | null): LessonPlanMode {
  return existing && !existing.filePath ? 'append' : 'replace';
}

export function initialInput(
  proposal: LessonPlanProposal,
  existing: ExistingLessonPlan | null
): LessonPlanInput {
  const mode = defaultMode(existing);
  return {
    title: defaultTitle(mode, proposal, existing),
    content: proposalToContent(proposal),
    mode,
    replaceFile: null,
    otherDate: false
  };
}

/** The same saved plan, unchanged since it was loaded (or both none). */
export function samePlan(a: ExistingLessonPlan | null, b: ExistingLessonPlan | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.updatedAt === b.updatedAt && a.filePath === b.filePath;
}

/**
 * The input once the saved plan was loaded again and differs from the one
 * the user decided on (saved meanwhile by someone else, or by a save that
 * reported an error): the choice to replace was made for the other plan,
 * so the mode goes back to the default, and a title the user did not
 * change follows it. The text read and the ticks stay (the file tick
 * names its file, so another file needs a new one anyway).
 */
export function rebaseInput(
  input: LessonPlanInput,
  proposal: Pick<LessonPlanProposal, 'title'>,
  before: ExistingLessonPlan | null,
  after: ExistingLessonPlan | null
): LessonPlanInput {
  if (samePlan(before, after)) return input;
  const mode = defaultMode(after);
  const title =
    input.title === defaultTitle(input.mode, proposal, before)
      ? defaultTitle(mode, proposal, after)
      : input.title;
  return { ...input, mode, title };
}

export type LessonPlanStatus = 'new' | 'changed' | 'exists' | 'duplicate' | 'invalid';

export type LessonPlanError =
  'target' | 'empty' | 'tooLong' | 'fileNotConfirmed' | 'dateNotConfirmed';

/** Errors the user fixes in the fields; the others are missing ticks */
const FIELD_ERRORS: readonly LessonPlanError[] = ['target', 'empty', 'tooLong'];

export interface LessonPlanReviewContext {
  trainingId: number;
  date: string;
  existing: ExistingLessonPlan | null;
}

export interface LessonPlanReview {
  status: LessonPlanStatus;
  /** Append only when there is saved text to append to */
  mode: LessonPlanMode;
  /** Title and whole content as they are saved */
  title: string;
  content: string;
  /** Date written on the document when it is not the page's */
  writtenDate: string | null;
  /** Saved title that saving changes or removes */
  previousTitle: string | null;
  /** Saving removes the saved plan's file */
  replacesFile: boolean;
  errors: LessonPlanError[];
  /** Something to write and nothing in the way */
  ready: boolean;
}

export function reviewLessonPlan(
  proposal: LessonPlanProposal,
  input: LessonPlanInput,
  context: LessonPlanReviewContext
): LessonPlanReview {
  const { existing } = context;
  const file = existing?.filePath ?? null;
  const mode: LessonPlanMode = existing && !file ? input.mode : 'replace';
  const draft = normalizeContent(input.content);
  const saved = normalizeContent(existing?.content ?? '');
  const content = mode === 'append' && saved ? `${saved}\n\n${draft}` : draft;
  const title = cleanText(input.title, MAX_LENGTH.title);
  const savedTitle = cleanText(existing?.title ?? '', MAX_LENGTH.title);
  const writtenDate = proposal.date && proposal.date !== context.date ? proposal.date : null;

  const errors: LessonPlanError[] = [];
  if (!lessonPlanTarget(context.trainingId, context.date)) errors.push('target');
  if (!draft) errors.push('empty');
  else if (draft.length > CONTENT_MAX) errors.push('tooLong');
  // The tick names the file, so a file swapped in meanwhile needs a new one
  if (file && input.replaceFile !== file) errors.push('fileNotConfirmed');
  if (writtenDate && !input.otherDate) errors.push('dateNotConfirmed');

  let status: LessonPlanStatus;
  if (errors.some((e) => FIELD_ERRORS.includes(e))) status = 'invalid';
  else if (!existing) status = 'new';
  // Appending lines the plan already has (e.g. the same import twice) adds nothing
  else if (mode === 'append' && `\n${saved}\n`.includes(`\n${draft}\n`)) status = 'duplicate';
  else if (!file && content === saved && title === savedTitle) status = 'exists';
  else status = 'changed';

  return {
    status,
    mode,
    title,
    content,
    writtenDate,
    previousTitle: existing && savedTitle && savedTitle !== title ? savedTitle : null,
    replacesFile: file !== null,
    errors,
    ready: (status === 'new' || status === 'changed') && errors.length === 0
  };
}

// ----- Write -----

/** Columns of a new plan, as the editor's saveLessonPlan inserts them */
export interface LessonPlanInsert {
  trainingId: number;
  date: string;
  title: string | null;
  content: string;
  created_by?: string;
}

/** Columns of an update: text replaces any file, as in the editor's text tab */
export interface LessonPlanUpdate {
  title: string | null;
  content: string;
  file_name: null;
  file_path: null;
  file_type: null;
  file_size: null;
}

export type LessonPlanWrite =
  | { action: 'insert'; row: LessonPlanInsert }
  | {
      action: 'update';
      /** The row is only updated while it is still the one reviewed */
      match: {
        id: string;
        trainingId: number;
        date: string;
        updatedAt: string | null;
        filePath: string | null;
      };
      row: LessonPlanUpdate;
      /** Storage object to remove once the row no longer points to it */
      removeFile: string | null;
    };

/**
 * The write for what the review shows, or null when it is not ready. The
 * review is computed again here, so nothing unchecked can be written.
 */
export function buildLessonPlanWrite(
  proposal: LessonPlanProposal,
  input: LessonPlanInput,
  context: LessonPlanReviewContext,
  userId: string | null
): LessonPlanWrite | null {
  const target = lessonPlanTarget(context.trainingId, context.date);
  const review = reviewLessonPlan(proposal, input, context);
  if (!target || !review.ready) return null;
  const title = review.title || null;
  const { existing } = context;
  if (!existing) {
    const row: LessonPlanInsert = {
      trainingId: target.trainingId,
      date: target.date,
      title,
      content: review.content
    };
    if (userId) row.created_by = userId;
    return { action: 'insert', row };
  }
  return {
    action: 'update',
    match: {
      id: existing.id,
      trainingId: target.trainingId,
      date: target.date,
      updatedAt: existing.updatedAt,
      filePath: existing.filePath
    },
    row: {
      title,
      content: review.content,
      file_name: null,
      file_path: null,
      file_type: null,
      file_size: null
    },
    removeFile: existing.filePath
  };
}
