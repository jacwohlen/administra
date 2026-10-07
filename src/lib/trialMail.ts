/**
 * E-mails to trial candidates: built-in templates, admin overrides from
 * `app_settings`, and placeholder rendering.
 *
 * Pure on purpose (no SvelteKit or Supabase imports) so the dashboard
 * preview, the registration endpoint and the unit tests all render mails
 * the same way.
 */

import type { PublicLocale } from './clubConfigParser';
import type { SettingValues } from './appSettingsParser';

export type TrialMailKind = 'welcome' | 'waitlist' | 'assigned';

export const TRIAL_MAIL_KINDS: TrialMailKind[] = ['welcome', 'waitlist', 'assigned'];
export const TRIAL_MAIL_LOCALES: PublicLocale[] = ['de', 'en'];

export interface TrialMailTemplate {
  subject: string;
  body: string;
}

/** Placeholders a template may use, written as `{name}`. */
export const TRIAL_MAIL_PLACEHOLDERS = [
  'firstname',
  'lastname',
  'club',
  'clubUrl',
  'contactEmail',
  'trainings',
  'statusLink'
] as const;

export type TrialMailVars = Record<(typeof TRIAL_MAIL_PLACEHOLDERS)[number], string>;

export const DEFAULT_TRIAL_MAIL_TEMPLATES: Record<
  TrialMailKind,
  Record<PublicLocale, TrialMailTemplate>
> = {
  welcome: {
    de: {
      subject: 'Danke für deine Anmeldung zum Probetraining – {club}',
      body: `Hallo {firstname}

Vielen Dank für deine Anmeldung zum Probetraining beim {club}! Wir haben sie erhalten und melden uns bald bei dir.

Sobald ein Platz in einem passenden Training frei ist, schicken wir dir alle Infos: wann und wo das Training stattfindet und was du mitbringen solltest.

Den Stand deiner Anmeldung siehst du jederzeit hier – dort kannst du dich auch wieder abmelden:
{statusLink}

Bei Fragen erreichst du uns unter {contactEmail}.

Sportliche Grüsse
{club}`
    },
    en: {
      subject: 'Thank you for registering for a trial session – {club}',
      body: `Hi {firstname}

Thank you for registering for a trial session at {club}! We have received your registration and will be in touch soon.

As soon as there is a place in a suitable training, we will send you all the details: when and where it takes place and what to bring.

You can check the status of your registration at any time here – and cancel it there if your plans change:
{statusLink}

If you have any questions, reach us at {contactEmail}.

Best regards
{club}`
    }
  },
  waitlist: {
    de: {
      subject: 'Du bist auf der Warteliste – {club}',
      body: `Hallo {firstname}

Danke für dein Interesse am Probetraining beim {club}. Im Moment sind unsere Trainings leider voll, deshalb haben wir dich auf die Warteliste gesetzt.

Meistens werden nach den Schulferien wieder Plätze frei. Wir schauen die Warteliste in den Ferien durch und melden uns, sobald wir dich einem Training zuteilen können – du musst nichts weiter tun.

Den aktuellen Stand siehst du jederzeit hier. Falls du kein Interesse mehr hast, kannst du dich dort abmelden, damit dein Platz frei wird:
{statusLink}

Bei Fragen erreichst du uns unter {contactEmail}.

Sportliche Grüsse
{club}`
    },
    en: {
      subject: 'You are on the waiting list – {club}',
      body: `Hi {firstname}

Thank you for your interest in a trial session at {club}. Unfortunately our trainings are full at the moment, so we have put you on the waiting list.

Places usually open up again after the school holidays. We review the waiting list during the holidays and will get in touch as soon as we can assign you to a training – there is nothing else you need to do.

You can check the current status at any time here. If you are no longer interested, you can cancel there so your place goes to someone else:
{statusLink}

If you have any questions, reach us at {contactEmail}.

Best regards
{club}`
    }
  },
  assigned: {
    de: {
      subject: 'Dein Probetraining beim {club}',
      body: `Hallo {firstname}

Wir freuen uns, dich im Probetraining begrüssen zu dürfen! Du kannst in folgendem Training vorbeikommen:

{trainings}

Bitte komm etwa 10 Minuten vor Beginn, damit wir dich in Ruhe empfangen können. Für die ersten Male reichen bequeme Sportkleidung und etwas zu trinken.

Die Angaben zu deinem Training findest du jederzeit auch hier:
{statusLink}

Bei Fragen erreichst du uns unter {contactEmail}.

Sportliche Grüsse
{club}`
    },
    en: {
      subject: 'Your trial session at {club}',
      body: `Hi {firstname}

We look forward to welcoming you to a trial session! You are welcome to join the following training:

{trainings}

Please arrive about 10 minutes early so we can welcome you properly. For the first few times, comfortable sportswear and something to drink are all you need.

You can find the details of your training at any time here:
{statusLink}

If you have any questions, reach us at {contactEmail}.

Best regards
{club}`
    }
  }
};

/** `app_settings` key of one template part, e.g. `trialMail.welcome.de.subject`. */
export function trialMailSettingKey(
  kind: TrialMailKind,
  locale: PublicLocale,
  part: keyof TrialMailTemplate
): string {
  return `trialMail.${kind}.${locale}.${part}`;
}

/** Built-in template with any admin override from `app_settings` applied per part. */
export function trialMailTemplate(
  values: SettingValues,
  kind: TrialMailKind,
  locale: PublicLocale
): TrialMailTemplate {
  const base = DEFAULT_TRIAL_MAIL_TEMPLATES[kind][locale];
  const pick = (part: keyof TrialMailTemplate) => {
    const value = values[trialMailSettingKey(kind, locale, part)];
    return typeof value === 'string' && value.trim() ? value : base[part];
  };
  return { subject: pick('subject'), body: pick('body') };
}

/** Replaces `{name}` placeholders; unknown ones are left as written. */
export function renderTrialMail(
  template: TrialMailTemplate,
  vars: TrialMailVars
): TrialMailTemplate {
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name as keyof TrialMailVars] : match
    );
  // A subject is one line, whatever a placeholder contained.
  return {
    subject: fill(template.subject)
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
    body: fill(template.body)
  };
}

const WEEKDAYS: Record<PublicLocale, Record<string, string>> = {
  de: {
    Monday: 'Montag',
    Tuesday: 'Dienstag',
    Wednesday: 'Mittwoch',
    Thursday: 'Donnerstag',
    Friday: 'Freitag',
    Saturday: 'Samstag',
    Sunday: 'Sonntag'
  },
  en: {
    Monday: 'Monday',
    Tuesday: 'Tuesday',
    Wednesday: 'Wednesday',
    Thursday: 'Thursday',
    Friday: 'Friday',
    Saturday: 'Saturday',
    Sunday: 'Sunday'
  }
};

export interface MailTraining {
  title: string;
  weekday: string;
  dateFrom: string;
  dateTo: string;
  section?: string;
  /** First trial session (YYYY-MM-DD), picked when the training was assigned. */
  startDate?: string | null;
  /** The training's main trainer, the candidate's contact from now on. */
  mainTrainer?: {
    firstname: string;
    lastname: string;
    mobile?: string | null;
    email?: string | null;
  } | null;
}

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/** "Freitag, 17.10.2026" / "Friday, 17 October 2026"; null for anything but YYYY-MM-DD. */
export function formatTrialDate(iso: string, locale: PublicLocale): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const weekday = Object.keys(WEEKDAYS.en)[(new Date(+y, +m - 1, +d).getDay() + 6) % 7];
  const day = WEEKDAYS[locale][weekday];
  return locale === 'de'
    ? `${day}, ${d}.${m}.${y}`
    : `${day}, ${Number(d)} ${MONTHS_EN[Number(m) - 1]} ${y}`;
}

function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * One line per training: "Donnerstag, 18:00–19:15: Judo Kinder (Judo)",
 * followed by the first session when one was picked and it is still ahead,
 * and an indented line with the main trainer's contact when one is set.
 */
export function formatTrainingLines(
  trainings: MailTraining[],
  locale: PublicLocale,
  now: Date = new Date()
): string {
  const today = localIsoDate(now);
  return trainings
    .map((t) => {
      const day = WEEKDAYS[locale][t.weekday] ?? t.weekday;
      const time = [t.dateFrom, t.dateTo].filter(Boolean).join('–');
      const section = t.section && !t.title.includes(t.section) ? ` (${t.section})` : '';
      const start =
        t.startDate && t.startDate >= today ? formatTrialDate(t.startDate, locale) : null;
      const first = start
        ? locale === 'de'
          ? ` – erstes Training am ${start}`
          : ` – first session on ${start}`
        : '';
      const trainer = t.mainTrainer
        ? [
            `${t.mainTrainer.firstname} ${t.mainTrainer.lastname}`.trim(),
            t.mainTrainer.mobile?.trim(),
            t.mainTrainer.email?.trim()
          ]
            .filter(Boolean)
            .join(', ')
        : '';
      const contact = trainer
        ? `\n  ${locale === 'de' ? 'Ansprechperson' : 'Your contact'}: ${trainer}`
        : '';
      return `- ${day}, ${time}: ${t.title}${section}${first}${contact}`;
    })
    .join('\n');
}

/** The mail language: the one the candidate registered in, else the club default. */
export function trialMailLocale(
  registered: string | null | undefined,
  fallback: PublicLocale
): PublicLocale {
  return registered === 'de' || registered === 'en' ? registered : fallback;
}

export interface MailClub {
  name: string;
  url: string;
  contactEmail: string | null;
}

/** Link to the candidate's public status page (/probetraining/status/<token>). */
export function trialStatusUrl(origin: string, token: string | null | undefined): string {
  return token ? `${origin.replace(/\/+$/, '')}/probetraining/status/${token}` : origin;
}

/**
 * Placeholder values for one candidate. Without a contact address, mails
 * point to the website; without a status link, to the site the mail came from.
 */
export function buildTrialMailVars(
  member: { firstname: string; lastname: string },
  club: MailClub,
  trainings: MailTraining[],
  locale: PublicLocale,
  statusLink = ''
): TrialMailVars {
  return {
    statusLink,
    firstname: member.firstname,
    lastname: member.lastname,
    club: club.name,
    clubUrl: club.url,
    contactEmail: club.contactEmail || club.url,
    trainings: formatTrainingLines(trainings, locale)
  };
}
