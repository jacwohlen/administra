import { describe, expect, it } from 'vitest';
import type { MemberNotice, NoticeLine, TrainingNotice } from './trainingPlanMail';
import {
  compactDates,
  formatDate,
  formatSchedule,
  mailLocale,
  memberBlocks,
  renderMail,
  type MailContext
} from './trainingPlanMailText';

const MONDAY = { weekday: 'Monday', timeFrom: '18:00', timeTo: '19:30' };
const WEDNESDAY = { weekday: 'Wednesday', timeFrom: '18:30', timeTo: '20:00' };

function training(lines: NoticeLine[], over: Partial<TrainingNotice> = {}): TrainingNotice {
  return { trainingId: 1, title: 'Judo Kampftraining', schedule: MONDAY, lines, ...over };
}

function notice(trainings: TrainingNotice[], over: Partial<MemberNotice> = {}): MemberNotice {
  return {
    memberId: 10,
    firstname: 'Max',
    lastname: 'Muster',
    firstTime: false,
    unclearSince: null,
    trainings,
    told: { member_id: 10, training_ids: [], trainings: [], dates: [] },
    ...over
  };
}

const ctx = (over: Partial<MailContext> = {}): MailContext => ({
  locale: 'de',
  clubName: 'Judo Club',
  origin: 'https://app.example.ch/',
  senderName: 'Tina Planer',
  ...over
});

/** One line rendered alone (blocks of a member with just that training) */
function text(line: NoticeLine, locale: 'de' | 'en') {
  return memberBlocks(notice([training([line])]), locale)[0].lines[0];
}

describe('lines', () => {
  const lines: [NoticeLine, string, string][] = [
    [
      { kind: 'main_gone', trainingId: 1 },
      'Du bist nicht mehr Haupttrainer/in.',
      'You are no longer the main trainer.'
    ],
    [
      { kind: 'training_gone', trainingId: 1 },
      'Dieses Training ist nicht mehr im Trainingsplan.',
      'This training is no longer in the training plan.'
    ],
    [
      { kind: 'schedule', trainingId: 1, schedule: WEDNESDAY, before: MONDAY },
      'Neu am Mittwoch 18:30–20:00 (bisher Montag 18:00–19:30).',
      'Now on Wednesday 18:30–20:00 (before: Monday 18:00–19:30).'
    ],
    [
      { kind: 'lead', trainingId: 1, date: '2026-11-10', topic: 'Fallschule' },
      'Neu: Di 10.11.2026 – du leitest (Thema: Fallschule)',
      'New: Tue 10 Nov 2026 – you lead (topic: Fallschule)'
    ],
    [
      { kind: 'lead', trainingId: 1, date: '2026-11-09', topic: null },
      'Neu: Mo 9.11.2026 – du leitest',
      'New: Mon 9 Nov 2026 – you lead'
    ],
    [
      {
        kind: 'not_lead',
        trainingId: 1,
        date: '2026-11-16',
        other: { memberId: 30, name: 'Anna Muster' }
      },
      'Nicht mehr bei dir: Mo 16.11.2026 – übernimmt Anna Muster',
      'No longer yours: Mon 16 Nov 2026 – Anna Muster takes over'
    ],
    [
      { kind: 'not_lead', trainingId: 1, date: '2026-11-16', other: 'open' },
      'Nicht mehr bei dir: Mo 16.11.2026 – Trainer offen',
      'No longer yours: Mon 16 Nov 2026 – trainer open'
    ],
    [
      { kind: 'not_lead', trainingId: 1, date: '2026-11-16', other: 'cancelled' },
      'Nicht mehr bei dir: Mo 16.11.2026 – fällt aus',
      'No longer yours: Mon 16 Nov 2026 – cancelled'
    ],
    [
      { kind: 'not_lead', trainingId: 1, date: '2026-11-13', other: null },
      'Nicht mehr bei dir: Fr 13.11.2026',
      'No longer yours: Fri 13 Nov 2026'
    ],
    [
      {
        kind: 'other_leads',
        trainingId: 1,
        date: '2026-11-17',
        other: { memberId: 31, name: 'Lea Keller' }
      },
      'Nicht bei dir: Di 17.11.2026 – leitet Lea Keller',
      'Not yours: Tue 17 Nov 2026 – led by Lea Keller'
    ],
    [
      { kind: 'other_leads', trainingId: 1, date: '2026-11-17', other: 'open' },
      'Nicht bei dir: Di 17.11.2026 – Trainer offen',
      'Not yours: Tue 17 Nov 2026 – trainer open'
    ],
    [
      { kind: 'cancelled', trainingId: 1, date: '2026-11-23', reason: 'Herbstferien' },
      'Fällt aus: Mo 23.11.2026 (Herbstferien)',
      'Cancelled: Mon 23 Nov 2026 (Herbstferien)'
    ],
    [
      { kind: 'cancelled', trainingId: 1, date: '2026-11-23', reason: null },
      'Fällt aus: Mo 23.11.2026',
      'Cancelled: Mon 23 Nov 2026'
    ],
    [
      { kind: 'resumed', trainingId: 1, date: '2026-11-30', topic: null },
      'Findet wieder statt: Mo 30.11.2026 – du leitest',
      'Takes place again: Mon 30 Nov 2026 – you lead'
    ],
    [
      { kind: 'still_lead', trainingId: 1, date: '2026-12-07', topic: 'Kata\nTeil 2' },
      'Weiterhin bei dir: Mo 7.12.2026 (Thema: Kata Teil 2)',
      'Still yours: Mon 7 Dec 2026 (topic: Kata Teil 2)'
    ]
  ];

  it.each(lines)('%o in German and English', (line, de, en) => {
    expect(text(line, 'de')).toBe(de);
    expect(text(line, 'en')).toBe(en);
  });

  it('ends the main trainer line with "ausser:" when more lines follow', () => {
    const mainNew: NoticeLine = { kind: 'main_new', trainingId: 1, schedule: MONDAY };
    expect(text(mainNew, 'de')).toBe('Du bist neu Haupttrainer/in und leitest alle Termine.');
    expect(text(mainNew, 'en')).toBe('You are now the main trainer and lead every date.');
    const blocks = memberBlocks(
      notice([
        training([
          mainNew,
          { kind: 'cancelled', trainingId: 1, date: '2026-12-21', reason: 'Weihnachten' },
          { kind: 'cancelled', trainingId: 1, date: '2026-12-28', reason: 'Weihnachten' }
        ])
      ]),
      'de'
    );
    expect(blocks).toEqual([
      {
        heading: 'Judo Kampftraining (Montag 18:00–19:30)',
        lines: [
          'Du bist neu Haupttrainer/in und leitest alle Termine, ausser:',
          'Fällt aus (Weihnachten): 21.12., 28.12.2026'
        ]
      }
    ]);
    expect(memberBlocks(notice([training([mainNew, { ...lines[3][0] }])]), 'en')[0].lines[0]).toBe(
      'You are now the main trainer and lead every date, except:'
    );
  });

  it('words the first message as an overview, not as news', () => {
    const mainNew: NoticeLine = { kind: 'main_new', trainingId: 1, schedule: MONDAY };
    const lead: NoticeLine = { kind: 'lead', trainingId: 1, date: '2026-11-10', topic: 'Kata' };
    const first = (lines: NoticeLine[], locale: 'de' | 'en') =>
      memberBlocks(notice([training(lines)], { firstTime: true }), locale)[0].lines;
    expect(first([mainNew], 'de')).toEqual(['Du bist Haupttrainer/in und leitest alle Termine.']);
    expect(first([mainNew], 'en')).toEqual(['You are the main trainer and lead every date.']);
    expect(
      first([mainNew, { kind: 'cancelled', trainingId: 1, date: '2026-11-23', reason: null }], 'de')
    ).toEqual([
      'Du bist Haupttrainer/in und leitest alle Termine, ausser:',
      'Fällt aus: Mo 23.11.2026'
    ]);
    expect(first([lead], 'de')).toEqual(['Du leitest: Di 10.11.2026 (Thema: Kata)']);
    expect(first([lead], 'en')).toEqual(['You lead: Tue 10 Nov 2026 (topic: Kata)']);
    const dates = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];
    const many = [...dates, '2026-12-07', '2026-12-14'].map((date): NoticeLine => ({
      kind: 'lead',
      trainingId: 1,
      date,
      topic: null
    }));
    expect(first(many, 'de')).toEqual([
      'Du leitest 7 Termine: 2.11., 9.11., 16.11., 23.11., 30.11., 7.12., 14.12.2026'
    ]);
    expect(first(many, 'en')).toEqual([
      'You lead 7 dates: 2 Nov, 9 Nov, 16 Nov, 23 Nov, 30 Nov, 7 Dec, 14 Dec 2026'
    ]);
    // Other lines read the same either way
    const other: NoticeLine = {
      kind: 'other_leads',
      trainingId: 1,
      date: '2026-11-17',
      other: { memberId: 31, name: 'Lea Keller' }
    };
    expect(first([other], 'de')).toEqual(['Nicht bei dir: Di 17.11.2026 – leitet Lea Keller']);
  });

  it('compresses in English too', () => {
    const dates = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];
    const many = [...dates, '2026-12-07', '2026-12-14'];
    const blocks = memberBlocks(
      notice([
        training([
          ...many.map((date): NoticeLine => ({
            kind: 'not_lead',
            trainingId: 1,
            date,
            other: null
          })),
          ...dates.map((date): NoticeLine => ({
            kind: 'cancelled',
            trainingId: 2,
            date: date.replace('-11-', '-12-'),
            reason: 'Weihnachten'
          }))
        ])
      ]),
      'en'
    );
    expect(blocks[0].lines).toEqual([
      'No longer yours: 7 dates: 2 Nov, 9 Nov, 16 Nov, 23 Nov, 30 Nov, 7 Dec, 14 Dec 2026',
      'Cancelled (Weihnachten): 2 Dec, 9 Dec, 16 Dec, 23 Dec, 30 Dec 2026'
    ]);
  });
});

describe('dates and schedules', () => {
  it('formats dates', () => {
    expect(formatDate('2026-11-10', 'de')).toBe('Di 10.11.2026');
    expect(formatDate('2027-01-03', 'de')).toBe('So 3.1.2027');
    expect(formatDate('2026-11-10', 'en')).toBe('Tue 10 Nov 2026');
  });

  it('lists dates compactly, the year after the last of each year', () => {
    const dates = ['2026-12-01', '2026-11-03', '2026-11-17', '2027-01-12'];
    expect(compactDates(dates, 'de')).toBe('3.11., 17.11., 1.12.2026, 12.1.2027');
    expect(compactDates(dates, 'en')).toBe('3 Nov, 17 Nov, 1 Dec 2026, 12 Jan 2027');
    expect(compactDates([], 'de')).toBe('');
  });

  it('formats schedules', () => {
    expect(formatSchedule(MONDAY, 'de')).toBe('Montag 18:00–19:30');
    expect(formatSchedule(MONDAY, 'en')).toBe('Monday 18:00–19:30');
    expect(formatSchedule({ ...MONDAY, timeTo: null }, 'de')).toBe('Montag 18:00');
    expect(formatSchedule({ weekday: 'Monday', timeFrom: null, timeTo: null }, 'de')).toBe(
      'Montag'
    );
    expect(formatSchedule({ ...MONDAY, weekday: 'Montags' }, 'en')).toBe('Montags 18:00–19:30');
    expect(formatSchedule({ weekday: null, timeFrom: null, timeTo: null }, 'de')).toBe('');
  });

  it('takes the mail language from the app', () => {
    expect(mailLocale('de-CH')).toBe('de');
    expect(mailLocale('de')).toBe('de');
    expect(mailLocale('en-GB')).toBe('en');
    expect(mailLocale(undefined)).toBe('en');
    expect(mailLocale(null)).toBe('en');
  });
});

describe('renderMail', () => {
  const lead: NoticeLine = { kind: 'lead', trainingId: 1, date: '2026-11-09', topic: null };
  const max = notice([training([lead])]);
  const lea = notice(
    [
      training([{ kind: 'main_new', trainingId: 2, schedule: WEDNESDAY }], {
        trainingId: 2,
        title: 'Judo Techniktraining',
        schedule: WEDNESDAY
      })
    ],
    { memberId: 11, firstname: 'Lea', lastname: 'Muster', firstTime: true }
  );
  const tom = notice([training([lead])], { memberId: 12, firstname: 'Tom', lastname: 'Muster' });

  it('writes one mail for one trainer', () => {
    const mail = renderMail([max], ctx());
    expect(mail.subject).toBe('Judo Club – Trainingsplan: Änderungen für Max');
    expect(mail.text).toBe(
      [
        'Hallo Max',
        '',
        'Im Trainingsplan hat sich für dich etwas geändert:',
        '',
        'Judo Kampftraining (Montag 18:00–19:30)',
        '- Neu: Mo 9.11.2026 – du leitest',
        '',
        'Verbindlich ist der aktuelle Trainingsplan (mit Zugang zur App: https://app.example.ch/dashboard/training-plan).',
        'Abonnierte Kalender («Meine Trainings») zeigen Änderungen erst nach einigen Stunden.',
        'Fragen, oder passt dir ein Termin nicht? Antworte auf diese Mail, sie geht an Tina Planer.',
        '',
        'Judo Club',
        ''
      ].join('\n')
    );
  });

  it('writes one mail for a family, a section each', () => {
    const mail = renderMail([max, lea, tom], ctx());
    expect(mail.subject).toBe('Judo Club – Trainingsplan: Änderungen für Max, Lea und Tom');
    expect(mail.text).toContain('Hallo Max, Lea und Tom\n\nIm Trainingsplan hat sich für euch');
    expect(mail.text).toContain(
      'Für Max Muster:\n\nJudo Kampftraining (Montag 18:00–19:30)\n- Neu: Mo 9.11.2026 – du leitest\n\nFür Lea Muster:\n\nJudo Techniktraining (Mittwoch 18:30–20:00)\n- Du bist Haupttrainer/in und leitest alle Termine.\n\nFür Tom Muster:'
    );
    expect(mail.text).toContain('passt euch ein Termin nicht? Antwortet auf diese Mail');
    expect(renderMail([max, lea], ctx({ locale: 'en' })).subject).toBe(
      'Judo Club – Training plan: changes for Max and Lea'
    );
    expect(renderMail([max, lea], ctx({ locale: 'en' })).text).toContain(
      'For Lea Muster:\n\nJudo Techniktraining (Wednesday 18:30–20:00)'
    );
  });

  it('calls a first message an overview', () => {
    const mail = renderMail([lea], ctx());
    expect(mail.subject).toBe('Judo Club – Trainingsplan: Übersicht für Lea');
    expect(mail.text).toContain('Hallo Lea\n\nHier ist deine Übersicht aus dem Trainingsplan:');
    // Not news: Lea may have led it for years
    expect(mail.text).toContain('- Du bist Haupttrainer/in und leitest alle Termine.');
    expect(mail.text).not.toContain('neu Haupttrainer');
    const en = renderMail([lea], ctx({ locale: 'en' }));
    expect(en.subject).toBe('Judo Club – Training plan: overview for Lea');
    expect(en.text).toContain('Hello Lea\n\nHere is your overview from the training plan:');
    // Not when one of them was told before
    expect(renderMail([lea, max], ctx()).subject).toContain('Änderungen');
    expect(renderMail([lea, { ...max, firstTime: true }], ctx()).text).toContain(
      'Hier ist eure Übersicht'
    );
  });

  it('leaves out an empty club name and keeps the subject on one line', () => {
    const mail = renderMail([max], ctx({ clubName: '  ' }));
    expect(mail.subject).toBe('Trainingsplan: Änderungen für Max');
    expect(mail.text.trimEnd().endsWith('sie geht an Tina Planer.')).toBe(true);
    expect(renderMail([max], ctx({ clubName: 'Judo\nClub' })).subject).toBe(
      'Judo Club – Trainingsplan: Änderungen für Max'
    );
  });

  it('writes the English footer', () => {
    const mail = renderMail([max], ctx({ locale: 'en', origin: 'https://app.example.ch' }));
    expect(mail.text).toContain(
      [
        'There are changes for you in the training plan:',
        '',
        'Judo Kampftraining (Monday 18:00–19:30)',
        '- New: Mon 9 Nov 2026 – you lead',
        '',
        'The current training plan is binding (with access to the app: https://app.example.ch/dashboard/training-plan).',
        'Subscribed calendars ("My trainings") show changes only after a few hours.',
        'Questions, or a date that does not suit you? Reply to this mail; it goes to Tina Planer.',
        '',
        'Judo Club'
      ].join('\n')
    );
    expect(renderMail([max], ctx({ senderName: '' })).text).toContain('Antworte auf diese Mail.\n');
  });

  it('names a training no longer in the plan without a schedule when none was told', () => {
    const gone = notice([
      training([{ kind: 'training_gone', trainingId: 3 }], {
        trainingId: 3,
        title: 'Judo Alt',
        schedule: null
      })
    ]);
    expect(memberBlocks(gone, 'de')).toEqual([
      { heading: 'Judo Alt', lines: ['Dieses Training ist nicht mehr im Trainingsplan.'] }
    ]);
  });
});
