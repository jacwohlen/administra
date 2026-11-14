/**
 * Einsätze (activity report): per person and period, how many trainings
 * they led as main trainer, how many as assistant, and how many days they
 * coached at events.
 *
 * Trainings count from the check-in (`logs."trainerRole"`): whoever was
 * checked in as main trainer or assistant on a date trained, so a
 * substitute or swapped date (Vertretung / Tausch) counts for the person
 * who actually came, not for the one first planned. Dates the plan expected
 * a trainer for but whose check-in has no main trainer are listed to be
 * checked, with the trainer the plan names (after substitutes and swaps).
 *
 * Coaching days count from the event check-in (`event_logs."isCoach"`):
 * every day of the event within the period, a full day 1, a half day 0.5
 * (`event_logs."coachDay"`; without that column every day is full).
 */
import { buildPlan, type PlanTraining } from './trainingPlanUtils.ts';
import { eventDays, eventEnd } from './eventUtils.ts';
import type { TrainingPlanBreak, TrainingPlanSession } from './models.ts';
import type { PdfDocument, PdfTable } from './pdf.ts';

export interface ReportPerson {
  id: number;
  firstname: string | null;
  lastname: string | null;
}

export interface ReportTraining {
  id: number;
  title: string;
  section: string | null;
}

/** A trainer's check-in on a date */
export interface ReportTrainerLog {
  date: string;
  trainingId: number;
  memberId: number;
  trainerRole: 'main_trainer' | 'assistant' | 'attendee';
}

/** One training held on a date (view_logs_summary) */
export interface ReportHeldSession {
  date: string;
  trainingId: number;
  count: number;
  mainTrainerCount: number;
}

export interface ReportEvent {
  id: number;
  title: string;
  date: string;
  date_to?: string | null;
  section?: string | null;
}

/** A coach's check-in at an event */
export interface ReportCoachLog {
  eventId: number;
  memberId: number;
  /** 'half' for half a day per event day; missing or 'full' for a full day */
  coachDay?: string | null;
}

export interface ReportPlan {
  trainings: PlanTraining[];
  sessions: TrainingPlanSession[];
  breaks: TrainingPlanBreak[];
}

export interface ReportInput {
  from: string;
  to: string;
  /** Dates after today are never "to check" */
  today: string;
  members: ReportPerson[];
  trainings: ReportTraining[];
  trainerLogs: ReportTrainerLog[];
  held: ReportHeldSession[];
  events: ReportEvent[];
  coachLogs: ReportCoachLog[];
  plan: ReportPlan;
}

export interface ActivityRow {
  memberId: number;
  name: string;
  mainTrainer: number;
  assistant: number;
  coachingDays: number;
}

export interface TrainingDetailRow {
  date: string;
  training: string;
  section: string;
  mainTrainers: string[];
  assistants: string[];
}

export interface CoachingDetailRow {
  /** First day within the period */
  date: string;
  /** Last day within the period */
  dateTo: string;
  event: string;
  /** Each coach with the days counted for them */
  coaches: { name: string; days: number }[];
}

export type CheckReason = 'no_main_trainer' | 'no_checkin';

/** A date the plan expected a trainer for that the check-in does not show */
export interface CheckRow {
  date: string;
  training: string;
  section: string;
  /** The trainer the plan names (after substitutes and swaps), '' when open */
  plannedTrainer: string;
  reason: CheckReason;
}

export interface ActivityReport {
  from: string;
  to: string;
  rows: ActivityRow[];
  totals: { mainTrainer: number; assistant: number; coachingDays: number };
  trainings: TrainingDetailRow[];
  coaching: CoachingDetailRow[];
  checks: CheckRow[];
}

export function personName(p: ReportPerson | undefined, id: number): string {
  const name = p ? `${p.lastname ?? ''} ${p.firstname ?? ''}`.trim() : '';
  return name || `#${id}`;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'de');

/** A coach's share of one event day: 0.5 for a half day, else 1 */
export function coachDayFactor(coachDay: string | null | undefined): number {
  return coachDay === 'half' ? 0.5 : 1;
}

export function buildActivityReport(input: ReportInput): ActivityReport {
  const { from, to } = input;
  const inRange = (d: string) => from <= d && d <= to;
  const members = new Map(input.members.map((m) => [m.id, m]));
  const trainings = new Map(input.trainings.map((t) => [t.id, t]));
  const name = (id: number) => personName(members.get(id), id);

  const rows = new Map<number, ActivityRow>();
  const row = (memberId: number) => {
    let r = rows.get(memberId);
    if (!r) {
      r = { memberId, name: name(memberId), mainTrainer: 0, assistant: 0, coachingDays: 0 };
      rows.set(memberId, r);
    }
    return r;
  };

  // Trainings: one count per person, training and date, by the check-in role
  const sessions = new Map<string, TrainingDetailRow & { trainingId: number }>();
  const seen = new Set<string>();
  for (const l of input.trainerLogs) {
    if (!inRange(l.date)) continue;
    if (l.trainerRole !== 'main_trainer' && l.trainerRole !== 'assistant') continue;
    const once = `${l.memberId}|${l.trainingId}|${l.date}`;
    if (seen.has(once)) continue;
    seen.add(once);
    const r = row(l.memberId);
    if (l.trainerRole === 'main_trainer') r.mainTrainer++;
    else r.assistant++;

    const key = `${l.trainingId}|${l.date}`;
    let s = sessions.get(key);
    if (!s) {
      const t = trainings.get(l.trainingId);
      s = {
        date: l.date,
        trainingId: l.trainingId,
        training: t?.title ?? `#${l.trainingId}`,
        section: t?.section ?? '',
        mainTrainers: [],
        assistants: []
      };
      sessions.set(key, s);
    }
    (l.trainerRole === 'main_trainer' ? s.mainTrainers : s.assistants).push(name(l.memberId));
  }

  // Coaching: every event day within the period, overlapping events on the
  // same day counted once per person (the larger share)
  const events = new Map(input.events.map((e) => [e.id, e]));
  const coachDays = new Map<number, Map<string, number>>();
  const coachingByEvent = new Map<number, Map<number, number>>();
  for (const c of input.coachLogs) {
    const e = events.get(c.eventId);
    if (!e) continue;
    const factor = coachDayFactor(c.coachDay);
    const days = eventDays(e, from, to);
    if (days.length === 0) continue;
    const perDay = coachDays.get(c.memberId) ?? new Map<string, number>();
    coachDays.set(c.memberId, perDay);
    for (const d of days) perDay.set(d, Math.max(perDay.get(d) ?? 0, factor));
    const coaches = coachingByEvent.get(e.id) ?? new Map<number, number>();
    coachingByEvent.set(e.id, coaches);
    coaches.set(c.memberId, Math.max(coaches.get(c.memberId) ?? 0, factor * days.length));
  }
  for (const [memberId, perDay] of coachDays) {
    row(memberId).coachingDays = [...perDay.values()].reduce((n, v) => n + v, 0);
  }

  const activityRows = [...rows.values()]
    .filter((r) => r.mainTrainer + r.assistant + r.coachingDays > 0)
    .sort((a, b) => byName(a.name, b.name) || a.memberId - b.memberId);

  const trainingRows = [...sessions.values()]
    .map((s): TrainingDetailRow => ({
      date: s.date,
      training: s.training,
      section: s.section,
      mainTrainers: s.mainTrainers.sort(byName),
      assistants: s.assistants.sort(byName)
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        byName(a.section, b.section) ||
        byName(a.training, b.training)
    );

  const coachingRows: CoachingDetailRow[] = [...coachingByEvent.entries()]
    .map(([eventId, coaches]) => {
      const e = events.get(eventId)!;
      const end = eventEnd(e);
      return {
        date: e.date < from ? from : e.date,
        dateTo: end > to ? to : end,
        event: e.title,
        coaches: [...coaches.entries()]
          .map(([memberId, days]) => ({ name: name(memberId), days }))
          .sort((a, b) => byName(a.name, b.name))
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || byName(a.event, b.event));

  return {
    from,
    to,
    rows: activityRows,
    totals: {
      mainTrainer: activityRows.reduce((n, r) => n + r.mainTrainer, 0),
      assistant: activityRows.reduce((n, r) => n + r.assistant, 0),
      coachingDays: activityRows.reduce((n, r) => n + r.coachingDays, 0)
    },
    trainings: trainingRows,
    coaching: coachingRows,
    checks: planChecks(input, name)
  };
}

/**
 * Planned dates up to today that are not cancelled but whose check-in shows
 * no main trainer: held without one marked, or a date the plan has an
 * entry for that nobody checked in. Plain weekly dates without a plan entry
 * and without a check-in are left out (trainings planned only for part of
 * the period, or not held).
 */
function planChecks(input: ReportInput, name: (id: number) => string): CheckRow[] {
  const last = input.to < input.today ? input.to : input.today;
  if (last < input.from) return [];
  const held = new Map(input.held.map((h) => [`${h.trainingId}|${h.date}`, h]));
  const withMain = new Set(
    input.trainerLogs
      .filter((l) => l.trainerRole === 'main_trainer')
      .map((l) => `${l.trainingId}|${l.date}`)
  );
  const checks: CheckRow[] = [];
  for (const r of buildPlan(
    input.plan.trainings,
    input.plan.sessions,
    input.plan.breaks,
    [],
    input.from,
    last
  )) {
    if (r.cancelled) continue;
    const key = `${r.training.id}|${r.date}`;
    if (withMain.has(key)) continue;
    const h = held.get(key);
    const checkedIn = !!h && Number(h.count) > 0;
    if (!checkedIn && !r.session) continue;
    if (!checkedIn && r.trainerId == null) continue;
    checks.push({
      date: r.date,
      training: r.training.title,
      section: r.training.section ?? '',
      plannedTrainer: r.trainerId != null ? name(r.trainerId) : '',
      reason: checkedIn ? 'no_main_trainer' : 'no_checkin'
    });
  }
  return checks;
}

// ----- Downloads -----

export interface ActivityReportLabels {
  title: string;
  period: string;
  summary: string;
  person: string;
  mainTrainer: string;
  assistant: string;
  coachingDays: string;
  total: string;
  trainingsDetail: string;
  date: string;
  training: string;
  section: string;
  mainTrainers: string;
  assistants: string;
  coachingDetail: string;
  event: string;
  coaches: string;
  checks: string;
  checksHint: string;
  plannedTrainer: string;
  reason: string;
  reasons: Record<CheckReason, string>;
  /** "Seite 1 von 3" */
  page: (page: number, pages: number) => string;
  created: string;
}

/** dd.mm.yyyy for a yyyy-mm-dd date */
export function swissDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date;
}

export function periodLabel(from: string, to: string): string {
  return `${swissDate(from)} – ${swissDate(to)}`;
}

/** 1.5 as "1.5", 2 as "2" */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

function dateSpan(from: string, to: string): string {
  return from === to ? swissDate(from) : `${swissDate(from)} – ${swissDate(to)}`;
}

const coachList = (c: CoachingDetailRow) =>
  c.coaches.map((x) => `${x.name} (${formatDays(x.days)})`).join(', ');

/** The report as a PDF: the summary first, then what to check and the details */
export function activityReportPdf(
  report: ActivityReport,
  labels: ActivityReportLabels,
  created: string
): PdfDocument {
  const tables: PdfTable[] = [
    {
      heading: labels.summary,
      columns: [
        { label: labels.person, width: 235 },
        { label: labels.mainTrainer, width: 95, align: 'right' },
        { label: labels.assistant, width: 95, align: 'right' },
        { label: labels.coachingDays, width: 90, align: 'right' }
      ],
      rows: report.rows.map((r) => [
        r.name,
        String(r.mainTrainer),
        String(r.assistant),
        formatDays(r.coachingDays)
      ]),
      footer: [
        labels.total,
        String(report.totals.mainTrainer),
        String(report.totals.assistant),
        formatDays(report.totals.coachingDays)
      ]
    }
  ];
  if (report.checks.length) {
    tables.push({
      heading: labels.checks,
      note: labels.checksHint,
      columns: [
        { label: labels.date, width: 62 },
        { label: labels.training, width: 140 },
        { label: labels.section, width: 75 },
        { label: labels.plannedTrainer, width: 120 },
        { label: labels.reason, width: 118 }
      ],
      rows: report.checks.map((c) => [
        swissDate(c.date),
        c.training,
        c.section,
        c.plannedTrainer,
        labels.reasons[c.reason]
      ])
    });
  }
  tables.push(
    {
      heading: labels.trainingsDetail,
      columns: [
        { label: labels.date, width: 62 },
        { label: labels.training, width: 125 },
        { label: labels.section, width: 68 },
        { label: labels.mainTrainers, width: 120 },
        { label: labels.assistants, width: 140 }
      ],
      rows: report.trainings.map((t) => [
        swissDate(t.date),
        t.training,
        t.section,
        t.mainTrainers.join(', '),
        t.assistants.join(', ')
      ])
    },
    {
      heading: labels.coachingDetail,
      columns: [
        { label: labels.date, width: 115 },
        { label: labels.event, width: 160 },
        { label: labels.coaches, width: 240 }
      ],
      rows: report.coaching.map((c) => [dateSpan(c.date, c.dateTo), c.event, coachList(c)])
    }
  );
  return {
    title: labels.title,
    subtitle: `${labels.period}: ${periodLabel(report.from, report.to)}`,
    footer: `${labels.created} ${created}`,
    pageLabel: labels.page,
    tables
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): string | null {
  return value && DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** The period from ?from=&to= (swapped when reversed), by default the year up to today */
export function reportPeriod(params: URLSearchParams, today: string): { from: string; to: string } {
  let from = validDate(params.get('from')) ?? `${today.slice(0, 4)}-01-01`;
  let to = validDate(params.get('to')) ?? today;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}
