import type { TrainerRole } from '$lib/models';

/**
 * Daten-Assistent (docs/AI_ASSISTANT.md): a staff member uploads a photo, a
 * PDF or pasted text, /api/assistant has Claude transcribe it into one of
 * the proposal shapes below, and a review dialog lets the user check and
 * repair every value before the browser writes it under RLS. The model
 * never writes anything itself and never sees member data.
 */

export const ASSISTANT_KINDS = [
  'grades',
  'attendance',
  'training_plan',
  'lesson_plan',
  'events'
] as const;

/** What the assistant extracts; also the `kind` column of `ai_imports`. */
export type AssistantKind = (typeof ASSISTANT_KINDS)[number];

export function isAssistantKind(value: unknown): value is AssistantKind {
  return typeof value === 'string' && (ASSISTANT_KINDS as readonly string[]).includes(value);
}

/** How sure the model is about one row; low rows are highlighted for review. */
export type Confidence = 'high' | 'medium' | 'low';
export const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

/** One passed grading as read from a Judo pass. */
export interface GradeEntry {
  /** A grade of the ladder (e.g. '5. Kyu', '5.5 Kyu', '1. Dan') or '' when unclear */
  grade: string;
  /** The wording on the document, e.g. 'Gelbgurt' or '5. Kyu' */
  gradeAsWritten: string;
  /** Belt colour as written or shown, e.g. 'gelb', 'weiss-gelb'; '' if none */
  beltColor: string;
  /** YYYY-MM-DD, or YYYY-MM / YYYY when only part of it is legible, '' if missing */
  date: string;
  /** Examiner or stamp, as written */
  examiner: string;
  confidence: Confidence;
  /** Short note of the model, e.g. why a value is uncertain */
  remark: string;
}

export interface GradesProposal {
  /** 'Judo', 'Aikido' (a section of the grade ladder) or '' */
  section: string;
  /** The pass holder as printed, only to check it is the right member's pass */
  holder: { name: string; birthday: string };
  entries: GradeEntry[];
  warnings: string[];
}

/** One person on an attendance list. */
export interface AttendanceEntry {
  name: string;
  role: TrainerRole;
  /** Session dates attended (grid lists); empty for a list of one session */
  dates: string[];
  confidence: Confidence;
  remark: string;
}

export interface AttendanceProposal {
  /** Title, weekday or time of the training as written on the list */
  trainingAsWritten: string;
  /** All session dates on the list (YYYY-MM-DD); empty when none is written */
  dates: string[];
  entries: AttendanceEntry[];
  warnings: string[];
}

/** One training on one date of a training plan. */
export interface PlanSessionEntry {
  date: string;
  /** trainings.id of a planned training, null when the model found no match */
  trainingId: number | null;
  trainingAsWritten: string;
  /** The leader's name as written, '' if none */
  trainer: string;
  topic: string;
  notes: string;
  cancelled: boolean;
  confidence: Confidence;
  remark: string;
}

/** Holidays or a closed dojo spanning several days. */
export interface HolidayEntry {
  title: string;
  dateFrom: string;
  dateTo: string;
  /** Dojo closed: no training at all (training_plan_breaks.cancels_training) */
  closed: boolean;
}

export interface TrainingPlanProposal {
  sessions: PlanSessionEntry[];
  holidays: HolidayEntry[];
  warnings: string[];
}

export interface LessonPlanSection {
  heading: string;
  items: string[];
}

export interface LessonPlanProposal {
  /** Session date if written on the plan, else '' */
  date: string;
  title: string;
  sections: LessonPlanSection[];
  warnings: string[];
}

/** One club date (Termin). */
export interface EventEntry {
  title: string;
  date: string;
  /** Last day of a multi-day event, '' otherwise */
  dateTo: string;
  /** HH:MM or '' */
  timeFrom: string;
  timeTo: string;
  location: string;
  /** As written; mapped to a club section in the review */
  section: string;
  description: string;
  confidence: Confidence;
  remark: string;
}

export interface EventsProposal {
  events: EventEntry[];
  warnings: string[];
}

export interface ProposalMap {
  grades: GradesProposal;
  attendance: AttendanceProposal;
  training_plan: TrainingPlanProposal;
  lesson_plan: LessonPlanProposal;
  events: EventsProposal;
}

/**
 * What the dialog was opened for. Only ids and a date: the server loads the
 * matching reference data (grade ladder, training) itself.
 */
export interface AssistantContext {
  /** Member whose pass is read (grades); never sent to the model */
  memberId?: number;
  /** Training of the list or lesson plan (attendance, lesson_plan) */
  trainingId?: number;
  /** Session date YYYY-MM-DD (attendance, lesson_plan) */
  date?: string;
}

export const ASSISTANT_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf'
] as const;

export type AssistantMediaType = (typeof ASSISTANT_MEDIA_TYPES)[number];

export interface AssistantFile {
  name: string;
  mediaType: AssistantMediaType;
  /** Base64, no data: prefix */
  data: string;
}

export interface AssistantRequest {
  kind: AssistantKind;
  files: AssistantFile[];
  /** Pasted text or the contents of a .txt / .csv file */
  text: string;
  /** Optional clarification by the user, e.g. which column holds what */
  hint: string;
  locale: 'de' | 'en';
  context: AssistantContext;
}

export interface AssistantResponse<K extends AssistantKind = AssistantKind> {
  kind: K;
  proposal: ProposalMap[K];
  /** Extractions this account has left today */
  remaining: number | null;
}

export interface AssistantStatus {
  /** PRIVATE_ANTHROPIC_API_KEY is set */
  configured: boolean;
  /** Extractions left today, null when unknown */
  remaining: number | null;
}

/** Error codes of /api/assistant; the dialog shows assistant.errors.<code>. */
export const ASSISTANT_ERROR_CODES = [
  'not_configured',
  'unauthorized',
  'forbidden',
  'quota',
  'too_large',
  'invalid_request',
  'not_found',
  'refused',
  'incomplete',
  'invalid_output',
  'timeout',
  'busy',
  'failed'
] as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

/**
 * Upload limits, checked in the browser and again on the server. Netlify
 * buffers request bodies up to 6 MB; base64 adds a third, so the files may
 * take up to 3.5 MB together.
 */
export const ASSISTANT_LIMITS = {
  maxFiles: 4,
  maxTotalBytes: 3_500_000,
  /** Long edge images are scaled down to before upload */
  imageMaxEdge: 2000,
  maxRequestBytes: 5_000_000,
  maxTextLength: 30_000,
  maxHintLength: 500
} as const;
