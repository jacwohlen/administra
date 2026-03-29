import { describe, it, expect } from 'vitest';
import utils, { Weekday } from './utils';

describe('weekdayToNumber', () => {
  it('maps Sunday to 0', () => {
    expect(utils.weekdayToNumber('Sunday')).toBe(0);
  });

  it('maps Monday to 1', () => {
    expect(utils.weekdayToNumber('Monday')).toBe(1);
  });

  it('maps Saturday to 6', () => {
    expect(utils.weekdayToNumber('Saturday')).toBe(6);
  });

  it('maps all weekdays correctly', () => {
    const expected: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(utils.weekdayToNumber(name)).toBe(value);
    }
  });
});

describe('Weekday enum', () => {
  it('has correct numeric values', () => {
    expect(Weekday.Sunday).toBe(0);
    expect(Weekday.Monday).toBe(1);
    expect(Weekday.Tuesday).toBe(2);
    expect(Weekday.Wednesday).toBe(3);
    expect(Weekday.Thursday).toBe(4);
    expect(Weekday.Friday).toBe(5);
    expect(Weekday.Saturday).toBe(6);
  });
});

describe('getMostRecentDateByWeekday', () => {
  it('returns a date that is not in the future', () => {
    const today = new Date();
    for (let weekday = 0; weekday <= 6; weekday++) {
      const result = utils.getMostRecentDateByWeekday(weekday);
      expect(result.toDate().getTime()).toBeLessThanOrEqual(today.getTime() + 86400000);
    }
  });

  it('returns a date within the last 7 days', () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    for (let weekday = 0; weekday <= 6; weekday++) {
      const result = utils.getMostRecentDateByWeekday(weekday);
      expect(result.toDate().getTime()).toBeGreaterThanOrEqual(sevenDaysAgo.getTime());
    }
  });

  it('returns the correct weekday', () => {
    for (let weekday = 0; weekday <= 6; weekday++) {
      const result = utils.getMostRecentDateByWeekday(weekday);
      expect(result.day()).toBe(weekday);
    }
  });
});
