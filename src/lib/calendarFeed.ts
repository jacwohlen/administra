/**
 * The training plan as calendar feeds (ICS) that staff subscribe to in their
 * calendar app, see docs/TRAINING_PLAN.md:
 *
 * - "Meine Trainings": the dates the account's member leads (the planned
 *   trainer, else the training's main trainer), cancelled ones included,
 * - "Alle Trainings": every date of every training in the plan.
 *
 * Calendar apps fetch without cookies, so the address carries a secret token
 * per account: /api/calendar/<token>/<feed>.ics, where the feed name says
 * kind and language. The rows come from buildPlan(), exactly as on the plan
 * page. Cancelled dates stay in, "Fällt aus: " in front and free time, never
 * STATUS:CANCELLED: Google hides such events.
 *
 * Client-safe (no SvelteKit or Supabase imports): the subscribe dialog builds
 * its links with the same helpers the endpoint uses.
 */

import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import { buildPlan, type PlanRow, type PlanTraining } from './trainingPlanUtils';
import {
  ZURICH_TZID,
  ZURICH_VTIMEZONE,
  dateValue,
  escapeText,
  icsFile,
  localDateTime,
  utcDateTime
} from './ics';

export type FeedKind = 'mine' | 'all';
export type FeedLocale = 'de' | 'en';

/** The feed name in the address (before .ics): kind and language */
const FEED_NAMES: Record<FeedLocale, Record<FeedKind, string>> = {
  de: { mine: 'meine', all: 'alle' },
  en: { mine: 'mine', all: 'all' }
};

/** Kind and language of a feed name ("alle", "mine", ...), null for anything else */
export function parseFeedName(name: string): { kind: FeedKind; locale: FeedLocale } | null {
  for (const locale of ['de', 'en'] as const) {
    for (const kind of ['mine', 'all'] as const) {
      if (FEED_NAMES[locale][kind] === name) return { kind, locale };
    }
  }
  return null;
}

/** The feed's address on the app's origin (https), e.g. …/api/calendar/<token>/alle.ics */
export function calendarFeedUrl(
  origin: string,
  token: string,
  kind: FeedKind,
  locale: FeedLocale
): string {
  return `${origin.replace(/\/+$/, '')}/api/calendar/${token}/${FEED_NAMES[locale][kind]}.ics`;
}

/** The same address as webcal://, which opens the calendar app (Apple, Outlook) */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:/i, 'webcal:');
}

/** Google Calendar's subscribe link (undocumented; needs the feed on https) */
export function googleCalendarUrl(httpsUrl: string): string {
  return (
    'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcalUrl(httpsUrl))
  );
}

const zurichDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Today in Europe/Zurich, YYYY-MM-DD (the server runs in UTC) */
export function zurichToday(now: Date): string {
  const parts = Object.fromEntries(zurichDate.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** How far the feeds reach: 8 weeks back, 12 months ahead */
export const FEED_DAYS_BACK = 56;
export const FEED_DAYS_AHEAD = 365;

/** A training of the plan, with its end time */
export interface FeedTraining extends PlanTraining {
  /** End time like dateFrom ("19.30", "19:30"), may be empty */
  dateTo?: string | null;
}

export interface FeedTrainer {
  id: number;
  firstname: string;
  lastname: string;
}

/** What calendar_feed(p_token) returns for a valid token */
export interface CalendarFeedData {
  /** The account's members, as my_member_ids() */
  member_ids: number[];
  /** The trainings in the plan (training_plan_trainings) */
  trainings: FeedTraining[];
  /** Their sessions, from 70 days back to 400 days ahead */
  sessions: TrainingPlanSession[];
  breaks: TrainingPlanBreak[];
  /** Everyone leading a session or main trainer of a planned training */
  trainers: FeedTrainer[];
}

export interface CalendarFeedOptions {
  kind: FeedKind;
  locale: FeedLocale;
  /** The app's origin, for the check-in links and the UIDs */
  origin: string;
  /** From the settings; left out of the calendar name when empty */
  clubName?: string | null;
  now: Date;
}

// Texts of the feed, in the language of its name (like src/lib/trialMail.ts)
const TEXTS = {
  de: {
    mine: 'Meine Trainings',
    all: 'Alle Trainings',
    cancelled: 'Fällt aus: ',
    openTrainer: 'Trainer offen',
    topic: 'Thema',
    trainer: 'Leitung',
    notes: 'Bemerkung',
    holidays: 'Ferien',
    checkIn: 'Check-in'
  },
  en: {
    mine: 'My trainings',
    all: 'All trainings',
    cancelled: 'Cancelled: ',
    openTrainer: 'Trainer open',
    topic: 'Topic',
    trainer: 'Led by',
    notes: 'Note',
    holidays: 'Holidays',
    checkIn: 'Check-in'
  }
} satisfies Record<FeedLocale, Record<string, string>>;

// Without an end time (or a wrong one) a training lasts 90 minutes
const DEFAULT_MINUTES = 90;

/** Minutes after midnight of "18.00" or "18:00" (both occur), null when it is no time */
export function parseTime(value: string | null | undefined): number | null {
  const m = /^(\d{1,2})[.:](\d{2})(?::\d{2})?$/.exec((value ?? '').trim());
  if (!m) return null;
  const [hours, minutes] = [Number(m[1]), Number(m[2])];
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** On one line, for the title */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || 'alleda';
  } catch {
    return 'alleda';
  }
}

interface EventContext {
  kind: FeedKind;
  texts: (typeof TEXTS)[FeedLocale];
  origin: string;
  host: string;
  stamp: string;
  trainers: Map<number, string>;
}

function eventLines(row: PlanRow, ctx: EventContext): string[] {
  const { kind, texts: t } = ctx;
  // buildPlan hands back the training objects it was given
  const training = row.training as FeedTraining;
  const title = oneLine(training.title ?? '');
  const topic = row.session?.topic?.trim() ?? '';
  const notes = row.session?.notes?.trim() ?? '';
  // A dropped date needs nobody to lead it
  const trainer =
    row.trainerId == null
      ? row.cancelled
        ? ''
        : t.openTrainer
      : (ctx.trainers.get(row.trainerId) ?? '');
  const link = `${ctx.origin}/dashboard/trainings/${training.id}/${row.date}`;

  let summary: string;
  if (row.cancelled) {
    // The TK's note when the session itself is dropped, else the break closing the dojo
    const reason =
      (row.session?.cancelled === true && notes) ||
      (row.break?.cancels_training ? row.break.title : '');
    summary = `${t.cancelled}${title}${reason ? ` (${oneLine(reason)})` : ''}`;
  } else {
    summary = topic ? `${title}: ${oneLine(topic)}` : title;
    if (kind === 'all' && trainer) summary += ` – ${trainer}`;
  }

  // The holidays of the date, but not a closed dojo the training is dropped for
  const holidays =
    row.break && !(row.cancelled && row.break.cancels_training) ? row.break.title : '';
  const description = [
    topic && `${t.topic}: ${topic}`,
    trainer && `${t.trainer}: ${trainer}`,
    notes && `${t.notes}: ${notes}`,
    holidays && `${t.holidays}: ${holidays}`,
    `${t.checkIn}: ${link}`
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VEVENT',
    `UID:${kind}-${training.id}-${dateValue(row.date)}@${ctx.host}`,
    `DTSTAMP:${ctx.stamp}`
  ];
  // No LAST-MODIFIED: an event also changes with breaks, the training and
  // names, which have no timestamp, and clients that trust it (ICSx5) would
  // keep a date as held after the dojo closes
  const start = parseTime(training.dateFrom);
  if (start == null) {
    // No start time: all day
    lines.push(
      `DTSTART;VALUE=DATE:${dateValue(row.date)}`,
      `DTEND;VALUE=DATE:${dateValue(row.date, 1)}`
    );
  } else {
    let end = parseTime(training.dateTo);
    if (end == null || end <= start) end = start + DEFAULT_MINUTES;
    lines.push(
      `DTSTART;TZID=${ZURICH_TZID}:${localDateTime(row.date, start)}`,
      `DTEND;TZID=${ZURICH_TZID}:${localDateTime(row.date, end)}`
    );
  }
  lines.push(
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${link}`,
    // Busy only for one's own trainings that take place
    `TRANSP:${kind === 'mine' && !row.cancelled ? 'OPAQUE' : 'TRANSPARENT'}`,
    'END:VEVENT'
  );
  return lines;
}

/**
 * The feed as an .ics file: one event per training date (no RRULE, so trainer,
 * topic and cancellation can differ per date) from FEED_DAYS_BACK days before
 * today (Europe/Zurich) to FEED_DAYS_AHEAD days after it.
 */
export function buildCalendarFeed(data: CalendarFeedData, options: CalendarFeedOptions): string {
  const { kind, locale, now } = options;
  const t = TEXTS[locale];
  const today = zurichToday(now);
  const rows = buildPlan(
    data.trainings ?? [],
    data.sessions ?? [],
    data.breaks ?? [],
    [],
    addDays(today, -FEED_DAYS_BACK),
    addDays(today, FEED_DAYS_AHEAD)
  );
  const mine = new Set(data.member_ids ?? []);
  const origin = options.origin.replace(/\/+$/, '');
  const ctx: EventContext = {
    kind,
    texts: t,
    origin,
    host: hostOf(origin),
    stamp: utcDateTime(now),
    trainers: new Map(
      (data.trainers ?? []).map((m) => [m.id, oneLine(`${m.firstname ?? ''} ${m.lastname ?? ''}`)])
    )
  };
  const club = options.clubName?.trim();
  const name = escapeText(club ? `${t[kind]} (${club})` : t[kind]);

  return icsFile([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Alleda//Trainingsplan//${locale.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${name}`,
    `X-WR-CALNAME:${name}`,
    `X-WR-TIMEZONE:${ZURICH_TZID}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    ...ZURICH_VTIMEZONE,
    ...rows
      .filter((row) => kind === 'all' || (row.trainerId != null && mine.has(row.trainerId)))
      .flatMap((row) => eventLines(row, ctx)),
    'END:VCALENDAR'
  ]);
}
