import { describe, expect, it } from 'vitest';
import type { TrainerTrackingRecord } from './models';
import { trainerReportSheet, trainerSummary, trainingLog } from './trainerReport';

const rec = (
  date: string,
  trainingId: number,
  memberId: number,
  lastname: string,
  trainerRole: TrainerTrackingRecord['trainerRole'],
  attendeeCount: number
): TrainerTrackingRecord => ({
  date,
  trainingId,
  trainingTitle: trainingId === 1 ? 'Kinder' : 'Erwachsene',
  section: 'Judo',
  memberId,
  lastname,
  firstname: 'A',
  trainerRole,
  attendeeCount
});

const records = [
  rec('2026-03-10', 2, 1, 'Muster', 'main_trainer', 12),
  rec('2026-03-10', 2, 2, 'Beispiel', 'assistant', 12),
  rec('2026-03-03', 1, 2, 'Beispiel', 'main_trainer', 8),
  rec('2026-03-03', 1, 1, 'Muster', 'assistant', 8),
  rec('2026-03-03', 1, 3, 'Zeller', 'assistant', 8),
  rec('2026-03-10', 1, 1, 'Muster', 'main_trainer', 9)
];

describe('trainerSummary', () => {
  it('counts main trainer and assistant per person, most active first', () => {
    expect(trainerSummary(records)).toEqual([
      { memberId: 1, name: 'Muster A', mainTrainerCount: 2, assistantCount: 1, totalCount: 3 },
      { memberId: 2, name: 'Beispiel A', mainTrainerCount: 1, assistantCount: 1, totalCount: 2 },
      { memberId: 3, name: 'Zeller A', mainTrainerCount: 0, assistantCount: 1, totalCount: 1 }
    ]);
  });
});

describe('trainingLog', () => {
  it('lists every training once per date, oldest first, with its trainers', () => {
    const log = trainingLog(records);
    expect(log.map((t) => [t.date, t.trainingTitle])).toEqual([
      ['2026-03-03', 'Kinder'],
      ['2026-03-10', 'Erwachsene'],
      ['2026-03-10', 'Kinder']
    ]);
    expect(log[0]).toMatchObject({
      mainTrainers: ['Beispiel A'],
      assistants: ['Muster A', 'Zeller A'],
      attendeeCount: 8
    });
    expect(log[2]).toMatchObject({ mainTrainers: ['Muster A'], assistants: [], attendeeCount: 9 });
  });
});

describe('trainerReportSheet', () => {
  it('puts the summary on top and the log below', () => {
    const labels = {
      sheetName: 'Trainer',
      title: 'Trainerübersicht',
      summary: 'Zusammenfassung',
      log: 'Alle Trainings',
      trainer: 'Trainer',
      mainTrainer: 'Haupttrainer',
      assistant: 'Assistent',
      total: 'Total',
      date: 'Datum',
      training: 'Training',
      section: 'Sektion',
      mainTrainers: 'Haupttrainer',
      assistants: 'Assistenten',
      attendees: 'Teilnehmende'
    };
    const sheet = trainerReportSheet(records, labels, '2026');
    expect(sheet.rows[0]).toEqual(['Trainerübersicht 2026']);
    expect(sheet.rows.slice(2, 8)).toEqual([
      ['Zusammenfassung'],
      ['Trainer', 'Haupttrainer', 'Assistent', 'Total'],
      ['Muster A', 2, 1, 3],
      ['Beispiel A', 1, 1, 2],
      ['Zeller A', 0, 1, 1],
      ['Total', 3, 3, 6]
    ]);
    expect(sheet.rows.slice(9)).toEqual([
      ['Alle Trainings'],
      ['Datum', 'Training', 'Sektion', 'Haupttrainer', 'Assistenten', 'Teilnehmende'],
      ['03.03.2026', 'Kinder', 'Judo', 'Beispiel A', 'Muster A, Zeller A', 8],
      ['10.03.2026', 'Erwachsene', 'Judo', 'Muster A', 'Beispiel A', 12],
      ['10.03.2026', 'Kinder', 'Judo', 'Muster A', '', 9]
    ]);
    expect(sheet.boldRows).toEqual([0, 2, 3, 7, 9, 10]);
  });
});
