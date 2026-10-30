import { describe, expect, it } from 'vitest';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import {
  buildCalendarFeed,
  calendarFeedUrl,
  googleCalendarUrl,
  parseFeedName,
  webcalUrl,
  zurichToday,
  type CalendarFeedData,
  type CalendarFeedOptions,
  type FeedTraining
} from './calendarFeed';

const token = '0123456789abcdef'.repeat(4);
// A Friday; the feed covers 2026-09-04 to 2027-10-30
const now = new Date('2026-10-30T10:00:00Z');

const randori: FeedTraining = {
  id: 26,
  title: 'Judo Randori',
  weekday: 'Wednesday',
  dateFrom: '20:00',
  dateTo: '21:30',
  section: 'Judo',
  mainTrainerId: 34
};
const kids: FeedTraining = {
  id: 42,
  title: 'Judo Kinder',
  weekday: 'Tuesday',
  dateFrom: '18.30',
  dateTo: '20.00',
  section: 'Judo',
  mainTrainerId: null
};
// Dojo closed
const christmas: TrainingPlanBreak = {
  id: 3,
  title: 'Weihnachten',
  date_from: '2026-12-24',
  date_to: '2027-01-04',
  cancels_training: true
};
// School holidays: the training is held
const sport: TrainingPlanBreak = {
  id: 4,
  title: 'Sportferien',
  date_from: '2027-02-06',
  date_to: '2027-02-21',
  cancels_training: false
};

function session(p: Partial<TrainingPlanSession>): TrainingPlanSession {
  return {
    id: 1,
    training_id: randori.id,
    date: '2026-11-04',
    trainer_id: null,
    topic: null,
    notes: null,
    cancelled: null,
    updated_at: '2026-10-28T08:15:00+00:00',
    ...p
  };
}

function data(p: Partial<CalendarFeedData> = {}): CalendarFeedData {
  return {
    member_ids: [12],
    trainings: [randori, kids],
    sessions: [
      session({ id: 1, date: '2026-11-04', trainer_id: 12, topic: 'Fallschule' }),
      session({ id: 2, date: '2026-11-11', cancelled: true, notes: 'Turnier in Bern' }),
      session({ id: 3, date: '2026-11-18', cancelled: true }),
      session({
        id: 4,
        training_id: kids.id,
        date: '2026-12-29',
        trainer_id: 12,
        topic: 'Weihnachtstraining',
        cancelled: false
      }),
      session({ id: 5, date: '2026-11-25', notes: 'Gäste aus Wohlen,\nbitte Matten; früher' })
    ],
    breaks: [christmas, sport],
    trainers: [
      { id: 12, firstname: 'Anna', lastname: 'Muster' },
      { id: 34, firstname: 'Beat', lastname: 'Beispiel' }
    ],
    ...p
  };
}

function feed(p: Partial<CalendarFeedOptions> = {}, d: CalendarFeedData = data()): string {
  return buildCalendarFeed(d, {
    kind: 'all',
    locale: 'de',
    origin: 'https://admin.example',
    clubName: 'JAC Wohlen',
    now,
    ...p
  });
}

const octets = (text: string) => new TextEncoder().encode(text).length;
const unfold = (text: string) => text.replace(/\r\n /g, '');

/** The content lines of the calendar (unfolded) outside its events and time zone */
function calendarProps(ics: string): string[] {
  const body = unfold(ics).split('\r\nBEGIN:VTIMEZONE')[0];
  return body.split('\r\n');
}

/** The events by UID, each as { 'PROPERTY;PARAMS': value } */
function events(ics: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  for (const block of unfold(ics).split('BEGIN:VEVENT\r\n').slice(1)) {
    const props: Record<string, string> = {};
    for (const line of block.split('\r\nEND:VEVENT')[0].split('\r\n')) {
      const colon = line.indexOf(':');
      props[line.slice(0, colon)] = line.slice(colon + 1);
    }
    result.set(props.UID, props);
  }
  return result;
}

function event(ics: string, uid: string): Record<string, string> {
  const e = events(ics).get(`${uid}@admin.example`);
  if (!e) throw new Error(`no event ${uid}`);
  return e;
}

describe('the calendar', () => {
  it('has the calendar properties and the time zone', () => {
    const ics = feed();
    expect(calendarProps(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Adsumus//Trainingsplan//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'NAME:Alle Trainings (JAC Wohlen)',
      'X-WR-CALNAME:Alle Trainings (JAC Wohlen)',
      'X-WR-TIMEZONE:Europe/Zurich',
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      'X-PUBLISHED-TTL:PT6H'
    ]);
    expect(ics).toContain('\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Zurich\r\n');
    expect(ics.endsWith('\r\nEND:VCALENDAR\r\n')).toBe(true);
  });

  it('names the calendar per kind and language, without the club when there is none', () => {
    expect(calendarProps(feed({ kind: 'mine' }))).toContain('NAME:Meine Trainings (JAC Wohlen)');
    expect(calendarProps(feed({ clubName: null }))).toContain('X-WR-CALNAME:Alle Trainings');
    expect(calendarProps(feed({ clubName: '  ' }))).toContain('NAME:Alle Trainings');
    const en = calendarProps(feed({ locale: 'en', clubName: 'Judo Club, Bern' }));
    expect(en).toContain('PRODID:-//Adsumus//Trainingsplan//EN');
    expect(en).toContain('NAME:All trainings (Judo Club\\, Bern)');
    expect(calendarProps(feed({ locale: 'en', kind: 'mine', clubName: undefined }))).toContain(
      'X-WR-CALNAME:My trainings'
    );
  });

  it('uses CRLF everywhere and lines of at most 75 octets', () => {
    const long = 'Übungsformen für Würfe – Seoi-nage, Uchi-mata und Kombinationen 🥋 '.repeat(4);
    const ics = feed({}, data({ sessions: [session({ topic: long, trainer_id: 12 })] }));
    expect(ics).not.toMatch(/[^\r]\n|\r[^\n]/);
    const lines = ics.split('\r\n').slice(0, -1);
    expect(lines.every((l) => octets(l) <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
    expect(event(ics, 'all-26-20261104').SUMMARY).toBe(
      `Judo Randori: ${long.trim().replace(/,/g, '\\,')} – Anna Muster`
    );
  });

  it('has one event per training date in the window, nothing per attendee or status', () => {
    const ics = feed();
    const all = [...events(ics).values()];
    // 60 Wednesdays and 60 Tuesdays from 2026-09-04 to 2027-10-30
    expect(all.filter((e) => e.UID.startsWith('all-26-'))).toHaveLength(60);
    expect(all.filter((e) => e.UID.startsWith('all-42-'))).toHaveLength(60);
    expect(new Set(all.map((e) => e.UID)).size).toBe(all.length);
    expect(ics).not.toMatch(/^(STATUS|SEQUENCE|LOCATION|ATTENDEE|ORGANIZER|RRULE:FREQ=WEEKLY)/m);
  });
});

describe('summaries', () => {
  it('all: title, topic and trainer', () => {
    const ics = feed();
    expect(event(ics, 'all-26-20261104').SUMMARY).toBe('Judo Randori: Fallschule – Anna Muster');
    // Main trainer as the default
    expect(event(ics, 'all-26-20261209').SUMMARY).toBe('Judo Randori – Beat Beispiel');
    // No session, no main trainer
    expect(event(ics, 'all-42-20261110').SUMMARY).toBe('Judo Kinder – Trainer offen');
  });

  it('mine: the dates the member leads, title and topic', () => {
    const anna = feed({ kind: 'mine' });
    expect([...events(anna).keys()]).toEqual([
      'mine-26-20261104@admin.example',
      'mine-42-20261229@admin.example'
    ]);
    expect(event(anna, 'mine-26-20261104').SUMMARY).toBe('Judo Randori: Fallschule');
    expect(event(anna, 'mine-42-20261229').SUMMARY).toBe('Judo Kinder: Weihnachtstraining');

    // The main trainer gets the other dates, cancelled ones included
    const beat = feed({ kind: 'mine' }, data({ member_ids: [34, 99] }));
    const uids = [...events(beat).keys()];
    expect(uids).toHaveLength(59);
    expect(uids).not.toContain('mine-26-20261104@admin.example');
    expect(uids.every((u) => u.startsWith('mine-26-'))).toBe(true);
    expect(event(beat, 'mine-26-20261209').SUMMARY).toBe('Judo Randori');
    expect(event(beat, 'mine-26-20261111').SUMMARY).toBe(
      'Fällt aus: Judo Randori (Turnier in Bern)'
    );

    expect(events(feed({ kind: 'mine' }, data({ member_ids: [] }))).size).toBe(0);
  });

  it('cancelled by a break closing the dojo: its title as the reason', () => {
    const e = event(feed(), 'all-26-20261230');
    expect(e.SUMMARY).toBe('Fällt aus: Judo Randori (Weihnachten)');
    expect(e.DESCRIPTION).not.toContain('Ferien');
    expect(e.TRANSP).toBe('TRANSPARENT');
  });

  it('cancelled by the session: its notes as the reason', () => {
    const ics = feed();
    expect(event(ics, 'all-26-20261111').SUMMARY).toBe('Fällt aus: Judo Randori (Turnier in Bern)');
    expect(event(ics, 'all-26-20261118').SUMMARY).toBe('Fällt aus: Judo Randori');
    const multiline = feed(
      {},
      data({ sessions: [session({ cancelled: true, notes: 'Halle\nbesetzt' })] })
    );
    expect(event(multiline, 'all-26-20261104').SUMMARY).toBe(
      'Fällt aus: Judo Randori (Halle besetzt)'
    );
  });

  it('cancelled without a trainer: no open trainer in the description', () => {
    // The kids' training has no main trainer, and nobody is planned for the date
    const ics = feed(
      {},
      data({ sessions: [session({ training_id: kids.id, date: '2026-11-03', cancelled: true })] })
    );
    const e = event(ics, 'all-42-20261103');
    expect(e.SUMMARY).toBe('Fällt aus: Judo Kinder');
    expect(e.DESCRIPTION).not.toContain('Trainer offen');
    expect(e.DESCRIPTION).not.toContain('Leitung');
  });

  it('held despite a break closing the dojo', () => {
    const e = event(feed(), 'all-42-20261229');
    expect(e.SUMMARY).toBe('Judo Kinder: Weihnachtstraining – Anna Muster');
    expect(e.DESCRIPTION).toContain('Ferien: Weihnachten');
    expect(event(feed({ kind: 'mine' }), 'mine-42-20261229').TRANSP).toBe('OPAQUE');
  });

  it('school holidays: held, the holidays in the description', () => {
    const e = event(feed(), 'all-26-20270210');
    expect(e.SUMMARY).toBe('Judo Randori – Beat Beispiel');
    expect(e.DESCRIPTION).toBe(
      'Leitung: Beat Beispiel\\nFerien: Sportferien\\n' +
        'Check-in: https://admin.example/dashboard/trainings/26/2027-02-10'
    );
  });
});

describe('event details', () => {
  it('describes topic, trainer, notes and the check-in link', () => {
    const ics = feed();
    const e = event(ics, 'all-26-20261104');
    expect(e.DESCRIPTION).toBe(
      'Thema: Fallschule\\nLeitung: Anna Muster\\n' +
        'Check-in: https://admin.example/dashboard/trainings/26/2026-11-04'
    );
    expect(e.URL).toBe('https://admin.example/dashboard/trainings/26/2026-11-04');
    expect(event(ics, 'all-26-20261125').DESCRIPTION).toBe(
      'Leitung: Beat Beispiel\\nBemerkung: Gäste aus Wohlen\\,\\nbitte Matten\\; früher\\n' +
        'Check-in: https://admin.example/dashboard/trainings/26/2026-11-25'
    );
    expect(event(ics, 'all-42-20261110').DESCRIPTION).toBe(
      'Leitung: Trainer offen\\nCheck-in: https://admin.example/dashboard/trainings/42/2026-11-10'
    );
  });

  it('writes the texts in English for the English feeds', () => {
    const ics = feed({ locale: 'en' });
    expect(event(ics, 'all-26-20261104').DESCRIPTION).toBe(
      'Topic: Fallschule\\nLed by: Anna Muster\\n' +
        'Check-in: https://admin.example/dashboard/trainings/26/2026-11-04'
    );
    expect(event(ics, 'all-26-20261230').SUMMARY).toBe('Cancelled: Judo Randori (Weihnachten)');
    expect(event(ics, 'all-42-20261110').SUMMARY).toBe('Judo Kinder – Trainer open');
    expect(event(ics, 'all-26-20261125').DESCRIPTION).toContain('Note: Gäste aus Wohlen');
    expect(event(ics, 'all-26-20270210').DESCRIPTION).toContain('Holidays: Sportferien');
    expect(ics).not.toMatch(/Fällt aus|Leitung|Thema|Ferien/);
  });

  it('uses the training times, Europe/Zurich, "18.00" and "18:00"', () => {
    const ics = feed();
    expect(event(ics, 'all-26-20261104')).toMatchObject({
      'DTSTART;TZID=Europe/Zurich': '20261104T200000',
      'DTEND;TZID=Europe/Zurich': '20261104T213000'
    });
    expect(event(ics, 'all-42-20261103')).toMatchObject({
      'DTSTART;TZID=Europe/Zurich': '20261103T183000',
      'DTEND;TZID=Europe/Zurich': '20261103T200000'
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['invalid', 'open end'],
    ['not after the start', '19:00'],
    ['equal to the start', '20.00']
  ])('lasts 90 minutes when the end time is %s', (_, dateTo) => {
    const e = event(feed({}, data({ trainings: [{ ...randori, dateTo }] })), 'all-26-20261104');
    expect(e['DTSTART;TZID=Europe/Zurich']).toBe('20261104T200000');
    expect(e['DTEND;TZID=Europe/Zurich']).toBe('20261104T213000');
  });

  it('runs into the next day when 90 minutes pass midnight', () => {
    const late = { ...randori, dateFrom: '23.15', dateTo: null };
    const e = event(feed({}, data({ trainings: [late] })), 'all-26-20261230');
    expect(e['DTSTART;TZID=Europe/Zurich']).toBe('20261230T231500');
    expect(e['DTEND;TZID=Europe/Zurich']).toBe('20261231T004500');
  });

  it.each([
    ['missing', ''],
    ['invalid', 'abends'],
    ['out of range', '25:00']
  ])('is an all-day event when the start time is %s', (_, dateFrom) => {
    const e = event(feed({}, data({ trainings: [{ ...randori, dateFrom }] })), 'all-26-20261104');
    expect(e['DTSTART;VALUE=DATE']).toBe('20261104');
    expect(e['DTEND;VALUE=DATE']).toBe('20261105');
    expect(Object.keys(e).some((k) => k.includes('TZID'))).toBe(false);
  });

  it('keeps the local times on both sides of a DST switch', () => {
    const ics = feed();
    for (const date of ['20261021', '20261028', '20270324', '20270331']) {
      expect(event(ics, `all-26-${date}`)).toMatchObject({
        'DTSTART;TZID=Europe/Zurich': `${date}T200000`,
        'DTEND;TZID=Europe/Zurich': `${date}T213000`
      });
    }
  });

  it('stamps the events with now and leaves LAST-MODIFIED out', () => {
    // A break or the training can change an event without touching its session
    const ics = feed();
    expect(event(ics, 'all-26-20261104')).toMatchObject({ DTSTAMP: '20261030T100000Z' });
    expect(ics).not.toMatch(/^LAST-MODIFIED/m);
  });

  it('marks time as busy only for own trainings that are held', () => {
    const all = [...events(feed()).values()];
    expect(all.every((e) => e.TRANSP === 'TRANSPARENT')).toBe(true);
    const beat = feed({ kind: 'mine' }, data({ member_ids: [34] }));
    expect(event(beat, 'mine-26-20261209').TRANSP).toBe('OPAQUE');
    expect(event(beat, 'mine-26-20261111').TRANSP).toBe('TRANSPARENT');
    expect(event(beat, 'mine-26-20261230').TRANSP).toBe('TRANSPARENT');
  });
});

describe('UIDs', () => {
  it('are kind, training and date at the app host', () => {
    expect(events(feed()).has('all-26-20261104@admin.example')).toBe(true);
    expect(events(feed({ kind: 'mine' })).has('mine-26-20261104@admin.example')).toBe(true);
    expect(
      events(feed({ origin: 'http://localhost:5173/' })).has('all-26-20261104@localhost:5173')
    ).toBe(true);
  });

  it('stay the same when language, time, topic, trainer or cancellation change', () => {
    const uids = (ics: string) => [...events(ics).keys()];
    const before = uids(feed());
    expect(uids(feed({ locale: 'en' }))).toEqual(before);
    expect(uids(feed({ now: new Date('2026-10-30T18:00:00Z') }))).toEqual(before);
    expect(
      uids(
        feed(
          {},
          data({
            sessions: [session({ trainer_id: 34, topic: 'Bodenarbeit', cancelled: true })],
            breaks: []
          })
        )
      )
    ).toEqual(before);
  });
});

describe('the window', () => {
  // A Thursday training tells the first day of the window apart
  const thursday: FeedTraining = { ...randori, id: 7, weekday: 'Thursday' };
  const dates = (n: Date) =>
    [...events(feed({ now: n }, data({ trainings: [thursday] }))).keys()].map((u) =>
      u.slice(6, 14)
    );

  it('covers 8 weeks back and 12 months ahead of today in Zurich', () => {
    // 2026-10-29 in Zurich (23:59 CET)
    const thu = dates(new Date('2026-10-29T22:59:00Z'));
    expect(thu[0]).toBe('20260903');
    expect(thu.at(-1)).toBe('20271028');
    // Already 2026-10-30 in Zurich (00:30 CET), still the 29th in UTC
    const fri = dates(new Date('2026-10-29T23:30:00Z'));
    expect(fri[0]).toBe('20260910');
    expect(fri.at(-1)).toBe('20271028');
  });

  it('zurichToday follows the Zurich date, summer and winter', () => {
    expect(zurichToday(new Date('2026-10-29T22:59:00Z'))).toBe('2026-10-29');
    expect(zurichToday(new Date('2026-10-29T23:00:00Z'))).toBe('2026-10-30');
    expect(zurichToday(new Date('2026-06-30T21:59:00Z'))).toBe('2026-06-30');
    expect(zurichToday(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07-01');
    expect(zurichToday(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});

describe('feed names and links', () => {
  it('parses the four feed names', () => {
    expect(parseFeedName('meine')).toEqual({ kind: 'mine', locale: 'de' });
    expect(parseFeedName('alle')).toEqual({ kind: 'all', locale: 'de' });
    expect(parseFeedName('mine')).toEqual({ kind: 'mine', locale: 'en' });
    expect(parseFeedName('all')).toEqual({ kind: 'all', locale: 'en' });
    for (const name of ['', 'Alle', 'alle.ics', 'feed', 'toString', '__proto__', 'de', 'mine ']) {
      expect(parseFeedName(name)).toBeNull();
    }
  });

  it('builds the https, webcal and Google links', () => {
    const url = calendarFeedUrl('https://admin.example//', token, 'all', 'de');
    expect(url).toBe(`https://admin.example/api/calendar/${token}/alle.ics`);
    expect(calendarFeedUrl('https://admin.example', token, 'mine', 'de')).toBe(
      `https://admin.example/api/calendar/${token}/meine.ics`
    );
    expect(calendarFeedUrl('https://admin.example', token, 'mine', 'en')).toMatch(/\/mine\.ics$/);
    expect(calendarFeedUrl('https://admin.example', token, 'all', 'en')).toMatch(/\/all\.ics$/);
    expect(webcalUrl(url)).toBe(`webcal://admin.example/api/calendar/${token}/alle.ics`);
    expect(webcalUrl('http://localhost:5173/x.ics')).toBe('webcal://localhost:5173/x.ics');
    expect(googleCalendarUrl(url)).toBe(
      'https://calendar.google.com/calendar/render?cid=' +
        `webcal%3A%2F%2Fadmin.example%2Fapi%2Fcalendar%2F${token}%2Falle.ics`
    );
  });

  it('links to feeds the endpoint understands', () => {
    for (const kind of ['mine', 'all'] as const) {
      for (const locale of ['de', 'en'] as const) {
        const name = /\/([^/]+)\.ics$/.exec(calendarFeedUrl('https://x.ch', token, kind, locale));
        expect(parseFeedName(name?.[1] ?? '')).toEqual({ kind, locale });
      }
    }
  });
});
