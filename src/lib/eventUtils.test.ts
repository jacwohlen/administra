import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import {
  isEventPast,
  canTrackAttendance,
  isRegistrationOpen,
  calculateAttendanceRate
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
