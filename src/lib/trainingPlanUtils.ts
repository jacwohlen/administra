import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import { eventDays } from './eventUtils';

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

/** An event (Webling Anlass) shown next to the trainings of its dates */
export interface PlanEvent {
  id: number;
  title: string;
  date: string;
  /** Last day of a multi-day event (inclusive) */
  date_to?: string | null;
  section?: string | null;
}

/** One training on one date, with what the TK planned for it */
export interface PlanRow {
  date: string;
  training: PlanTraining;
  session: TrainingPlanSession | null;
  /** The break the date falls into, if any (one closing the dojo first) */
  break: TrainingPlanBreak | null;
  /** Whether the training is dropped: the session decides, else the break */
  cancelled: boolean;
  /** Who leads: the planned trainer, else the training's main trainer */
  trainerId: number | null;
  /** trainerId is the training's main trainer, not planned for the date */
  defaultTrainer: boolean;
  /** Events on the date (one-day ones, and multi-day ones under way) */
  events: PlanEvent[];
}

/** A row's key: two trainings can fall on the same date (Friday's kids and adults) */
export function planKey(row: { training: { id: number }; date: string }): string {
  return `${row.training.id}|${row.date}`;
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

/**
 * The break a date falls into; one closing the dojo wins over holidays the
 * adults train through (Karfreitag within the Frühlingsferien)
 */
export function breakOn(date: string, breaks: TrainingPlanBreak[]): TrainingPlanBreak | null {
  const on = breaks.filter((b) => b.date_from <= date && date <= b.date_to);
  return on.find((b) => b.cancels_training) ?? on[0] ?? null;
}

/** null follows the break, true / false is the TK's explicit choice */
export function isCancelled(
  session: Pick<TrainingPlanSession, 'cancelled'> | null,
  brk: Pick<TrainingPlanBreak, 'cancels_training'> | null
): boolean {
  return session?.cancelled ?? brk?.cancels_training ?? false;
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
    for (const day of eventDays(e, from, to)) {
      const list = eventMap.get(day) ?? [];
      list.push(e);
      eventMap.set(day, list);
    }
  }

  const rows: PlanRow[] = [];
  for (const training of trainings) {
    for (const date of trainingDates(training.weekday, from, to)) {
      const session = sessionMap.get(`${training.id}|${date}`) ?? null;
      const brk = breakOn(date, breaks);
      const planned = session?.trainer_id ?? null;
      rows.push({
        date,
        training,
        session,
        break: brk,
        cancelled: isCancelled(session, brk),
        trainerId: planned ?? training.mainTrainerId ?? null,
        defaultTrainer: planned == null && training.mainTrainerId != null,
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
 * Which slot each date of one training gets: trainers, or topics. Dropped
 * dates get none and stay as they are. The first date of the list starts with
 * the first slot; part counts the dates within a slot (Teil 1, Teil 2).
 */
export function rotate<T>(
  rows: { date: string; cancelled: boolean }[],
  slots: T[],
  { perSlot, skipCancelled }: RotationOptions
): { date: string; slot: T; part: number }[] {
  if (slots.length === 0 || rows.length === 0) return [];
  const per = Math.max(1, Math.floor(perSlot));
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const first = dayjs(sorted[0].date);
  const result: { date: string; slot: T; part: number }[] = [];
  let held = 0;
  for (const row of sorted) {
    if (row.cancelled) continue;
    const step = skipCancelled ? held : Math.round(dayjs(row.date).diff(first, 'day') / 7);
    held++;
    result.push({
      date: row.date,
      slot: slots[Math.floor(step / per) % slots.length],
      part: (step % per) + 1
    });
  }
  return result;
}

/** A topic of a topic rotation, numbered when it runs over several dates */
export function topicLabel(topic: string, part: number, perSlot: number, numbered: boolean) {
  return numbered && perSlot > 1 ? `${topic}, Teil ${part}` : topic;
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
    const id = r.trainerId;
    if (r.cancelled || id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Training ids as the browser keeps them ("27,23"); anything else is left out */
export function parseTrainingIds(value: string | null): number[] {
  return (value ?? '')
    .split(',')
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

/**
 * The trainings picked for the table, in the order of the trainings: ids no
 * longer planned are left out, and with none left it is the first training
 */
export function pickedTrainings<T extends { id: number }>(ids: number[], trainings: T[]): T[] {
  const picked = trainings.filter((t) => ids.includes(t.id));
  return picked.length > 0 ? picked : trainings.slice(0, 1);
}

/** Picks a training for the table or drops it again, but never the last one */
export function togglePicked(ids: number[], id: number): number[] {
  if (!ids.includes(id)) return [...ids, id];
  return ids.length > 1 ? ids.filter((i) => i !== id) : ids;
}
