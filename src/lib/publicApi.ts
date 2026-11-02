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
export const API_SCOPES = ['training_plan:read', 'event_participants:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/**
 * Scopes that give personal data: a key with one of them is for servers
 * only and lists no websites (the database refuses origins for it)
 */
export const SERVER_ONLY_SCOPES: readonly ApiScope[] = ['event_participants:read'];

/** Whether a key with these scopes may list websites (CORS) */
export function scopesAllowOrigins(scopes: readonly string[]): boolean {
  return !scopes.some((s) => (SERVER_ONLY_SCOPES as readonly string[]).includes(s));
}

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

export type DateRange = { from: string; to: string };

/**
 * from and to (YYYY-MM-DD, inclusive) of a request, at most MAX_RANGE_DAYS
 * apart; defaults: from as given, to `days` days from from
 */
function parseRange(
  params: URLSearchParams,
  defaultFrom: string,
  defaultDays: number
): { ok: true; range: DateRange } | { ok: false; message: string } {
  const from = params.get('from') ?? defaultFrom;
  if (!validDate(from)) return { ok: false, message: 'from must be a date (YYYY-MM-DD)' };
  const to = params.get('to') ?? addDays(from, defaultDays - 1);
  if (!validDate(to)) return { ok: false, message: 'to must be a date (YYYY-MM-DD)' };
  if (to < from) return { ok: false, message: 'to must not be before from' };
  if (to > addDays(from, MAX_RANGE_DAYS - 1)) {
    return { ok: false, message: `at most ${MAX_RANGE_DAYS} days per request` };
  }
  return { ok: true, range: { from, to } };
}

export type TrainingPlanQuery = DateRange & { trainingIds: number[] | null };

/**
 * from, to (YYYY-MM-DD, inclusive) and training (ids, comma separated) of a
 * request; from defaults to today in Europe/Zurich, to to eight weeks later
 */
export function parseTrainingPlanQuery(
  params: URLSearchParams,
  now: Date
): { ok: true; query: TrainingPlanQuery } | { ok: false; message: string } {
  const range = parseRange(params, zurichToday(now), DEFAULT_RANGE_DAYS);
  if (!range.ok) return range;

  let trainingIds: number[] | null = null;
  const training = params.get('training');
  if (training != null) {
    const parts = training.split(',').map((p) => p.trim());
    if (parts.some((p) => !/^\d{1,10}$/.test(p))) {
      return { ok: false, message: 'training must be training ids, separated by commas' };
    }
    trainingIds = parts.map(Number);
  }
  return { ok: true, query: { ...range.range, trainingIds } };
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

/** Without from: events from 90 days ago; without to: 180 days from from */
export const EVENTS_DEFAULT_PAST_DAYS = 90;
export const EVENTS_DEFAULT_RANGE_DAYS = 180;

/** from and to of GET /api/v1/events; the events overlapping them are listed */
export function parseEventsQuery(
  params: URLSearchParams,
  now: Date
): { ok: true; query: DateRange } | { ok: false; message: string } {
  const range = parseRange(
    params,
    addDays(zurichToday(now), -EVENTS_DEFAULT_PAST_DAYS),
    EVENTS_DEFAULT_RANGE_DAYS
  );
  return range.ok ? { ok: true, query: range.range } : range;
}

/** The event id of /api/v1/events/{id}/participants, null when it is none */
export function parseEventId(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id >= 1 && id <= 2147483647 ? id : null;
}

/** ?attended=true: only who attended; false or missing: everyone */
export function parseAttendedFilter(
  params: URLSearchParams
): { ok: true; attendedOnly: boolean } | { ok: false; message: string } {
  const value = params.get('attended');
  if (value == null || value === 'false') return { ok: true, attendedOnly: false };
  if (value === 'true') return { ok: true, attendedOnly: true };
  return { ok: false, message: 'attended must be true or false' };
}

/** An event as api_events() and api_event_participants() return it */
export interface ApiEventData {
  id: number;
  title: string;
  date: string;
  date_to: string | null;
  all_day: boolean | null;
  timeFrom: string | null;
  timeTo: string | null;
  location: string | null;
  section: string | null;
  registered: number;
  attended: number;
}

/** What api_events(p_key, p_from, p_to) returns for a valid key */
export interface ApiEventsData {
  allowed_origins: string[];
  events: ApiEventData[];
}

/** A participant as api_event_participants() returns it */
export interface ApiParticipantData {
  id: number;
  firstname: string;
  lastname: string;
  registered: boolean;
  attended: boolean;
  coach: boolean;
}

/** What api_event_participants(p_key, p_event_id) returns for a valid key */
export interface ApiEventParticipantsData {
  allowed_origins: string[];
  /** null: no such event */
  event: ApiEventData | null;
  participants?: ApiParticipantData[];
}

export interface ApiEvent {
  id: number;
  title: string;
  /** First and last day, YYYY-MM-DD (the same for a one-day event) */
  date: string;
  dateTo: string;
  allDay: boolean;
  /** Local time (Europe/Zurich), HH:MM; null all day or without a time */
  start: string | null;
  end: string | null;
  location: string | null;
  section: string | null;
  /** Registrations not cancelled */
  registered: number;
  /** Members recorded as attended */
  attended: number;
}

export interface ApiParticipant {
  /** The member's id in Alleda (the Webling id for members from Webling) */
  memberId: number;
  firstname: string;
  lastname: string;
  /** Registered (and not cancelled) */
  registered: boolean;
  /** Recorded as attended */
  attended: boolean;
  /** Attended as coach / leader */
  coach: boolean;
}

/** The answer of GET /api/v1/events */
export interface ApiEvents {
  from: string;
  to: string;
  timezone: 'Europe/Zurich';
  events: ApiEvent[];
}

/** The answer of GET /api/v1/events/{id}/participants */
export interface ApiEventParticipants {
  event: ApiEvent;
  participants: ApiParticipant[];
}

export function buildApiEvent(e: ApiEventData): ApiEvent {
  const allDay = e.all_day === true;
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    dateTo: e.date_to && e.date_to > e.date ? e.date_to : e.date,
    allDay,
    start: allDay ? null : time(e.timeFrom),
    end: allDay ? null : time(e.timeTo),
    location: e.location?.trim() || null,
    section: e.section?.trim() || null,
    registered: Number(e.registered) || 0,
    attended: Number(e.attended) || 0
  };
}

export function buildApiEvents(data: ApiEventsData, query: DateRange): ApiEvents {
  return {
    from: query.from,
    to: query.to,
    timezone: 'Europe/Zurich',
    events: (data.events ?? []).map(buildApiEvent)
  };
}

/** The event and its participants (by last name), only who attended when asked */
export function buildApiEventParticipants(
  data: ApiEventParticipantsData & { event: ApiEventData },
  attendedOnly: boolean
): ApiEventParticipants {
  return {
    event: buildApiEvent(data.event),
    participants: (data.participants ?? [])
      .filter((p) => !attendedOnly || p.attended)
      .map((p) => ({
        memberId: p.id,
        firstname: p.firstname,
        lastname: p.lastname,
        registered: p.registered === true,
        attended: p.attended === true,
        coach: p.coach === true
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
