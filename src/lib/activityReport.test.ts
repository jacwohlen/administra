import { describe, expect, it } from 'vitest';
import {
  buildActivityReport,
  formatDays,
  activityReportPdf,
  reportPeriod,
  type ActivityReportLabels,
  type ReportInput
} from './activityReport';
import { buildPdf } from './pdf';
import type { TrainingPlanSession } from './models';

const session = (
  training_id: number,
  date: string,
  trainer_id: number | null,
  cancelled: boolean | null = null
): TrainingPlanSession => ({
  id: training_id * 1000 + Number(date.slice(-2)),
  training_id,
  date,
  trainer_id,
  topic: null,
  notes: null,
  cancelled,
  updated_at: ''
});

// Training 1 on Tuesdays (Kinder), training 2 on Thursdays (Erwachsene)
const base = (): ReportInput => ({
  from: '2026-03-01',
  to: '2026-03-31',
  today: '2026-03-20',
  members: [
    { id: 1, firstname: 'Anna', lastname: 'Muster' },
    { id: 2, firstname: 'Ben', lastname: 'Beispiel' },
    { id: 3, firstname: 'Cleo', lastname: 'Zeller' }
  ],
  trainings: [
    { id: 1, title: 'Kinder', section: 'Judo' },
    { id: 2, title: 'Erwachsene', section: 'Judo' }
  ],
  trainerLogs: [
    { date: '2026-03-03', trainingId: 1, memberId: 1, trainerRole: 'main_trainer' },
    { date: '2026-03-03', trainingId: 1, memberId: 2, trainerRole: 'assistant' },
    // Vertretung: Ben was planned, Cleo came and was checked in as trainer
    { date: '2026-03-10', trainingId: 1, memberId: 3, trainerRole: 'main_trainer' },
    { date: '2026-03-05', trainingId: 2, memberId: 2, trainerRole: 'main_trainer' },
    // A duplicate row counts once; outside the period not at all
    { date: '2026-03-05', trainingId: 2, memberId: 2, trainerRole: 'main_trainer' },
    { date: '2026-04-02', trainingId: 2, memberId: 2, trainerRole: 'main_trainer' }
  ],
  held: [
    {
      date: '2026-03-03',
      trainingId: 1,
      count: 12,
      mainTrainerCount: 1,
      totalTrainerCount: 2,
      hasLessonPlan: true
    },
    { date: '2026-03-10', trainingId: 1, count: 9, mainTrainerCount: 1 },
    { date: '2026-03-05', trainingId: 2, count: 8, mainTrainerCount: 1 },
    { date: '2026-03-12', trainingId: 2, count: 7, mainTrainerCount: 0, totalTrainerCount: 0 }
  ],
  events: [
    { id: 10, title: 'Lager', date: '2026-02-27', date_to: '2026-03-02' },
    { id: 11, title: 'Q-Prüfung', date: '2026-03-14' },
    { id: 12, title: 'Turnier', date: '2026-03-14' }
  ],
  eventLogs: [
    { eventId: 11, memberId: 7, isCoach: false },
    { eventId: 11, memberId: 8, isCoach: false },
    { eventId: 10, memberId: 1, isCoach: true },
    { eventId: 11, memberId: 2, isCoach: true, coachDay: 'half' },
    { eventId: 11, memberId: 1, isCoach: true, coachDay: 'half' },
    // Two events on one day: the day counts once, the larger share
    { eventId: 12, memberId: 1, isCoach: true, coachDay: 'full' }
  ],
  plan: {
    trainings: [
      { id: 1, title: 'Kinder', weekday: 'Tuesday', dateFrom: '18:00', section: 'Judo' },
      {
        id: 2,
        title: 'Erwachsene',
        weekday: 'Thursday',
        dateFrom: '20:00',
        section: 'Judo',
        mainTrainerId: 2
      }
    ],
    sessions: [
      session(1, '2026-03-10', 2),
      session(1, '2026-03-17', 1),
      session(1, '2026-03-24', 1),
      session(2, '2026-03-19', null, true)
    ],
    breaks: []
  }
});

describe('buildActivityReport', () => {
  const report = buildActivityReport(base());

  it('counts trainings by the check-in role, so a substitute counts for who came', () => {
    expect(report.rows.map((r) => [r.name, r.mainTrainer, r.assistant])).toEqual([
      ['Beispiel Ben', 1, 1],
      ['Muster Anna', 1, 0],
      ['Zeller Cleo', 1, 0]
    ]);
    expect(report.totals.mainTrainer).toBe(3);
    expect(report.totals.assistant).toBe(1);
  });

  it('counts coaching days within the period, half days as 0.5, one day once', () => {
    const days = Object.fromEntries(report.rows.map((r) => [r.name, r.coachingDays]));
    // Lager: 1 and 2 March in the period; 14 March: Q-Prüfung half, Turnier full
    expect(days['Muster Anna']).toBe(3);
    expect(days['Beispiel Ben']).toBe(0.5);
    expect(report.totals.coachingDays).toBe(3.5);
    const lager = report.coaching.find((c) => c.event === 'Lager')!;
    expect([lager.date, lager.dateTo, lager.coaches]).toEqual([
      '2026-03-01',
      '2026-03-02',
      [{ memberId: 1, name: 'Muster Anna', days: 2 }]
    ]);
  });

  it('lists every training held with trainers, participants and lesson plan', () => {
    expect(
      report.trainings.map((t) => [
        t.date,
        t.training,
        t.mainTrainers,
        t.assistants,
        t.participants,
        t.lessonPlan
      ])
    ).toEqual([
      ['2026-03-03', 'Kinder', ['Muster Anna'], ['Beispiel Ben'], 10, true],
      ['2026-03-05', 'Erwachsene', ['Beispiel Ben'], [], 8, false],
      ['2026-03-10', 'Kinder', ['Zeller Cleo'], [], 9, false],
      // Held without a trainer marked: listed too
      ['2026-03-12', 'Erwachsene', [], [], 7, false]
    ]);
  });

  it('counts event participants without the coaches', () => {
    const q = report.coaching.find((c) => c.event === 'Q-Prüfung')!;
    expect(q.participants).toBe(2);
    expect(report.coaching.find((c) => c.event === 'Lager')!.participants).toBe(0);
  });

  it('lists planned dates up to today the check-in shows no main trainer for', () => {
    expect(report.checks).toEqual([
      // Held, nobody marked: the plan falls back to the main trainer
      {
        date: '2026-03-12',
        trainingId: 2,
        training: 'Erwachsene',
        section: 'Judo',
        plannedTrainer: 'Beispiel Ben',
        plannedTrainerId: 2,
        reason: 'no_main_trainer'
      },
      // Planned, no check-in at all; the 24th is after today, the 19th cancelled
      {
        date: '2026-03-17',
        trainingId: 1,
        training: 'Kinder',
        section: 'Judo',
        plannedTrainer: 'Muster Anna',
        plannedTrainerId: 1,
        reason: 'no_checkin'
      }
    ]);
  });

  it('leaves out people with nothing to pay', () => {
    const input = base();
    input.from = '2026-05-01';
    input.to = '2026-05-31';
    expect(buildActivityReport(input).rows).toEqual([]);
  });
});

describe('reportPeriod', () => {
  const p = (q: string) => reportPeriod(new URLSearchParams(q), '2026-11-14');
  it('defaults to the year up to today and swaps a reversed period', () => {
    expect(p('')).toEqual({ from: '2026-01-01', to: '2026-11-14' });
    expect(p('from=2025-07-01&to=2025-12-31')).toEqual({ from: '2025-07-01', to: '2025-12-31' });
    expect(p('from=2025-12-31&to=2025-07-01')).toEqual({ from: '2025-07-01', to: '2025-12-31' });
    expect(p('from=garbage&to=2026-13-45')).toEqual({ from: '2026-01-01', to: '2026-11-14' });
  });
});

const labels: ActivityReportLabels = {
  title: 'Einsätze',
  period: 'Zeitraum',
  summary: 'Übersicht',
  person: 'Person',
  mainTrainer: 'Trainer',
  assistant: 'Hilfstrainer',
  coachingDays: 'Coaching-Tage',
  total: 'Total',
  trainingsDetail: 'Alle Trainings',
  date: 'Datum',
  training: 'Training',
  section: 'Sektion',
  mainTrainers: 'Trainer',
  assistants: 'Hilfstrainer',
  coachingDetail: 'Coaching',
  participants: 'Teiln.',
  lessonPlan: 'Lektionsplan',
  yes: 'ja',
  no: '–',
  trainingsNote: 'Hinweis',
  coachingNote: 'Hinweis',
  event: 'Anlass',
  coaches: 'Coaches',
  checks: 'Zu prüfen',
  checksHint: 'Hinweis',
  plannedTrainer: 'Laut Plan',
  reason: 'Grund',
  reasons: { no_main_trainer: 'ohne Haupttrainer', no_checkin: 'kein Check-in' },
  page: (page, pages) => `Seite ${page} von ${pages}`,
  created: 'Erstellt am'
};

describe('downloads', () => {
  const report = buildActivityReport(base());

  it('builds a PDF with the summary', () => {
    const doc = activityReportPdf(report, labels, '14.11.2026 21:00');
    expect(doc.tables[0].rows[0]).toEqual(['Beispiel Ben', '1', '1', '0.5']);
    expect(doc.tables[0].footer).toEqual(['Total', '3', '1', '3.5']);
    const text = new TextDecoder('latin1').decode(buildPdf(doc));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(Beispiel Ben)');
    expect(text).toContain('Seite 1 von 1');
  });

  it('formats days', () => {
    expect([formatDays(2), formatDays(1.5), formatDays(0)]).toEqual(['2', '1.5', '0']);
  });
});
