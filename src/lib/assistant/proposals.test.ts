import { describe, expect, it } from 'vitest';
import {
  cleanDate,
  cleanName,
  cleanPartialDate,
  cleanText,
  cleanTime,
  isIsoDate,
  sanitizeAttendance,
  sanitizeEvents,
  sanitizeGrades,
  sanitizeLessonPlan,
  sanitizeProposal,
  sanitizeTrainingPlan
} from './proposals';

describe('cleaning values', () => {
  it('collapses whitespace, strips invisible characters and caps the length', () => {
    expect(cleanText('  Lena \t Müller​ ', 100)).toBe('Lena Müller');
    expect(cleanText('abc‮def', 100)).toBe('abc def');
    expect(cleanText('x'.repeat(20), 5)).toBe('xxxxx');
    expect(cleanText(42, 10)).toBe('');
  });

  it('keeps lines only where asked', () => {
    expect(cleanText('a\nb', 10)).toBe('a b');
    expect(cleanText('a\r\n\n\n\nb', 10, true)).toBe('a\n\nb');
  });

  it('drops spreadsheet formula prefixes', () => {
    expect(cleanText('=HYPERLINK("x")', 100)).toBe('HYPERLINK("x")');
    expect(cleanName('@Lena <b>Müller</b>')).toBe('Lena bMüller/b');
  });

  it('accepts only real dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('1850-01-01')).toBe(false);
    expect(cleanDate('2026-02-31')).toBe('');
    expect(cleanDate('05.03.2024')).toBe('2024-03-05');
    expect(cleanDate('morgen')).toBe('');
    expect(cleanDate(null)).toBe('');
  });

  it('keeps partial grading dates', () => {
    expect(cleanPartialDate('2019')).toBe('2019');
    expect(cleanPartialDate('2019-06')).toBe('2019-06');
    expect(cleanPartialDate('2019-13')).toBe('');
    expect(cleanPartialDate('2019-06-12')).toBe('2019-06-12');
  });

  it('normalises times', () => {
    expect(cleanTime('8.30')).toBe('08:30');
    expect(cleanTime('18:00')).toBe('18:00');
    expect(cleanTime('25:00')).toBe('');
    expect(cleanTime('abends')).toBe('');
  });
});

const ladder = [
  { section: 'Judo', grade: '6. Kyu' },
  { section: 'Judo', grade: '5.5 Kyu' },
  { section: 'Judo', grade: '5. Kyu' },
  { section: 'Aikido', grade: '6. Kyu' }
];

describe('sanitizeGrades', () => {
  it('keeps known grades and drops unknown ones but keeps their wording', () => {
    const result = sanitizeGrades(
      {
        section: 'judo',
        holder: { name: 'Lena Müller', birthday: '2014-02-30' },
        entries: [
          { grade: '5. Kyu', gradeAsWritten: 'Gelbgurt', date: '2019', confidence: 'high' },
          { grade: '9. Dan', gradeAsWritten: '9. Dan', date: 'x', confidence: 'sure' },
          { grade: '', gradeAsWritten: '', beltColor: '' }
        ],
        warnings: ['Seite 2 fehlt', 3],
        injected: 'ignored'
      },
      ladder
    );
    expect(result.section).toBe('Judo');
    expect(result.holder).toEqual({ name: 'Lena Müller', birthday: '' });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ grade: '5. Kyu', date: '2019', confidence: 'high' });
    expect(result.entries[1]).toMatchObject({ grade: '', gradeAsWritten: '9. Dan', date: '' });
    expect(result.entries[1].confidence).toBe('medium');
    expect(result.warnings).toEqual(['Seite 2 fehlt']);
    expect(result).not.toHaveProperty('injected');
  });

  it('survives garbage', () => {
    expect(sanitizeGrades('nonsense', ladder)).toEqual({
      section: '',
      holder: { name: '', birthday: '' },
      entries: [],
      warnings: []
    });
  });
});

describe('sanitizeAttendance', () => {
  it('cleans names, roles and dates and collects all dates', () => {
    const result = sanitizeAttendance({
      dates: ['2026-10-05'],
      entries: [
        { name: ' Lena  Müller ', role: 'main_trainer', dates: ['2026-10-12', '2026-10-12'] },
        { name: '', role: 'attendee' },
        { name: 'Tim', role: 'admin', dates: 'all' }
      ]
    });
    expect(result.entries).toEqual([
      {
        name: 'Lena Müller',
        role: 'main_trainer',
        dates: ['2026-10-12'],
        confidence: 'medium',
        remark: ''
      },
      { name: 'Tim', role: 'attendee', dates: [], confidence: 'medium', remark: '' }
    ]);
    expect(result.dates).toEqual(['2026-10-05', '2026-10-12']);
  });
});

describe('sanitizeTrainingPlan', () => {
  it('accepts only listed training keys and real dates', () => {
    const keys = new Map([['T12', 12]]);
    const result = sanitizeTrainingPlan(
      {
        sessions: [
          {
            date: '2026-01-05',
            training: 't12',
            trainer: 'Beni',
            topic: 'Ukemi',
            cancelled: false
          },
          { date: '2026-01-06', training: 'T99', cancelled: 'yes' },
          { date: 'Januar', training: 'T12' }
        ],
        holidays: [
          { title: 'Sportferien', dateFrom: '2026-02-20', dateTo: '2026-02-07', closed: true },
          { title: '', dateFrom: '2026-03-01' }
        ]
      },
      keys
    );
    expect(result.sessions.map((s) => [s.date, s.trainingId, s.cancelled])).toEqual([
      ['2026-01-05', 12, false],
      ['2026-01-06', null, false]
    ]);
    expect(result.holidays).toEqual([
      { title: 'Sportferien', dateFrom: '2026-02-07', dateTo: '2026-02-20', closed: true }
    ]);
  });
});

describe('sanitizeLessonPlan', () => {
  it('drops empty sections and items', () => {
    const result = sanitizeLessonPlan({
      date: '2026-10-05',
      title: 'Ukemi',
      sections: [
        { heading: 'Aufwärmen', items: ['Laufen', '', 7] },
        { heading: '', items: [] }
      ]
    });
    expect(result.sections).toEqual([{ heading: 'Aufwärmen', items: ['Laufen'] }]);
  });
});

describe('sanitizeEvents', () => {
  it('keeps events with a title and checks dates and times', () => {
    const result = sanitizeEvents({
      events: [
        {
          title: 'Kids Cup',
          date: '2026-11-14',
          dateTo: '2026-11-13',
          timeFrom: '9.00',
          timeTo: 'abends',
          description: 'Anmeldung\nbis Ende Oktober'
        },
        { title: '', date: '2026-11-15' }
      ]
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      date: '2026-11-14',
      dateTo: '',
      timeFrom: '09:00',
      timeTo: '',
      description: 'Anmeldung\nbis Ende Oktober'
    });
  });
});

describe('sanitizeProposal', () => {
  it('dispatches by kind', () => {
    expect(sanitizeProposal('events', { events: [] })).toEqual({ events: [], warnings: [] });
    expect(sanitizeProposal('training_plan', null)).toEqual({
      sessions: [],
      holidays: [],
      warnings: []
    });
  });
});
