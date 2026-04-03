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
