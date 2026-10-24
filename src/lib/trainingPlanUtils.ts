import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What the plan needs of a training */
export interface PlanTraining {
  id: number;
  title: string;
  weekday: string;
  dateFrom: string;
  section: string;
  mainTrainerId?: number | null;
}

/** An event (Webling Anlass) shown next to the trainings of its date */
export interface PlanEvent {
  id: number;
  title: string;
  date: string;
  section?: string | null;
}

/** One training on one date, with what the TK planned for it */
export interface PlanRow {
  date: string;
  training: PlanTraining;
  session: TrainingPlanSession | null;
  /** The break the date falls into, if any */
  break: TrainingPlanBreak | null;
  /** Whether the training is dropped: the session decides, else the break */
  cancelled: boolean;
  /** Events on the same date */
  events: PlanEvent[];
}

/** The dates (YYYY-MM-DD) a weekly training falls on between from and to, inclusive */
export function trainingDates(weekday: string, from: string, to: string): string[] {
  const day = WEEKDAYS.indexOf(weekday);
  if (day < 0) return [];
  const end = dayjs(to);
  let d = dayjs(from);
  d = d.add((day - d.day() + 7) % 7, 'day');
  const dates: string[] = [];
  while (!d.isAfter(end, 'day')) {
    dates.push(d.format('YYYY-MM-DD'));
    d = d.add(7, 'day');
  }
  return dates;
}

export function breakOn(date: string, breaks: TrainingPlanBreak[]): TrainingPlanBreak | null {
  return breaks.find((b) => b.date_from <= date && date <= b.date_to) ?? null;
}

/** null follows the break, true / false is the TK's explicit choice */
export function isCancelled(
  session: Pick<TrainingPlanSession, 'cancelled'> | null,
  brk: TrainingPlanBreak | null
): boolean {
  return session?.cancelled ?? brk != null;
}

/** "18.00" and "18:00" both occur in trainings."dateFrom" */
function startTime(t: PlanTraining): string {
  return (t.dateFrom ?? '').replace('.', ':').padStart(5, '0');
}

/** Every date of every training between from and to, by date and start time */
export function buildPlan(
  trainings: PlanTraining[],
  sessions: TrainingPlanSession[],
  breaks: TrainingPlanBreak[],
  events: PlanEvent[],
  from: string,
  to: string
): PlanRow[] {
  const sessionMap = new Map(sessions.map((s) => [`${s.training_id}|${s.date}`, s]));
  const eventMap = new Map<string, PlanEvent[]>();
  for (const e of events) {
    const list = eventMap.get(e.date) ?? [];
    list.push(e);
    eventMap.set(e.date, list);
  }

  const rows: PlanRow[] = [];
  for (const training of trainings) {
    for (const date of trainingDates(training.weekday, from, to)) {
      const session = sessionMap.get(`${training.id}|${date}`) ?? null;
      const brk = breakOn(date, breaks);
      rows.push({
        date,
        training,
        session,
        break: brk,
        cancelled: isCancelled(session, brk),
        events: eventMap.get(date) ?? []
      });
    }
  }
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      startTime(a.training).localeCompare(startTime(b.training)) ||
      a.training.title.localeCompare(b.training.title)
  );
}

/** A position in a trainer rotation */
export type RotationSlot =
  | { kind: 'trainer'; memberId: number }
  /** Takes place, trainer still open */
  | { kind: 'open' }
  /** No training that week (e.g. Friday only every other week) */
  | { kind: 'none' };

export interface RotationOptions {
  /** How many consecutive dates each slot covers (1 = changes every time) */
  perSlot: number;
  /**
   * true: dropped dates (holidays) do not count, the next one continues the
   * rotation; false: the rotation follows the calendar weeks
   */
  skipCancelled: boolean;
}

/**
 * Which slot each date of one training gets. Dropped dates get none and stay
 * as they are. The first date of the list starts with the first slot.
 */
export function rotate(
  rows: { date: string; cancelled: boolean }[],
  slots: RotationSlot[],
  { perSlot, skipCancelled }: RotationOptions
): { date: string; slot: RotationSlot }[] {
  if (slots.length === 0 || rows.length === 0) return [];
  const per = Math.max(1, Math.floor(perSlot));
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const first = dayjs(sorted[0].date);
  const result: { date: string; slot: RotationSlot }[] = [];
  let held = 0;
  for (const row of sorted) {
    if (row.cancelled) continue;
    const step = skipCancelled ? held : Math.round(dayjs(row.date).diff(first, 'day') / 7);
    held++;
    result.push({ date: row.date, slot: slots[Math.floor(step / per) % slots.length] });
  }
  return result;
}

/** The session columns a rotation slot sets */
export function slotPatch(
  slot: RotationSlot
): Pick<TrainingPlanSession, 'trainer_id' | 'cancelled'> {
  if (slot.kind === 'trainer') return { trainer_id: slot.memberId, cancelled: null };
  if (slot.kind === 'none') return { trainer_id: null, cancelled: true };
  return { trainer_id: null, cancelled: null };
}

/** Whether the TK already decided something for the session a rotation would change */
export function hasAssignment(session: TrainingPlanSession | null): boolean {
  return session != null && (session.trainer_id != null || session.cancelled != null);
}

/** Topics used so far, offered as suggestions */
export function planTopics(sessions: Pick<TrainingPlanSession, 'topic'>[]): string[] {
  const topics = new Set<string>();
  for (const s of sessions) {
    const t = s.topic?.trim();
    if (t) topics.add(t);
  }
  return [...topics].sort((a, b) => a.localeCompare(b));
}

/** How many held sessions each trainer leads in the rows */
export function trainerCounts(rows: PlanRow[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const r of rows) {
    const id = r.session?.trainer_id;
    if (r.cancelled || id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
