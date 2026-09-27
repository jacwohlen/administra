import dayjs, { type Dayjs } from 'dayjs';

/** Days since the last training up to which a member counts as active / paused */
export const ACTIVE_DAYS = 14;
export const PAUSED_DAYS = 60;

export type ActivityStatus = 'active' | 'paused' | 'inactive';

export interface ActivityDay {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  /** After today: rendered as an empty slot */
  future: boolean;
}

export interface ActivityWeek {
  /** Monday to Sunday */
  days: ActivityDay[];
  /** Month (0-11) that starts in this week, for the label row */
  monthStart: number | null;
}

export interface ActivitySummary {
  weeks: ActivityWeek[];
  status: ActivityStatus;
  lastDate: string | null;
  /** Days between the last training and today, null without any */
  daysSince: number | null;
  last30: number;
  /** Average trainings per week since the member's first training in the window */
  perWeek: number;
}

export function activityStatus(daysSince: number | null): ActivityStatus {
  if (daysSince === null) return 'inactive';
  if (daysSince <= ACTIVE_DAYS) return 'active';
  if (daysSince <= PAUSED_DAYS) return 'paused';
  return 'inactive';
}

/** First day shown by buildActivity: the Monday `weekCount - 1` weeks before this week's. */
export function activityStart(today: Dayjs = dayjs(), weekCount = 53): Dayjs {
  const t = today.startOf('day');
  const monday = t.subtract((t.day() + 6) % 7, 'day');
  return monday.subtract(weekCount - 1, 'week');
}

/**
 * GitHub-style activity grid (one column per week, Monday first) for the
 * last `weekCount` weeks, plus the figures shown next to it.
 * `dates` are attendance dates (YYYY-MM-DD…), one entry per training.
 */
export function buildActivity(
  dates: string[],
  today: Dayjs = dayjs(),
  weekCount = 53
): ActivitySummary {
  const t = today.startOf('day');
  const start = activityStart(t, weekCount);
  const todayKey = t.format('YYYY-MM-DD');
  const startKey = start.format('YYYY-MM-DD');

  const counts = new Map<string, number>();
  for (const raw of dates) {
    const key = raw.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const weeks: ActivityWeek[] = [];
  for (let w = 0; w < weekCount; w++) {
    const days: ActivityDay[] = [];
    let monthStart: number | null = null;
    for (let d = 0; d < 7; d++) {
      const day = start.add(w * 7 + d, 'day');
      const key = day.format('YYYY-MM-DD');
      if (day.date() === 1 && w > 0) monthStart = day.month();
      days.push({ date: key, count: counts.get(key) ?? 0, future: key > todayKey });
    }
    weeks.push({ days, monthStart });
  }

  const past = [...counts.keys()].filter((k) => k <= todayKey).sort();
  const lastDate = past.at(-1) ?? null;
  const daysSince = lastDate ? t.diff(dayjs(lastDate), 'day') : null;

  const last30From = t.subtract(29, 'day').format('YYYY-MM-DD');
  let last30 = 0;
  let total = 0;
  let first: string | null = null;
  for (const key of past) {
    const n = counts.get(key) ?? 0;
    if (key >= last30From) last30 += n;
    if (key >= startKey) {
      total += n;
      first ??= key;
    }
  }
  const spanWeeks = first ? Math.min(weekCount, t.diff(dayjs(first), 'week') + 1) : 1;

  return {
    weeks,
    status: activityStatus(daysSince),
    lastDate,
    daysSince,
    last30,
    perWeek: total / spanWeeks
  };
}

export interface TrainingAttendance {
  id: string;
  title: string;
  weekday: string;
  section: string;
  attended: number;
  asTrainer: number;
  total: number;
}

interface LogLike {
  trainingId: { id: string; title: string; weekday: string; section: string };
  trainerRole?: string | null;
}

/** Attendance per training, most attended first (profile "Trainings Übersicht"). */
export function attendanceByTraining(logs: LogLike[]): TrainingAttendance[] {
  const byId = new Map<string, TrainingAttendance>();
  for (const log of logs) {
    const t = log.trainingId;
    if (!t) continue;
    const row = byId.get(t.id) ?? {
      id: t.id,
      title: t.title,
      weekday: t.weekday,
      section: t.section,
      attended: 0,
      asTrainer: 0,
      total: 0
    };
    if (log.trainerRole === 'main_trainer' || log.trainerRole === 'assistant') row.asTrainer++;
    else row.attended++;
    row.total++;
    byId.set(t.id, row);
  }
  return [...byId.values()].sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
}
