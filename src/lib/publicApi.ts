/**
 * Alleda's API for other systems (docs/API.md): the answers of /api/v1/,
 * built from what the database functions return for an API key.
 *
 * Client-safe (no SvelteKit or Supabase imports), so the API key section of
 * the integrations page shares the scopes and the key format.
 */

import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import { addDays, parseTime, zurichToday } from './calendarFeed';
import { buildPlan, type PlanTraining } from './trainingPlanUtils';

/** What a key may read; the database knows the same list (api_keys.scopes) */
export const API_SCOPES = ['training_plan:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** How the training plan names trainers (api_keys.trainer_names) */
export const TRAINER_NAME_MODES = ['full', 'initial', 'none'] as const;
export type TrainerNameMode = (typeof TRAINER_NAME_MODES)[number];

/** alleda_ and 48 hex characters, as api_key_create() makes them */
const API_KEY = /^alleda_[0-9a-f]{48}$/;

/** The key from `Authorization: Bearer alleda_…`, null without a well-formed one */
export function bearerKey(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return m && API_KEY.test(m[1]) ? m[1] : null;
}

/**
 * An origin as the browser sends it (scheme, host, port; lower case, no
 * path), null for anything else. Accepts what an admin pastes: a trailing
 * slash or a path is dropped.
 */
export function normalizeOrigin(value: string): string | null {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** The origins of a text field (one per line, or separated by commas or spaces) */
export function parseOrigins(text: string): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const origin = normalizeOrigin(part);
    if (!origin) invalid.push(part);
    else if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins, invalid };
}

/** Longest period one request may ask for (the database allows 400 days) */
export const MAX_RANGE_DAYS = 366;
/** Without `to`: eight weeks from `from` */
export const DEFAULT_RANGE_DAYS = 56;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type TrainingPlanQuery = { from: string; to: string; trainingIds: number[] | null };

/**
 * from, to (YYYY-MM-DD, inclusive) and training (ids, comma separated) of a
 * request; from defaults to today in Europe/Zurich, to to eight weeks later
 */
export function parseTrainingPlanQuery(
  params: URLSearchParams,
  now: Date
): { ok: true; query: TrainingPlanQuery } | { ok: false; message: string } {
  const from = params.get('from') ?? zurichToday(now);
  if (!validDate(from)) return { ok: false, message: 'from must be a date (YYYY-MM-DD)' };
  const to = params.get('to') ?? addDays(from, DEFAULT_RANGE_DAYS - 1);
  if (!validDate(to)) return { ok: false, message: 'to must be a date (YYYY-MM-DD)' };
  if (to < from) return { ok: false, message: 'to must not be before from' };
  if (to > addDays(from, MAX_RANGE_DAYS - 1)) {
    return { ok: false, message: `at most ${MAX_RANGE_DAYS} days per request` };
  }

  let trainingIds: number[] | null = null;
  const training = params.get('training');
  if (training != null) {
    const parts = training.split(',').map((p) => p.trim());
    if (parts.some((p) => !/^\d{1,10}$/.test(p))) {
      return { ok: false, message: 'training must be training ids, separated by commas' };
    }
    trainingIds = parts.map(Number);
  }
  return { ok: true, query: { from, to, trainingIds } };
}

/** A training of the plan as api_training_plan() returns it */
export interface ApiPlanTraining extends PlanTraining {
  dateTo?: string | null;
}

/** What api_training_plan(p_key, p_from, p_to) returns for a valid key */
export interface ApiTrainingPlanData {
  /** The key's origins, for CORS */
  allowed_origins: string[];
  trainings: ApiPlanTraining[];
  /** Without notes; trainer_id null when the key shows no names */
  sessions: Omit<TrainingPlanSession, 'notes' | 'updated_at'>[];
  breaks: TrainingPlanBreak[];
  /** Names as the key says; empty when it shows none */
  trainers: { id: number; name: string }[];
}

/** "18.00", "18:00:00" → "18:00", null when it is no time */
function time(value: string | null | undefined): string | null {
  const minutes = parseTime(value);
  if (minutes == null) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export interface ApiTraining {
  id: number;
  title: string;
  /** English weekday, as in Alleda: Monday … Sunday */
  weekday: string;
  /** Local time (Europe/Zurich), HH:MM; null when the training has none */
  start: string | null;
  end: string | null;
  section: string | null;
}

export interface ApiSession {
  /** YYYY-MM-DD */
  date: string;
  trainingId: number;
  title: string;
  start: string | null;
  end: string | null;
  /** Who leads: the planned trainer, else the main trainer; null when open or names are off */
  trainer: string | null;
  topic: string | null;
  cancelled: boolean;
  /** The holiday that closes the dojo, when that is why it is dropped */
  cancelReason: string | null;
  /** Holidays the training takes place in (school holidays) */
  holiday: string | null;
}

export interface ApiHoliday {
  title: string;
  /** First and last day, inclusive */
  from: string;
  to: string;
  /** Dojo closed: planned trainings are dropped unless held explicitly */
  dojoClosed: boolean;
}

/** The answer of GET /api/v1/training-plan */
export interface ApiTrainingPlan {
  from: string;
  to: string;
  timezone: 'Europe/Zurich';
  trainings: ApiTraining[];
  sessions: ApiSession[];
  holidays: ApiHoliday[];
}

/**
 * The plan between from and to: every date of every planned training (or
 * of the asked ones), computed with buildPlan() as on the plan page and in
 * the calendar feeds, by date and start time
 */
export function buildApiTrainingPlan(
  data: ApiTrainingPlanData,
  query: TrainingPlanQuery
): ApiTrainingPlan {
  const asked = query.trainingIds ? new Set(query.trainingIds) : null;
  const trainings = (data.trainings ?? []).filter((t) => !asked || asked.has(t.id));
  const names = new Map((data.trainers ?? []).map((t) => [t.id, t.name]));
  const sessions = (data.sessions ?? []).map((s) => ({
    ...s,
    notes: null,
    updated_at: ''
  })) as TrainingPlanSession[];
  const breaks = data.breaks ?? [];

  const rows = buildPlan(trainings, sessions, breaks, [], query.from, query.to);

  return {
    from: query.from,
    to: query.to,
    timezone: 'Europe/Zurich',
    trainings: trainings.map((t) => ({
      id: t.id,
      title: t.title,
      weekday: t.weekday,
      start: time(t.dateFrom),
      end: time(t.dateTo),
      section: t.section ?? null
    })),
    sessions: rows.map((row) => {
      const training = row.training as ApiPlanTraining;
      const closedBy = row.cancelled && row.session?.cancelled !== true ? row.break : null;
      const reason = closedBy?.cancels_training ? closedBy.title : null;
      return {
        date: row.date,
        trainingId: training.id,
        title: training.title,
        start: time(training.dateFrom),
        end: time(training.dateTo),
        trainer: row.trainerId == null ? null : (names.get(row.trainerId) ?? null),
        topic: row.session?.topic?.trim() || null,
        cancelled: row.cancelled,
        cancelReason: reason,
        holiday: row.break && row.break.title !== reason ? row.break.title : null
      };
    }),
    holidays: breaks.map((b) => ({
      title: b.title,
      from: b.date_from,
      to: b.date_to,
      dojoClosed: b.cancels_training
    }))
  };
}

/** A row of api_keys as admins see it (never the hash) */
export interface ApiKeyRow {
  id: string;
  name: string;
  /** The first 8 characters after alleda_ */
  prefix: string;
  scopes: ApiScope[];
  allowed_origins: string[];
  trainer_names: TrainerNameMode;
  created_at: string;
  last_used_at: string | null;
}

export const API_KEY_COLUMNS =
  'id, name, prefix, scopes, allowed_origins, trainer_names, created_at, last_used_at';
