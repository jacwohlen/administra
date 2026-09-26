import dayjs from 'dayjs';

/**
 * Checks if an event date is in the past.
 */
export function isEventPast(eventDate: string): boolean {
  return dayjs(eventDate).isBefore(dayjs(), 'day');
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
 * uses the current time; attendance recorded retroactively for a past event
 * uses the event's date and start time (or noon if no start time is set).
 */
export function attendanceTimestamp(eventDate: string, timeFrom?: string): string {
  if (!isEventPast(eventDate)) return dayjs().toISOString();
  const match = timeFrom?.match(/^(\d{1,2}):(\d{2})/);
  const time = match ? `${match[1].padStart(2, '0')}:${match[2]}` : '12:00';
  return dayjs(`${eventDate}T${time}`).toISOString();
}
