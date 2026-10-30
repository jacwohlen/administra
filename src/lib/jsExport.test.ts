import { describe, it, expect } from 'vitest';
import {
  ATTENDANCE_HEADER,
  activityRows,
  allowedDuration,
  attendanceRows,
  buildCourseExport,
  fileSlug,
  formatDate,
  parseDurations,
  parseTime,
  personRows,
  PERSON_HEADER,
  toCsv,
  type CourseLog,
  type CourseMember,
  type CourseTraining
} from './jsExport';

const trainings: CourseTraining[] = [
  { id: 1, title: 'Judo Jugend', dateFrom: '18:30', dateTo: '20:00' },
  { id: 2, title: 'Judo Kinder', dateFrom: '17.15', dateTo: '18.30' },
  { id: 3, title: 'Randori', dateFrom: '20:00', dateTo: '21:45' },
  { id: 4, title: 'Kurz', dateFrom: '19:00', dateTo: '19:45' },
  { id: 5, title: 'Ohne Ende', dateFrom: '19:00', dateTo: '' }
];

const members: CourseMember[] = [
  { id: 10, firstname: 'Anna', lastname: 'Muster', license_number: '266750' },
  { id: 11, firstname: 'Ben', lastname: 'Beispiel', license_number: '123456789' },
  { id: 12, firstname: 'Clara', lastname: 'Ohne', license_number: null }
];

const log = (
  date: string,
  trainingId: number,
  memberId: number,
  trainerRole: CourseLog['trainerRole'] = 'attendee'
): CourseLog => ({ date, trainingId, memberId, trainerRole });

describe('parseTime / formatDate', () => {
  it('reads both separators', () => {
    expect(parseTime('18:30')).toBe(18 * 60 + 30);
    expect(parseTime('18.30')).toBe(18 * 60 + 30);
    expect(parseTime('')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
  });

  it('formats dates the Swiss way', () => {
    expect(formatDate('2026-03-05')).toBe('05.03.2026');
  });
});

describe('allowedDuration', () => {
  it('takes the longest allowed value that fits', () => {
    expect(allowedDuration(90, [60, 75, 90])).toBe(90);
    expect(allowedDuration(105, [60, 75, 90])).toBe(90);
    expect(allowedDuration(80, [60, 75, 90])).toBe(75);
    expect(allowedDuration(45, [60, 75, 90])).toBeNull();
  });

  it('parses the durations field', () => {
    expect(parseDurations('90, 60;75 x 60')).toEqual([60, 75, 90]);
  });
});

describe('buildCourseExport', () => {
  const logs = [
    log('2026-03-05', 1, 10),
    log('2026-03-05', 1, 11, 'main_trainer'),
    log('2026-03-05', 1, 12),
    log('2026-03-04', 2, 10),
    log('2026-03-04', 2, 11, 'assistant'),
    log('2026-03-06', 3, 11),
    log('2026-03-06', 4, 10),
    log('2026-03-06', 5, 10)
  ];
  const result = buildCourseExport({ durations: [60, 75, 90] }, trainings, logs, members);

  it('creates one activity per training and date, in date order', () => {
    expect(result.activities).toEqual([
      { trainingId: 2, date: '2026-03-04', time: '17:15', duration: 75 },
      { trainingId: 1, date: '2026-03-05', time: '18:30', duration: 90 },
      { trainingId: 3, date: '2026-03-06', time: '20:00', duration: 90 }
    ]);
  });

  it('marks trainers as leaders and leaves out members without a number', () => {
    expect(result.attendance.map((a) => [a.member.id, a.role, a.activity.date])).toEqual([
      [11, 'Leiter/in', '2026-03-04'],
      [10, 'Teilnehmer/in', '2026-03-04'],
      [11, 'Leiter/in', '2026-03-05'],
      [10, 'Teilnehmer/in', '2026-03-05'],
      [11, 'Teilnehmer/in', '2026-03-06']
    ]);
    expect(result.warnings.membersWithoutNumber.map((m) => m.id)).toEqual([12]);
  });

  it('reports trainings it cannot export or had to shorten', () => {
    expect(result.warnings.trainingsWithoutTime.map((t) => t.id)).toEqual([5]);
    expect(result.warnings.trainingsTooShort).toEqual([{ training: trainings[3], minutes: 45 }]);
    expect(result.warnings.trainingsShortened).toEqual([
      { training: trainings[2], minutes: 105, exported: 90 }
    ]);
  });

  it('lists leaders and participants, including those of skipped trainings', () => {
    expect(result.leaders.map((m) => m.id)).toEqual([11]);
    expect(result.participants.map((m) => m.id)).toEqual([11, 10, 12]);
    expect(result.warnings.membersInBothRoles.map((m) => m.id)).toEqual([11]);
  });

  it('writes the NDS rows', () => {
    expect(activityRows(result.activities.slice(0, 1), 'Dojo')).toEqual([
      ['Training', '04.03.2026', '17:15', '75', 'Dojo', '']
    ]);
    expect(attendanceRows(result.attendance.slice(0, 1), 'Dojo')).toEqual([
      ['123456789', 'Leiter/in', '04.03.2026', 'Training', '17:15', '75', 'Dojo']
    ]);
  });
});

describe('toCsv', () => {
  it('writes BOM, semicolons and CRLF, quoting where needed', () => {
    const csv = toCsv(ATTENDANCE_HEADER.slice(0, 2), [['1', 'Halle "Nord"; oben']]);
    expect(csv).toBe('﻿PERSONENNUMMER;FUNKTION\r\n1;"Halle ""Nord""; oben"\r\n');
  });
});

describe('fileSlug', () => {
  it('prefers the course number', () => {
    expect(fileSlug({ course_number: '', title: 'Judo Jugend Zürich 2026' })).toBe(
      'judo-jugend-zurich-2026'
    );
    expect(fileSlug({ course_number: 'J+S 1234', title: 'x' })).toBe('j-s-1234');
  });
});

describe('personRows', () => {
  it('fills what Adsumus has and leaves the rest to the NDS', () => {
    const rows = personRows([
      {
        id: 1,
        firstname: 'Arti',
        lastname: 'Muster',
        birthday: '2014-05-10',
        license_number: '266 750'
      },
      { id: 2, firstname: 'Bea', lastname: 'Neu', birthday: null, license_number: null }
    ]);
    expect(rows[0]).toEqual([
      '266750',
      'Muster',
      'Arti',
      '10.05.2014',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ]);
    expect(rows[1].slice(0, 4)).toEqual(['', 'Neu', 'Bea', '']);
    expect(rows[0]).toHaveLength(PERSON_HEADER.length);
  });
});
