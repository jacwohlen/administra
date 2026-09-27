import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import {
  activityStart,
  activityStatus,
  attendanceByTraining,
  buildActivity
} from './activityUtils';

// Saturday
const today = dayjs('2026-09-26');

describe('activityStatus', () => {
  it('maps days since the last training to a status', () => {
    expect(activityStatus(0)).toBe('active');
    expect(activityStatus(14)).toBe('active');
    expect(activityStatus(15)).toBe('paused');
    expect(activityStatus(60)).toBe('paused');
    expect(activityStatus(61)).toBe('inactive');
    expect(activityStatus(null)).toBe('inactive');
  });
});

describe('buildActivity', () => {
  it('lays out Monday-first weeks ending with the current week', () => {
    const a = buildActivity([], today, 53);
    expect(a.weeks).toHaveLength(53);
    expect(a.weeks[0].days[0].date).toBe(activityStart(today, 53).format('YYYY-MM-DD'));
    expect(dayjs(a.weeks[0].days[0].date).day()).toBe(1);
    const lastWeek = a.weeks.at(-1)!.days;
    expect(lastWeek[0].date).toBe('2026-09-21');
    expect(lastWeek[5]).toMatchObject({ date: '2026-09-26', future: false });
    expect(lastWeek[6]).toMatchObject({ date: '2026-09-27', future: true });
  });

  it('counts trainings per day and marks month starts', () => {
    const a = buildActivity(['2026-09-01', '2026-09-01', '2026-09-03T18:00:00'], today, 5);
    const days = a.weeks.flatMap((w) => w.days);
    expect(days.find((d) => d.date === '2026-09-01')?.count).toBe(2);
    expect(days.find((d) => d.date === '2026-09-03')?.count).toBe(1);
    expect(a.weeks.find((w) => w.days.some((d) => d.date === '2026-09-01'))?.monthStart).toBe(8);
  });

  it('summarises recent activity', () => {
    const a = buildActivity(['2026-09-22', '2026-09-24', '2026-08-20', '2026-06-01'], today);
    expect(a.lastDate).toBe('2026-09-24');
    expect(a.daysSince).toBe(2);
    expect(a.status).toBe('active');
    expect(a.last30).toBe(2);
  });

  it('averages per week since the first training in the window', () => {
    // Two trainings a week for the last four weeks (member joined recently)
    const dates = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10'];
    dates.push('2026-09-15', '2026-09-17', '2026-09-22', '2026-09-24');
    const a = buildActivity(dates, today);
    expect(a.perWeek).toBeCloseTo(8 / 4);
  });

  it('ignores trainings in the future and handles no data', () => {
    const a = buildActivity(['2026-10-01'], today);
    expect(a.lastDate).toBeNull();
    expect(a.status).toBe('inactive');
    expect(a.perWeek).toBe(0);
  });
});

describe('attendanceByTraining', () => {
  const judo = { id: '1', title: 'Judo Kids', weekday: 'Tuesday', section: 'Judo' };
  const aikido = { id: '2', title: 'Aikido', weekday: 'Thursday', section: 'Aikido' };

  it('counts attendance and trainer roles per training, most attended first', () => {
    const rows = attendanceByTraining([
      { trainingId: aikido, trainerRole: 'attendee' },
      { trainingId: judo, trainerRole: 'attendee' },
      { trainingId: judo, trainerRole: 'main_trainer' },
      { trainingId: judo, trainerRole: 'assistant' },
      { trainingId: judo }
    ]);
    expect(rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(rows[0]).toMatchObject({ attended: 2, asTrainer: 2, total: 4 });
    expect(rows[1]).toMatchObject({ attended: 1, asTrainer: 0, total: 1 });
  });

  it('handles no logs', () => {
    expect(attendanceByTraining([])).toEqual([]);
  });
});
