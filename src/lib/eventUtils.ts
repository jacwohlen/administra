import dayjs from 'dayjs';
import { isMissingSchemaError } from './eventLinks';

// ----- Days of an event -----

/** What the date helpers need of an event */
export interface EventSpan {
  /** First day, YYYY-MM-DD */
  date: string;
  /** Last day of a multi-day event (inclusive), null or missing for one day */
  date_to?: string | null;
}

/** The last day of an event: date_to, or the day itself. */
export function eventEnd(event: EventSpan): string {
  return event.date_to && event.date_to > event.date ? event.date_to : event.date;
}

/** Whether the event takes place on the day (YYYY-MM-DD): first day <= day <= last day. */
export function eventCoversDay(event: EventSpan, day: string): boolean {
  return event.date <= day && day <= eventEnd(event);
}

export type EventPhase = 'past' | 'today' | 'upcoming';

/** Upcoming before its first day, today (ongoing) up to its last day, past after it. */
export function eventPhase(event: EventSpan, today: string): EventPhase {
  if (eventEnd(event) < today) return 'past';
  return event.date <= today ? 'today' : 'upcoming';
}

/**
 * PostgREST `or` filter for events not over before `day`:
 * coalesce(date_to, date) >= day. date_to is after date whenever it is
 * set (events_date_to_check), so `date >= day OR date_to >= day` says the
 * same. With `.lte('date', day)` it gives the events on that day.
 */
export function endsOnOrAfter(day: string): string {
  return `date.gte.${day},date_to.gte.${day}`;
}

/** The days an event covers between from and to (inclusive), as YYYY-MM-DD. */
export function eventDays(event: EventSpan, from: string, to: string): string[] {
  const last = eventEnd(event) < to ? eventEnd(event) : to;
  const days: string[] = [];
  let d = dayjs(event.date < from ? from : event.date);
  while (d.format('YYYY-MM-DD') <= last) {
    days.push(d.format('YYYY-MM-DD'));
    d = d.add(1, 'day');
  }
  return days;
}

/**
 * The days of an event as shown: 14.11.2026, 14.–16.11.2026,
 * 28.11. – 02.12.2026, 30.12.2026 – 02.01.2027.
 */
export function formatEventDates(event: EventSpan): string {
  const first = dayjs(event.date);
  const end = eventEnd(event);
  if (end === event.date) return first.format('DD.MM.YYYY');
  const last = dayjs(end);
  if (first.year() !== last.year()) {
    return `${first.format('DD.MM.YYYY')} – ${last.format('DD.MM.YYYY')}`;
  }
  if (first.month() !== last.month()) {
    return `${first.format('DD.MM.')} – ${last.format('DD.MM.YYYY')}`;
  }
  return `${first.format('DD.')}–${last.format('DD.MM.YYYY')}`;
}

/**
 * Checks if an event is over: its last day (dateTo, else the date) is
 * before today.
 */
export function isEventPast(eventDate: string, dateTo?: string | null): boolean {
  return dayjs(eventEnd({ date: eventDate, date_to: dateTo })).isBefore(dayjs(), 'day');
}

/**
 * Checks if attendance can be tracked (event day or after).
 */
export function canTrackAttendance(eventDate: string): boolean {
  const d = dayjs(eventDate);
  const today = dayjs();
  return d.isSame(today, 'day') || d.isBefore(today, 'day');
}

/**
 * Checks if registration is still open based on the deadline.
 * Returns true if no deadline is set.
 */
export function isRegistrationOpen(deadline: string | undefined): boolean {
  if (!deadline) return true;
  return dayjs().isBefore(dayjs(deadline));
}

/**
 * Calculates attendance rate as a percentage.
 */
export function calculateAttendanceRate(registered: number, attended: number): number {
  if (registered <= 0) return 0;
  return Math.round((attended / registered) * 100);
}

/**
 * Checks if participants can be added to an event. Upcoming events follow the
 * registration rules (deadline, max participants). From the event day on,
 * writers (trainers/admins) can always add participants so that attendance
 * can be recorded retroactively.
 */
export function canAddParticipants(
  event: { date: string; registrationDeadline?: string; maxParticipants?: number },
  registeredCount: number,
  isWriter: boolean
): boolean {
  if (!isWriter) return false;
  if (canTrackAttendance(event.date)) return true;
  return (
    isRegistrationOpen(event.registrationDeadline) &&
    (!event.maxParticipants || registeredCount < event.maxParticipants)
  );
}

/**
 * Timestamp to store as attendance time. Attendance recorded on the event day
 * (any day of a multi-day event) uses the current time; attendance recorded
 * retroactively for a past event uses the event's date and start time (or
 * noon if no start time is set).
 */
export function attendanceTimestamp(
  eventDate: string,
  timeFrom?: string | null,
  dateTo?: string | null
): string {
  if (!isEventPast(eventDate, dateTo)) return dayjs().toISOString();
  const match = timeFrom?.match(/^(\d{1,2}):(\d{2})/);
  const time = match ? `${match[1].padStart(2, '0')}:${match[2]}` : '12:00';
  return dayjs(`${eventDate}T${time}`).toISOString();
}

// ----- The event form -----

/** The date fields of the event form */
export interface EventDateInput {
  /** YYYY-MM-DD */
  date: string;
  /** Last day, '' for one day */
  dateTo: string;
  allDay: boolean;
  /** HH:MM or '' */
  timeFrom: string;
  timeTo: string;
}

/** The date columns the form saves */
export interface EventDateValues {
  date: string;
  date_to: string | null;
  all_day: boolean;
  timeFrom: string | null;
  timeTo: string | null;
}

/**
 * The date columns of the form, or 'dateToBeforeDate' when the last day is
 * before the first. A last day equal to the first is one day (no date_to,
 * which the database wants after the date); all day drops the times.
 * `locked`: fields the edit page does not send (lockedEventFields); a
 * locked last day stays as stored, so a start moved onto it is refused too.
 */
export function eventDateValues(
  input: EventDateInput,
  locked: ReadonlySet<string> = new Set()
): EventDateValues | 'dateToBeforeDate' {
  if (input.dateTo && input.dateTo < input.date) return 'dateToBeforeDate';
  if (input.dateTo && input.dateTo === input.date && locked.has('date_to')) {
    return 'dateToBeforeDate';
  }
  return {
    date: input.date,
    date_to: input.dateTo && input.dateTo > input.date ? input.dateTo : null,
    all_day: input.allDay,
    timeFrom: input.allDay ? null : input.timeFrom || null,
    timeTo: input.allDay ? null : input.timeTo || null
  };
}

/** The form's fields for a stored event */
export function eventDateInput(
  event: EventSpan & {
    all_day?: boolean | null;
    timeFrom?: string | null;
    timeTo?: string | null;
  }
): EventDateInput {
  const allDay = event.all_day === true;
  return {
    date: event.date,
    dateTo: event.date_to && event.date_to > event.date ? event.date_to : '',
    allDay,
    timeFrom: allDay ? '' : (event.timeFrom ?? ''),
    timeTo: allDay ? '' : (event.timeTo ?? '')
  };
}

type SaveResult = { error: { code?: string; message?: string } | null };

/**
 * Inserts or updates an event row. A database without events.all_day
 * (Netlify may deploy the app before the promotion that adds the column)
 * refuses the column (PGRST204): the row is saved again without it, an
 * all-day event then simply has no times. A database without date_to
 * (phase 2) still refuses the save (docs/INTEGRATIONS.md, deploy order).
 */
export async function saveEventRow<V extends { all_day?: boolean }, R extends SaveResult>(
  values: V,
  save: (values: V | Omit<V, 'all_day'>) => PromiseLike<R>
): Promise<R> {
  const result = await save(values);
  if (
    result.error &&
    'all_day' in values &&
    isMissingSchemaError(result.error) &&
    (result.error.message ?? '').includes('all_day')
  ) {
    const rest: Partial<V> = { ...values };
    delete rest.all_day;
    return save(rest as Omit<V, 'all_day'>);
  }
  return result;
}
