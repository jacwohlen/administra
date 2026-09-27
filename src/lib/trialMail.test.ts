import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRIAL_MAIL_TEMPLATES,
  TRIAL_MAIL_KINDS,
  TRIAL_MAIL_LOCALES,
  TRIAL_MAIL_PLACEHOLDERS,
  formatTrainingLines,
  renderTrialMail,
  trialMailLocale,
  trialMailSettingKey,
  trialMailTemplate,
  type TrialMailVars
} from './trialMail';

const vars: TrialMailVars = {
  firstname: 'Noah',
  lastname: 'Keller',
  club: 'JAC Wohlen',
  clubUrl: 'https://jacwohlen.ch',
  contactEmail: 'info@jacwohlen.ch',
  trainings: '- Donnerstag, 18:00–19:15: Judo Kinder'
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
});

describe('trialMailLocale', () => {
  it('prefers the registration language', () => {
    expect(trialMailLocale('en', 'de')).toBe('en');
    expect(trialMailLocale(null, 'de')).toBe('de');
    expect(trialMailLocale('fr', 'en')).toBe('en');
  });
});
