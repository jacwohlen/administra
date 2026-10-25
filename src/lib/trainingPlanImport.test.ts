import { describe, expect, it } from 'vitest';
import {
  buildImport,
  matchLeader,
  parseSheet,
  parseSheetDate,
  sheetLeaders,
  splitTable
} from './trainingPlanImport';
import type { PlanTraining } from './trainingPlanUtils';

// Shaped like the TK's sheet, as pasted from Google Sheets (tab separated)
const SHEET = [
  'KW\tTag\tDatum\tTrainingstyp\tVon\tBis\tLeiter\tThema\tInfo / Bemerkung',
  '1\tMo\t29.12.2025\t\t\t\t\t\tWeihnachten',
  '\tMi\t31.12.2025\t\t\t\t\t\tWeihnachten',
  '\tFr\t02.01.2026\t\t\t\t\t\tWeihnachten',
  '\tSa\t03.01.2026\t\t\t\t\t\tWeihnachten',
  '2\tMo\t05.01.2026\tKampftraining\t20:00\t21:30\tBeni Muster\tTopwurf\t-',
  '\tMi\t07.01.2026\tRandoritraining\t20:00\t21:30\tLara Beispiel\t\tSMM Training 1, Sportferien',
  '\tDo\t08.01.2026\t\t19:30\t21:00\t\t\t-',
  '\tFr\t09.01.2026\tkein Training\t20:00\t21:30\tGesamt Trainersitzung\t-\tLeiter Sitzung',
  '3\tMo\t12.01.2026\tKampftraining\t20:00\t21:30\tGast Trainerin\t"Topwurf, Teil 2"\t-',
  '\tMi\t14.01.2026\tfreies Training\t\t\t\t\tSportferien',
  '\tFr\t16.01.2026\tTechniktraining\t20:00\t21:30\tkein Training\t\t-'
].join('\n');

const trainings: PlanTraining[] = [
  { id: 27, title: 'Judo Kampftraining', weekday: 'Monday', dateFrom: '20:00', section: 'Judo' },
  { id: 26, title: 'Judo Randori', weekday: 'Wednesday', dateFrom: '20:00', section: 'Judo' },
  { id: 23, title: 'Judo Techniktraining', weekday: 'Friday', dateFrom: '20:00', section: 'Judo' }
];

const members = [
  { id: 1, firstname: 'Benjamin', lastname: 'Muster' },
  { id: 2, firstname: 'Lara', lastname: 'Beispiel' },
  { id: 3, firstname: 'Bea', lastname: 'Muster' }
];

describe('reading the sheet', () => {
  it('splits tab, semicolon and comma separated text with quoted cells', () => {
    expect(splitTable('a\tb\n"c\td"\te')).toEqual([
      ['a', 'b'],
      ['c\td', 'e']
    ]);
    expect(splitTable('a;b;"x ""y"""\n1;2;3')).toEqual([
      ['a', 'b', 'x "y"'],
      ['1', '2', '3']
    ]);
    expect(splitTable('a,"b, c"\r\n1,2')).toEqual([
      ['a', 'b, c'],
      ['1', '2']
    ]);
  });

  it('understands the usual date formats', () => {
    expect(parseSheetDate('05.01.2026')).toBe('2026-01-05');
    expect(parseSheetDate('5.1.26')).toBe('2026-01-05');
    expect(parseSheetDate('2026-01-05 00:00:00')).toBe('2026-01-05');
    expect(parseSheetDate('Mo, 05.01.2026')).toBe('2026-01-05');
    expect(parseSheetDate('31.02.2026')).toBeNull();
    expect(parseSheetDate('KW')).toBeNull();
  });

  it('finds the columns by the header and treats "-" as empty', () => {
    const rows = parseSheet(SHEET)!;
    expect(rows).toHaveLength(11);
    expect(rows[4]).toEqual({
      date: '2026-01-05',
      type: 'Kampftraining',
      leader: 'Beni Muster',
      topic: 'Topwurf',
      info: ''
    });
    expect(rows[8].topic).toBe('Topwurf, Teil 2');
  });

  it('needs a header with "Datum"', () => {
    expect(parseSheet('a\tb\n1\t2')).toBeNull();
  });
});

describe('leaders', () => {
  it('lists the people, not the placeholders', () => {
    expect(sheetLeaders(parseSheet(SHEET)!)).toEqual([
      'Beni Muster',
      'Gast Trainerin',
      'Gesamt Trainersitzung',
      'Lara Beispiel'
    ]);
  });

  it('matches full names, either order, and short first names', () => {
    expect(matchLeader('Lara Beispiel', members)).toBe(2);
    expect(matchLeader('beispiel lara', members)).toBe(2);
    expect(matchLeader('Beni Muster', members)).toBe(1);
    // "Be" could be Benjamin or Bea: no guess
    expect(matchLeader('Be Muster', members)).toBeNull();
    expect(matchLeader('Gast Trainerin', members)).toBeNull();
  });
});

describe('buildImport', () => {
  const rows = parseSheet(SHEET)!;
  const ids = new Map(sheetLeaders(rows).map((l) => [l, matchLeader(l, members)]));
  const result = buildImport(rows, trainings, ids);
  const at = (date: string) => result.sessions.find((s) => s.date === date);

  it('plans the training of the weekday with leader and topic', () => {
    expect(at('2026-01-05')).toEqual({
      training_id: 27,
      date: '2026-01-05',
      trainer_id: 1,
      topic: 'Topwurf',
      notes: null,
      cancelled: null
    });
  });

  it('keeps the info as note, without the holidays', () => {
    expect(at('2026-01-07')?.notes).toBe('SMM Training 1');
    expect(at('2026-01-07')?.trainer_id).toBe(2);
  });

  it('keeps leaders without a member in the note', () => {
    expect(at('2026-01-12')).toMatchObject({ trainer_id: null, notes: 'Gast Trainerin' });
  });

  it('drops "kein Training" and empty days, with the reason', () => {
    expect(at('2026-01-09')).toMatchObject({
      cancelled: true,
      trainer_id: null,
      notes: 'Gesamt Trainersitzung, Leiter Sitzung'
    });
    expect(at('2025-12-29')).toMatchObject({ cancelled: true, notes: null });
  });

  it('turns another training type into the topic', () => {
    expect(at('2026-01-14')).toMatchObject({ training_id: 26, topic: 'freies Training' });
  });

  it('ignores "kein Training" as leader', () => {
    expect(at('2026-01-16')).toMatchObject({ trainer_id: null, notes: null, cancelled: null });
  });

  it('skips days without a planned training', () => {
    expect(result.sessions.some((s) => s.date === '2026-01-08')).toBe(false);
    expect(result.skipped).toBe(0);
  });

  it('makes holidays out of the info, closing the dojo when nobody trained', () => {
    expect(result.breaks).toEqual([
      {
        title: 'Weihnachten',
        date_from: '2025-12-29',
        date_to: '2026-01-03',
        cancels_training: true
      },
      {
        title: 'Sportferien',
        date_from: '2026-01-07',
        date_to: '2026-01-07',
        cancels_training: false
      },
      {
        title: 'Sportferien',
        date_from: '2026-01-14',
        date_to: '2026-01-14',
        cancels_training: false
      }
    ]);
  });

  it('picks the training by type when a weekday has several', () => {
    const two: PlanTraining[] = [
      ...trainings,
      { id: 40, title: 'Judo Kata', weekday: 'Monday', dateFrom: '18:00', section: 'Judo' }
    ];
    const r = buildImport(
      [{ date: '2026-01-05', type: 'Kampftraining', leader: '', topic: '', info: '' }],
      two,
      new Map()
    );
    expect(r.sessions.map((s) => s.training_id)).toEqual([27]);
  });
});
