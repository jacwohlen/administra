/**
 * CSV files for the J+S import of the Nationale Datenbank Sport (NDS).
 *
 * J+S offers no API for youth courses (Jugendausbildung), only CSV uploads
 * in the NDS, in this order: persons, activities, attendance (AWK). The
 * formats follow BASPO's templates and instructions, see docs/JS_EXPORT.md:
 *   - semicolon separated, UTF-8 with BOM, header row exactly as given
 *   - dates DD.MM.YYYY, times HH:MM, durations in minutes from a fixed list
 *
 * Importing activities replaces all activities (and their attendance) of
 * the course, importing attendance replaces all attendance. So the files
 * always cover the whole course, never just the latest weeks.
 */

import type { TrainerRole } from './models';

export const ACTIVITY_HEADER = ['AKTIVITAETSTYP', 'DATUM', 'ZEIT', 'DAUER', 'ORT', 'FOKUS'];
// The template spells this column with an umlaut, the PDF without; the NDS
// accepts the template.
export const ATTENDANCE_HEADER = [
  'PERSONENNUMMER',
  'FUNKTION',
  'DATUM',
  'AKTIVITÄTSTYP',
  'ZEIT',
  'DAUER',
  'ORT'
];
export const PERSON_HEADER = [
  'PERSONENNUMMER',
  'NAME',
  'VORNAME',
  'GEBURTSDATUM',
  'GESCHLECHT',
  'AHV_NR',
  'PEID',
  'NATIONALITAET',
  'MUTTERSPRACHE',
  'STRASSE',
  'HAUSNUMMER',
  'PLZ',
  'ORT',
  'LAND'
];

/** Training durations NG 1 allows for sports under Art. 1 Abs. 1 (Judo, Aikido). */
export const DEFAULT_DURATIONS = [60, 75, 90];

export interface JsCourse {
  id: number;
  course_number: string;
  title: string;
  date_from: string;
  date_to: string;
  location: string;
  durations: number[];
  /** Embedded where loaded with `js_course_trainings(training_id)`. */
  js_course_trainings?: { training_id: number }[];
}

export interface CourseTraining {
  id: number;
  title: string;
  /** Start time, 'HH:MM' (old rows: 'HH.MM'). */
  dateFrom: string;
  /** End time, may be empty. */
  dateTo?: string | null;
}

export interface CourseLog {
  date: string;
  trainingId: number;
  memberId: number;
  trainerRole: TrainerRole;
}

export interface CourseMember {
  id: number;
  firstname: string;
  lastname: string;
  /** Lizenznummer, the J+S person number (PERSONENNUMMER) */
  license_number?: string | null;
  /** 'YYYY-MM-DD' */
  birthday?: string | null;
}

export type JsFunction = 'Leiter/in' | 'Teilnehmer/in';

export interface Activity {
  trainingId: number;
  date: string;
  time: string;
  duration: number;
}

export interface ExportWarnings {
  /** Trainings without a valid start or end time: their sessions are left out. */
  trainingsWithoutTime: CourseTraining[];
  /** Trainings shorter than the shortest allowed duration: left out. */
  trainingsTooShort: { training: CourseTraining; minutes: number }[];
  /** Trainings whose length is not an allowed value: exported shortened. */
  trainingsShortened: { training: CourseTraining; minutes: number; exported: number }[];
  /** Attended, but no J+S person number: missing from the attendance file. */
  membersWithoutNumber: CourseMember[];
  /** Logged both as trainer and as attendee in this course. */
  membersInBothRoles: CourseMember[];
}

export interface CourseExport {
  activities: Activity[];
  attendance: { member: CourseMember; activity: Activity; role: JsFunction }[];
  leaders: CourseMember[];
  participants: CourseMember[];
  warnings: ExportWarnings;
}

/** '18:30' or '18.30' → minutes after midnight; null when unreadable. */
export function parseTime(value: string | null | undefined): number | null {
  const match = /^\s*(\d{1,2})[:.](\d{2})/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** '2026-03-05' → '05.03.2026'. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * The duration to report for a training of `minutes`: the longest allowed
 * value that fits, so nothing is claimed that did not take place. Null when
 * even the shortest allowed value is longer than the training.
 */
export function allowedDuration(minutes: number, allowed: number[]): number | null {
  const fitting = allowed.filter((d) => d <= minutes);
  return fitting.length ? Math.max(...fitting) : null;
}

/** Parses '60, 75, 90' into [60, 75, 90]; ignores anything that is not a positive number. */
export function parseDurations(value: string): number[] {
  const numbers = value
    .split(/[\s,;]+/)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

const byName = (a: CourseMember, b: CourseMember) =>
  a.lastname.localeCompare(b.lastname, 'de') || a.firstname.localeCompare(b.firstname, 'de');

/**
 * Activities and attendance of a course from the attendance logs of its
 * trainings. `logs` must already be limited to the course's trainings and
 * date range.
 */
export function buildCourseExport(
  course: Pick<JsCourse, 'durations'>,
  trainings: CourseTraining[],
  logs: CourseLog[],
  members: CourseMember[]
): CourseExport {
  const warnings: ExportWarnings = {
    trainingsWithoutTime: [],
    trainingsTooShort: [],
    trainingsShortened: [],
    membersWithoutNumber: [],
    membersInBothRoles: []
  };

  // Start time and reportable duration per training
  const slots = new Map<number, { time: string; duration: number }>();
  for (const training of trainings) {
    const start = parseTime(training.dateFrom);
    const end = parseTime(training.dateTo);
    if (start === null || end === null || end <= start) {
      warnings.trainingsWithoutTime.push(training);
      continue;
    }
    const minutes = end - start;
    const duration = allowedDuration(minutes, course.durations);
    if (duration === null) {
      warnings.trainingsTooShort.push({ training, minutes });
      continue;
    }
    if (duration !== minutes) {
      warnings.trainingsShortened.push({ training, minutes, exported: duration });
    }
    slots.set(training.id, { time: formatTime(start), duration });
  }

  const memberById = new Map(members.map((m) => [m.id, m]));
  const activities = new Map<string, Activity>();
  const attendance: CourseExport['attendance'] = [];
  const withoutNumber = new Set<number>();

  for (const log of logs) {
    const slot = slots.get(log.trainingId);
    const member = memberById.get(log.memberId);
    if (!slot || !member) continue;

    const key = `${log.date}|${log.trainingId}`;
    let activity = activities.get(key);
    if (!activity) {
      activity = { trainingId: log.trainingId, date: log.date, ...slot };
      activities.set(key, activity);
    }

    const role = jsFunction(log.trainerRole);
    if (!member.license_number) {
      withoutNumber.add(member.id);
      continue;
    }
    attendance.push({ member, activity, role });
  }

  const sortedActivities = [...activities.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
  );
  attendance.sort(
    (a, b) =>
      a.activity.date.localeCompare(b.activity.date) ||
      a.activity.time.localeCompare(b.activity.time) ||
      byName(a.member, b.member)
  );

  const { leaders, participants } = courseRoles(logs, members);
  const leaderIds = new Set(leaders.map((m) => m.id));
  warnings.membersWithoutNumber = [...withoutNumber].map((id) => memberById.get(id)!).sort(byName);
  warnings.membersInBothRoles = participants.filter((m) => leaderIds.has(m.id));

  return { activities: sortedActivities, attendance, leaders, participants, warnings };
}

export function jsFunction(role: TrainerRole): JsFunction {
  return role === 'attendee' ? 'Teilnehmer/in' : 'Leiter/in';
}

/**
 * Who led (main trainer or assistant) and who attended trainings of the
 * course, by name. Someone can be in both lists.
 */
export function courseRoles(
  logs: CourseLog[],
  members: CourseMember[]
): { leaders: CourseMember[]; participants: CourseMember[] } {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const leaders = new Set<CourseMember>();
  const participants = new Set<CourseMember>();
  for (const log of logs) {
    const member = memberById.get(log.memberId);
    if (!member) continue;
    (jsFunction(log.trainerRole) === 'Leiter/in' ? leaders : participants).add(member);
  }
  return { leaders: [...leaders].sort(byName), participants: [...participants].sort(byName) };
}

export function activityRows(activities: Activity[], location: string): string[][] {
  return activities.map((a) => [
    'Training',
    formatDate(a.date),
    a.time,
    String(a.duration),
    location,
    ''
  ]);
}

export function attendanceRows(
  attendance: CourseExport['attendance'],
  location: string
): string[][] {
  return attendance.map(({ member, activity, role }) => [
    member.license_number ?? '',
    role,
    formatDate(activity.date),
    'Training',
    activity.time,
    String(activity.duration),
    location
  ]);
}

/**
 * Rows of the person import from what Alleda has: licence number, name and
 * birthday. The NDS finds persons already linked to the club by these
 * (number, or name and birthday); a person new to the club needs an AHV
 * number, which Alleda does not keep: enter them in the NDS directly.
 */
export function personRows(members: CourseMember[]): string[][] {
  return members.map((m) =>
    PERSON_HEADER.map((column) => {
      switch (column) {
        case 'PERSONENNUMMER':
          return (m.license_number ?? '').replace(/\D/g, '');
        case 'NAME':
          return m.lastname;
        case 'VORNAME':
          return m.firstname;
        case 'GEBURTSDATUM':
          return /^\d{4}-\d{2}-\d{2}/.test(m.birthday ?? '') ? formatDate(m.birthday!) : '';
        default:
          return '';
      }
    })
  );
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Semicolon separated, CRLF, with BOM: what the NDS expects from Excel. */
export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** File name part from a course: 'Judo Jugend 2026' → 'judo-jugend-2026'. */
export function fileSlug(course: Pick<JsCourse, 'title' | 'course_number'>): string {
  const base = course.course_number || course.title;
  return (
    base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'kurs'
  );
}
