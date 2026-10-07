import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRIAL_MAIL_TEMPLATES,
  TRIAL_MAIL_KINDS,
  TRIAL_MAIL_LOCALES,
  TRIAL_MAIL_PLACEHOLDERS,
  formatTrainingLines,
  formatTrialDate,
  renderTrialMail,
  trialMailLocale,
  trialMailSettingKey,
  trialMailTemplate,
  trialStatusUrl,
  buildTrialMailVars,
  type TrialMailVars
} from './trialMail';

const vars: TrialMailVars = {
  firstname: 'Noah',
  lastname: 'Keller',
  club: 'JAC Wohlen',
  clubUrl: 'https://jacwohlen.ch',
  contactEmail: 'info@jacwohlen.ch',
  trainings: '- Donnerstag, 18:00–19:15: Judo Kinder',
  statusLink: 'https://admin.example/probetraining/status/abc'
};

describe('trialMailTemplate', () => {
  it('uses the built-in template without overrides', () => {
    expect(trialMailTemplate({}, 'waitlist', 'de')).toEqual(
      DEFAULT_TRIAL_MAIL_TEMPLATES.waitlist.de
    );
  });

  it('applies overrides per part and ignores blank ones', () => {
    const values = {
      [trialMailSettingKey('welcome', 'en', 'subject')]: 'Hello {firstname}',
      [trialMailSettingKey('welcome', 'en', 'body')]: '   '
    };
    const t = trialMailTemplate(values, 'welcome', 'en');
    expect(t.subject).toBe('Hello {firstname}');
    expect(t.body).toBe(DEFAULT_TRIAL_MAIL_TEMPLATES.welcome.en.body);
  });

  it('ignores malformed overrides', () => {
    const values = { [trialMailSettingKey('assigned', 'de', 'subject')]: 42 };
    expect(trialMailTemplate(values, 'assigned', 'de').subject).toBe(
      DEFAULT_TRIAL_MAIL_TEMPLATES.assigned.de.subject
    );
  });
});

describe('renderTrialMail', () => {
  it('fills placeholders and leaves unknown ones alone', () => {
    const out = renderTrialMail(
      { subject: 'Hi {firstname} {lastname}', body: '{club}: {trainings}\n{unknown}' },
      vars
    );
    expect(out.subject).toBe('Hi Noah Keller');
    expect(out.body).toBe('JAC Wohlen: - Donnerstag, 18:00–19:15: Judo Kinder\n{unknown}');
  });

  it('keeps the subject on one line', () => {
    const out = renderTrialMail(
      { subject: 'Training: {trainings}', body: '' },
      {
        ...vars,
        trainings: '- A\n- B'
      }
    );
    expect(out.subject).toBe('Training: - A - B');
  });

  it('only uses known placeholders in the built-in templates', () => {
    const known = new Set<string>(TRIAL_MAIL_PLACEHOLDERS);
    for (const kind of TRIAL_MAIL_KINDS) {
      for (const locale of TRIAL_MAIL_LOCALES) {
        const t = DEFAULT_TRIAL_MAIL_TEMPLATES[kind][locale];
        for (const [, name] of `${t.subject} ${t.body}`.matchAll(/\{(\w+)\}/g)) {
          expect(known.has(name), `${kind}.${locale}: {${name}}`).toBe(true);
        }
      }
    }
  });
});

describe('formatTrainingLines', () => {
  it('lists trainings with localized weekday and time range', () => {
    const lines = formatTrainingLines(
      [
        { title: 'Judo Kinder', weekday: 'Thursday', dateFrom: '18:00', dateTo: '19:15' },
        {
          title: 'Randori',
          weekday: 'Wednesday',
          dateFrom: '20:00',
          dateTo: '21:30',
          section: 'Judo'
        }
      ],
      'de'
    );
    expect(lines).toBe(
      '- Donnerstag, 18:00–19:15: Judo Kinder\n- Mittwoch, 20:00–21:30: Randori (Judo)'
    );
  });

  it('uses English weekdays', () => {
    expect(
      formatTrainingLines(
        [{ title: 'Aikido', weekday: 'Tuesday', dateFrom: '19:00', dateTo: '' }],
        'en'
      )
    ).toBe('- Tuesday, 19:00: Aikido');
  });

  it('adds the first session while it is still ahead', () => {
    const t = {
      title: 'Judo Kids',
      weekday: 'Friday',
      dateFrom: '17:00',
      dateTo: '18:00',
      startDate: '2026-10-16'
    };
    const now = new Date(2026, 9, 6);
    expect(formatTrainingLines([t], 'de', now)).toBe(
      '- Freitag, 17:00–18:00: Judo Kids – erstes Training am Freitag, 16.10.2026'
    );
    expect(formatTrainingLines([t], 'en', now)).toBe(
      '- Friday, 17:00–18:00: Judo Kids – first session on Friday, 16 October 2026'
    );
    expect(formatTrainingLines([t], 'de', new Date(2026, 9, 17))).toBe(
      '- Freitag, 17:00–18:00: Judo Kids'
    );
  });
});

describe('formatTrainingLines with a main trainer', () => {
  const t = { title: 'Judo Kids', weekday: 'Friday', dateFrom: '17:00', dateTo: '18:00' };

  it('adds the trainer contact on an indented line', () => {
    const mainTrainer = {
      firstname: 'Anna',
      lastname: 'Muster',
      mobile: '079 123 45 67',
      email: 'anna@example.ch'
    };
    expect(formatTrainingLines([{ ...t, mainTrainer }], 'de')).toBe(
      '- Freitag, 17:00–18:00: Judo Kids\n  Ansprechperson: Anna Muster, 079 123 45 67, anna@example.ch'
    );
    expect(formatTrainingLines([{ ...t, mainTrainer }], 'en')).toBe(
      '- Friday, 17:00–18:00: Judo Kids\n  Your contact: Anna Muster, 079 123 45 67, anna@example.ch'
    );
  });

  it('leaves out missing contact details', () => {
    expect(
      formatTrainingLines(
        [{ ...t, mainTrainer: { firstname: 'Anna', lastname: 'Muster', mobile: null, email: '' } }],
        'de'
      )
    ).toBe('- Freitag, 17:00–18:00: Judo Kids\n  Ansprechperson: Anna Muster');
  });
});

describe('formatTrialDate', () => {
  it('formats a date with its weekday', () => {
    expect(formatTrialDate('2026-10-11', 'de')).toBe('Sonntag, 11.10.2026');
    expect(formatTrialDate('2026-10-05', 'en')).toBe('Monday, 5 October 2026');
    expect(formatTrialDate('nope', 'de')).toBeNull();
  });
});

describe('trialMailLocale', () => {
  it('prefers the registration language', () => {
    expect(trialMailLocale('en', 'de')).toBe('en');
    expect(trialMailLocale(null, 'de')).toBe('de');
    expect(trialMailLocale('fr', 'en')).toBe('en');
  });
});

describe('trialStatusUrl', () => {
  it('builds the status page link', () => {
    expect(trialStatusUrl('https://admin.example/', 'abc')).toBe(
      'https://admin.example/probetraining/status/abc'
    );
  });

  it('falls back to the site without a token', () => {
    expect(trialStatusUrl('https://admin.example', null)).toBe('https://admin.example');
  });
});

describe('buildTrialMailVars', () => {
  const club = { name: 'JAC Wohlen', url: 'https://jacwohlen.ch', contactEmail: null };

  it('points to the website without a contact address', () => {
    const v = buildTrialMailVars({ firstname: 'A', lastname: 'B' }, club, [], 'de', 'L');
    expect(v.contactEmail).toBe('https://jacwohlen.ch');
    expect(v.statusLink).toBe('L');
  });

  it('puts the status link into every built-in template', () => {
    for (const kind of TRIAL_MAIL_KINDS) {
      for (const locale of TRIAL_MAIL_LOCALES) {
        expect(DEFAULT_TRIAL_MAIL_TEMPLATES[kind][locale].body, `${kind}.${locale}`).toContain(
          '{statusLink}'
        );
      }
    }
  });
});
