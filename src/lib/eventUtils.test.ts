import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import {
  isEventPast,
  canTrackAttendance,
  isRegistrationOpen,
  calculateAttendanceRate,
  canAddParticipants,
  attendanceTimestamp
} from './eventUtils';

describe('isEventPast', () => {
  it('returns true for yesterday', () => {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    expect(isEventPast(yesterday)).toBe(true);
  });

  it('returns false for today', () => {
    const today = dayjs().format('YYYY-MM-DD');
    expect(isEventPast(today)).toBe(false);
  });

  it('returns false for tomorrow', () => {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    expect(isEventPast(tomorrow)).toBe(false);
  });

  it('returns true for a date far in the past', () => {
    expect(isEventPast('2020-01-01')).toBe(true);
  });
});

describe('canTrackAttendance', () => {
  it('returns true for today', () => {
    const today = dayjs().format('YYYY-MM-DD');
    expect(canTrackAttendance(today)).toBe(true);
  });

  it('returns true for past dates', () => {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    expect(canTrackAttendance(yesterday)).toBe(true);
  });

  it('returns false for future dates', () => {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    expect(canTrackAttendance(tomorrow)).toBe(false);
  });
});

describe('isRegistrationOpen', () => {
  it('returns true when no deadline is set', () => {
    expect(isRegistrationOpen(undefined)).toBe(true);
  });

  it('returns true when deadline is in the future', () => {
    const future = dayjs().add(7, 'day').format('YYYY-MM-DD');
    expect(isRegistrationOpen(future)).toBe(true);
  });

  it('returns false when deadline has passed', () => {
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    expect(isRegistrationOpen(past)).toBe(false);
  });
});

describe('calculateAttendanceRate', () => {
  it('returns 0 when no registrations', () => {
    expect(calculateAttendanceRate(0, 0)).toBe(0);
  });

  it('returns 100 when all attended', () => {
    expect(calculateAttendanceRate(10, 10)).toBe(100);
  });

  it('returns 50 when half attended', () => {
    expect(calculateAttendanceRate(10, 5)).toBe(50);
  });

  it('rounds to nearest integer', () => {
    expect(calculateAttendanceRate(3, 1)).toBe(33);
    expect(calculateAttendanceRate(3, 2)).toBe(67);
  });

  it('returns 0 for negative registered count', () => {
    expect(calculateAttendanceRate(-1, 5)).toBe(0);
  });
});

describe('canAddParticipants', () => {
  const past = { date: '2020-01-01', registrationDeadline: '2019-12-01', maxParticipants: 1 };
  const future = dayjs().add(10, 'day').format('YYYY-MM-DD');

  it('lets writers add participants to past events regardless of deadline or limit', () => {
    expect(canAddParticipants(past, 5, true)).toBe(true);
  });

  it('lets writers add participants on the event day', () => {
    const today = dayjs().format('YYYY-MM-DD');
    expect(canAddParticipants({ date: today, registrationDeadline: '2020-01-01' }, 0, true)).toBe(
      true
    );
  });

  it('never lets viewers add participants', () => {
    expect(canAddParticipants(past, 0, false)).toBe(false);
    expect(canAddParticipants({ date: future }, 0, false)).toBe(false);
  });

  it('respects registration deadline and limit for upcoming events', () => {
    expect(canAddParticipants({ date: future }, 0, true)).toBe(true);
    expect(canAddParticipants({ date: future, registrationDeadline: '2020-01-01' }, 0, true)).toBe(
      false
    );
    expect(canAddParticipants({ date: future, maxParticipants: 2 }, 2, true)).toBe(false);
  });
});

describe('attendanceTimestamp', () => {
  it('uses the event date and start time for past events', () => {
    const ts = attendanceTimestamp('2025-03-15', '9:30');
    expect(dayjs(ts).format('YYYY-MM-DD HH:mm')).toBe('2025-03-15 09:30');
  });

  it('falls back to noon for past events without start time', () => {
    const ts = attendanceTimestamp('2025-03-15');
    expect(dayjs(ts).format('YYYY-MM-DD HH:mm')).toBe('2025-03-15 12:00');
  });

  it('uses the current time on the event day', () => {
    const today = dayjs().format('YYYY-MM-DD');
    const ts = attendanceTimestamp(today, '08:00');
    expect(Math.abs(dayjs(ts).diff(dayjs(), 'second'))).toBeLessThan(5);
  });
});
