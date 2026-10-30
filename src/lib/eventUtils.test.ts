import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import {
  isEventPast,
  canTrackAttendance,
  isRegistrationOpen,
  calculateAttendanceRate,
  canAddParticipants,
  attendanceTimestamp,
  endsOnOrAfter,
  eventCoversDay,
  eventDateInput,
  eventDateValues,
  eventDays,
  eventEnd,
  eventPhase,
  formatEventDates
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

describe('the days of an event', () => {
  const camp = { date: '2026-11-13', date_to: '2026-11-16' };
  const cup = { date: '2026-11-14', date_to: null };

  it('ends on its last day, or on its day', () => {
    expect(eventEnd(camp)).toBe('2026-11-16');
    expect(eventEnd(cup)).toBe('2026-11-14');
    // An end not after the start is one day (the database refuses it anyway)
    expect(eventEnd({ date: '2026-11-14', date_to: '2026-11-14' })).toBe('2026-11-14');
  });

  it('covers every day from the first to the last', () => {
    expect(
      ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'].map((d) => eventCoversDay(camp, d))
    ).toEqual([false, true, true, false]);
    expect(eventCoversDay(cup, '2026-11-14')).toBe(true);
  });

  it('is under way (today) from its first to its last day, past after it', () => {
    expect(eventPhase(camp, '2026-11-12')).toBe('upcoming');
    expect(eventPhase(camp, '2026-11-13')).toBe('today');
    expect(eventPhase(camp, '2026-11-16')).toBe('today');
    expect(eventPhase(camp, '2026-11-17')).toBe('past');
    expect(eventPhase(cup, '2026-11-14')).toBe('today');
  });

  it('filters by the last day in PostgREST', () => {
    expect(endsOnOrAfter('2026-11-15')).toBe('date.gte.2026-11-15,date_to.gte.2026-11-15');
  });

  it('lists its days within a period, over the year boundary', () => {
    const silvester = { date: '2026-12-30', date_to: '2027-01-02' };
    expect(eventDays(silvester, '2027-01-01', '2027-12-31')).toEqual(['2027-01-01', '2027-01-02']);
    expect(eventDays(silvester, '2026-01-01', '2026-12-31')).toEqual(['2026-12-30', '2026-12-31']);
    expect(eventDays(cup, '2026-01-01', '2026-12-31')).toEqual(['2026-11-14']);
    expect(eventDays(cup, '2027-01-01', '2027-12-31')).toEqual([]);
  });

  it('shows its days as compactly as they read', () => {
    expect(formatEventDates(cup)).toBe('14.11.2026');
    expect(formatEventDates(camp)).toBe('13.–16.11.2026');
    expect(formatEventDates({ date: '2026-11-28', date_to: '2026-12-02' })).toBe(
      '28.11. – 02.12.2026'
    );
    expect(formatEventDates({ date: '2026-12-30', date_to: '2027-01-02' })).toBe(
      '30.12.2026 – 02.01.2027'
    );
  });

  it('is past only after its last day', () => {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    expect(isEventPast(yesterday, tomorrow)).toBe(false);
    expect(isEventPast(yesterday, null)).toBe(true);
  });

  it('takes attendance at the current time on any day of the event', () => {
    const start = dayjs().subtract(2, 'day').format('YYYY-MM-DD');
    const end = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const ts = attendanceTimestamp(start, '09:00', end);
    expect(Math.abs(dayjs(ts).diff(dayjs(), 'second'))).toBeLessThan(5);
  });
});

describe('the event form', () => {
  it('saves a last day only after the first, and no times all day', () => {
    const base = { date: '2026-11-13', dateTo: '', allDay: false, timeFrom: '18:00', timeTo: '' };
    expect(eventDateValues(base)).toEqual({
      date: '2026-11-13',
      date_to: null,
      all_day: false,
      timeFrom: '18:00',
      timeTo: null
    });
    expect(eventDateValues({ ...base, dateTo: '2026-11-13' })).toMatchObject({ date_to: null });
    expect(eventDateValues({ ...base, dateTo: '2026-11-16', allDay: true })).toEqual({
      date: '2026-11-13',
      date_to: '2026-11-16',
      all_day: true,
      timeFrom: null,
      timeTo: null
    });
    expect(eventDateValues({ ...base, dateTo: '2026-11-12' })).toBe('dateToBeforeDate');
  });

  it('checks a start moved onto a locked last day (edit page of a linked event)', () => {
    const linked = {
      date: '2026-11-16',
      dateTo: '2026-11-16',
      allDay: true,
      timeFrom: '',
      timeTo: ''
    };
    // the last day is not sent: the database would keep it, on the start
    expect(eventDateValues(linked, new Set(['date_to']))).toBe('dateToBeforeDate');
    expect(eventDateValues({ ...linked, date: '2026-11-17' }, new Set(['date_to']))).toBe(
      'dateToBeforeDate'
    );
    expect(eventDateValues({ ...linked, date: '2026-11-15' }, new Set(['date_to']))).toMatchObject({
      date: '2026-11-15',
      date_to: '2026-11-16'
    });
    // both locked: the stored days, nothing to refuse
    expect(
      eventDateValues({ ...linked, date: '2026-11-13' }, new Set(['date', 'date_to']))
    ).toMatchObject({ date: '2026-11-13', date_to: '2026-11-16' });
    // unlocked, the same day is one day
    expect(eventDateValues(linked)).toMatchObject({ date_to: null });
  });

  it('fills in a stored event', () => {
    expect(
      eventDateInput({
        date: '2026-11-13',
        date_to: '2026-11-16',
        all_day: true,
        timeFrom: '00:00'
      })
    ).toEqual({ date: '2026-11-13', dateTo: '2026-11-16', allDay: true, timeFrom: '', timeTo: '' });
    // Without all_day: a timed event
    expect(eventDateInput({ date: '2026-11-13', timeFrom: '18:00', timeTo: '20:00' })).toEqual({
      date: '2026-11-13',
      dateTo: '',
      allDay: false,
      timeFrom: '18:00',
      timeTo: '20:00'
    });
  });
});
