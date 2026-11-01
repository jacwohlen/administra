/**
 * The texts of the plan mails (src/lib/trainingPlanMail.ts), German and
 * English: the lines per training, compressed, and the mail around them.
 *
 * Plain TS like src/lib/trialMail.ts and the feed's TEXTS: the server renders
 * the mail in the sender's language, and the global svelte-i18n locale it
 * sets per request is not safe to translate with there. Pure, so the dialog
 * shows exactly the text the server sends.
 */

import { addDays } from './calendarFeed';
import {
  COMPRESS_OVER,
  type DateLineKind,
  type MailLocale,
  type MemberNotice,
  type NoticeLine,
  type Schedule,
  type TrainingNotice
} from './trainingPlanMail';

export type DisplayLine =
  | { type: 'line'; line: NoticeLine }
  /** More than COMPRESS_OVER dates of one kind */
  | { type: 'range'; kind: DateLineKind; dates: string[] }
  /** Two or more dates dropped for the same break */
  | { type: 'break'; reason: string; dates: string[] };

export interface MailContext {
  locale: MailLocale;
  /** From the settings; left out when empty */
  clubName: string;
  /** The app's origin, for the link to the plan */
  origin: string;
  /** Who sends it; replies go to them */
  senderName: string;
}

const WEEKDAYS: Record<MailLocale, Record<string, string>> = {
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

// Sunday first, as Date.getUTCDay() counts
const SHORT_DAYS: Record<MailLocale, string[]> = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
};

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** What the greeting and the footer depend on */
interface Plural {
  overview: boolean;
  several: boolean;
  sender: string;
}

const TEXTS = {
  de: {
    topic: (topic: string) => ` (Thema: ${topic})`,
    mainNew: 'Du bist neu Haupttrainer/in und leitest alle Termine',
    // The first message to a trainer is an overview, not news
    mainIs: 'Du bist Haupttrainer/in und leitest alle Termine',
    mainNewExcept: ', ausser:',
    mainGone: 'Du bist nicht mehr Haupttrainer/in.',
    trainingGone: 'Dieses Training ist nicht mehr im Trainingsplan.',
    schedule: (now: string, before: string) => `Neu am ${now} (bisher ${before}).`,
    lead: 'Neu: {date} – du leitest',
    youLead: 'Du leitest: {date}',
    notLead: 'Nicht mehr bei dir: {date}',
    otherLeads: 'Nicht bei dir: {date}',
    cancelled: 'Fällt aus: {date}',
    resumed: 'Findet wieder statt: {date} – du leitest',
    stillLead: 'Weiterhin bei dir: {date}',
    takesOver: (name: string) => ` – übernimmt ${name}`,
    ledBy: (name: string) => ` – leitet ${name}`,
    open: ' – Trainer offen',
    dropped: ' – fällt aus',
    rangeYouLead: 'Du leitest',
    range: {
      lead: 'Neu: du leitest',
      not_lead: 'Nicht mehr bei dir:',
      other_leads: 'Nicht bei dir:',
      still_lead: 'Weiterhin bei dir:',
      resumed: 'Findet wieder statt (du leitest):',
      cancelled: 'Fällt aus:'
    } satisfies Record<DateLineKind, string>,
    dates: (count: number) => `${count} Termine`,
    fromTo: (from: string, to: string) => `vom ${from} bis ${to}`,
    breakGroup: (reason: string) => `Fällt aus (${reason}):`,
    and: 'und',
    subject: (overview: boolean, names: string) =>
      `Trainingsplan: ${overview ? 'Übersicht' : 'Änderungen'} für ${names}`,
    hello: (names: string) => `Hallo ${names}`,
    intro: ({ overview, several }: Plural) =>
      overview
        ? `Hier ist ${several ? 'eure' : 'deine'} Übersicht aus dem Trainingsplan:`
        : `Im Trainingsplan hat sich für ${several ? 'euch' : 'dich'} etwas geändert:`,
    forMember: (name: string) => `Für ${name}:`,
    binding: (link: string) =>
      `Verbindlich ist der aktuelle Trainingsplan (mit Zugang zur App: ${link}).`,
    calendars:
      'Abonnierte Kalender («Meine Trainings») zeigen Änderungen erst nach einigen Stunden.',
    questions: ({ several, sender }: Plural) =>
      `Fragen, oder passt ${several ? 'euch' : 'dir'} ein Termin nicht? ` +
      `${several ? 'Antwortet' : 'Antworte'} auf diese Mail` +
      (sender ? `, sie geht an ${sender}.` : '.')
  },
  en: {
    topic: (topic: string) => ` (topic: ${topic})`,
    mainNew: 'You are now the main trainer and lead every date',
    mainIs: 'You are the main trainer and lead every date',
    mainNewExcept: ', except:',
    mainGone: 'You are no longer the main trainer.',
    trainingGone: 'This training is no longer in the training plan.',
    schedule: (now: string, before: string) => `Now on ${now} (before: ${before}).`,
    lead: 'New: {date} – you lead',
    youLead: 'You lead: {date}',
    notLead: 'No longer yours: {date}',
    otherLeads: 'Not yours: {date}',
    cancelled: 'Cancelled: {date}',
    resumed: 'Takes place again: {date} – you lead',
    stillLead: 'Still yours: {date}',
    takesOver: (name: string) => ` – ${name} takes over`,
    ledBy: (name: string) => ` – led by ${name}`,
    open: ' – trainer open',
    dropped: ' – cancelled',
    rangeYouLead: 'You lead',
    range: {
      lead: 'New: you lead',
      not_lead: 'No longer yours:',
      other_leads: 'Not yours:',
      still_lead: 'Still yours:',
      resumed: 'Takes place again (you lead):',
      cancelled: 'Cancelled:'
    } satisfies Record<DateLineKind, string>,
    dates: (count: number) => `${count} dates`,
    fromTo: (from: string, to: string) => `from ${from} to ${to}`,
    breakGroup: (reason: string) => `Cancelled (${reason}):`,
    and: 'and',
    subject: (overview: boolean, names: string) =>
      `Training plan: ${overview ? 'overview' : 'changes'} for ${names}`,
    hello: (names: string) => `Hello ${names}`,
    intro: ({ overview }: Plural) =>
      overview
        ? 'Here is your overview from the training plan:'
        : 'There are changes for you in the training plan:',
    forMember: (name: string) => `For ${name}:`,
    binding: (link: string) =>
      `The current training plan is binding (with access to the app: ${link}).`,
    calendars: 'Subscribed calendars ("My trainings") show changes only after a few hours.',
    questions: ({ sender }: Plural) =>
      'Questions, or a date that does not suit you? Reply to this mail' +
      (sender ? `; it goes to ${sender}.` : '.')
  }
};

/** On one line, for names, titles and topics */
const oneLine = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function parts(date: string): { y: number; m: number; d: number; day: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, day: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** The app's language as a mail language */
export function mailLocale(appLocale: string | null | undefined): MailLocale {
  return appLocale?.startsWith('de') ? 'de' : 'en';
}

/** "10.11.2026" / "10 Nov 2026" */
function plainDate(date: string, locale: MailLocale): string {
  const { y, m, d } = parts(date);
  return locale === 'de' ? `${d}.${m}.${y}` : `${d} ${MONTHS_EN[m - 1]} ${y}`;
}

/** "Mo 10.11.2026" / "Mon 10 Nov 2026" */
export function formatDate(date: string, locale: MailLocale): string {
  return `${SHORT_DAYS[locale][parts(date).day]} ${plainDate(date, locale)}`;
}

/**
 * "3.11., 17.11., 1.12.2026, 12.1.2027" / "3 Nov, 17 Nov, 1 Dec 2026, 12 Jan
 * 2027": the year after the last date of each year
 */
export function compactDates(dates: string[], locale: MailLocale): string {
  const sorted = [...dates].sort();
  return sorted
    .map((date, i) => {
      const { y, m, d } = parts(date);
      const last = i === sorted.length - 1 || parts(sorted[i + 1]).y !== y;
      if (locale === 'de') return `${d}.${m}.${last ? y : ''}`;
      return `${d} ${MONTHS_EN[m - 1]}${last ? ` ${y}` : ''}`;
    })
    .join(', ');
}

/** "Montag 18:00–19:30" / "Monday 18:00–19:30"; an unknown weekday as it is */
export function formatSchedule(s: Schedule, locale: MailLocale): string {
  const day = s.weekday ? (WEEKDAYS[locale][s.weekday] ?? s.weekday) : '';
  const time = s.timeFrom ? (s.timeTo ? `${s.timeFrom}–${s.timeTo}` : s.timeFrom) : '';
  return [day, time].filter(Boolean).join(' ');
}

/**
 * A training's lines as shown: training-level lines first, then by date;
 * more than COMPRESS_OVER dates of one kind become a range, two or more dates
 * dropped for the same break a group
 */
export function compressTraining(t: TrainingNotice): DisplayLine[] {
  const head: DisplayLine[] = [];
  const byKind = new Map<DateLineKind, NoticeLine[]>();
  const byReason = new Map<string, NoticeLine[]>();
  for (const line of t.lines) {
    if (!line.date) {
      head.push({ type: 'line', line });
    } else if (line.kind === 'cancelled' && line.reason) {
      byReason.set(line.reason, [...(byReason.get(line.reason) ?? []), line]);
    } else {
      const kind = line.kind as DateLineKind;
      byKind.set(kind, [...(byKind.get(kind) ?? []), line]);
    }
  }

  const items: DisplayLine[] = [];
  for (const [reason, lines] of byReason) {
    if (lines.length >= 2) items.push({ type: 'break', reason, dates: lines.map((l) => l.date!) });
    else items.push({ type: 'line', line: lines[0] });
  }
  for (const [kind, lines] of byKind) {
    if (lines.length > COMPRESS_OVER) {
      items.push({ type: 'range', kind, dates: lines.map((l) => l.date!) });
    } else {
      items.push(...lines.map((line): DisplayLine => ({ type: 'line', line })));
    }
  }
  const first = (item: DisplayLine) =>
    item.type === 'line' ? (item.line.date ?? '') : item.dates[0];
  return [...head, ...items.sort((a, b) => first(a).localeCompare(first(b)))];
}

function heading(t: TrainingNotice, locale: MailLocale): string {
  const title = oneLine(t.title);
  const schedule = t.schedule ? formatSchedule(t.schedule, locale) : '';
  return schedule ? `${title} (${schedule})` : title;
}

/** "8 Termine vom 6.10.2026 bis 24.11.2026" (dates sorted) */
function span(sorted: string[], locale: MailLocale): string {
  const t = TEXTS[locale];
  const [first, last] = [sorted[0], sorted[sorted.length - 1]];
  return `${t.dates(sorted.length)} ${t.fromTo(plainDate(first, locale), plainDate(last, locale))}`;
}

/**
 * "14 Termine: 3.11., 17.11., …": every date, however many (a rotation
 * planned a year ahead), as the mail is all a trainer without the app has
 */
function datesText(dates: string[], locale: MailLocale): string {
  const sorted = [...dates].sort();
  return `${TEXTS[locale].dates(sorted.length)}: ${compactDates(sorted, locale)}`;
}

/** One date a week without a gap: one stretch of a break */
function weekly(sorted: string[]): boolean {
  return sorted.every((date, i) => i === 0 || addDays(sorted[i - 1], 7) === date);
}

/**
 * One line as text. `overview`: the member's first message, where what they
 * lead is not news ("Du leitest", not "Neu")
 */
function lineText(line: NoticeLine, locale: MailLocale, more: boolean, overview: boolean): string {
  const t = TEXTS[locale];
  const date = line.date ? formatDate(line.date, locale) : '';
  const topic = line.topic ? t.topic(oneLine(line.topic)) : '';
  const other = line.other;
  switch (line.kind) {
    case 'main_new':
      return (overview ? t.mainIs : t.mainNew) + (more ? t.mainNewExcept : '.');
    case 'main_gone':
      return t.mainGone;
    case 'training_gone':
      return t.trainingGone;
    case 'schedule':
      return t.schedule(
        formatSchedule(line.schedule ?? { weekday: null, timeFrom: null, timeTo: null }, locale),
        formatSchedule(line.before ?? { weekday: null, timeFrom: null, timeTo: null }, locale)
      );
    case 'lead':
      return (overview ? t.youLead : t.lead).replace('{date}', date) + topic;
    case 'resumed':
      return t.resumed.replace('{date}', date) + topic;
    case 'still_lead':
      return t.stillLead.replace('{date}', date) + topic;
    case 'not_lead':
      return (
        t.notLead.replace('{date}', date) +
        (other == null
          ? ''
          : other === 'open'
            ? t.open
            : other === 'cancelled'
              ? t.dropped
              : t.takesOver(oneLine(other.name)))
      );
    case 'other_leads':
      return (
        t.otherLeads.replace('{date}', date) +
        (other == null || other === 'cancelled'
          ? ''
          : other === 'open'
            ? t.open
            : t.ledBy(oneLine(other.name)))
      );
    case 'cancelled':
      return (
        t.cancelled.replace('{date}', date) + (line.reason ? ` (${oneLine(line.reason)})` : '')
      );
  }
}

function displayText(
  item: DisplayLine,
  locale: MailLocale,
  more: boolean,
  overview: boolean
): string {
  const t = TEXTS[locale];
  switch (item.type) {
    case 'line':
      return lineText(item.line, locale, more, overview);
    case 'range': {
      const label = overview && item.kind === 'lead' ? t.rangeYouLead : t.range[item.kind];
      return `${label} ${datesText(item.dates, locale)}`;
    }
    case 'break': {
      const sorted = [...item.dates].sort();
      // One stretch of weekly dates: from-to once there are many; dates with
      // gaps (several breaks of the same name, a date held in between) each
      const list =
        sorted.length > COMPRESS_OVER && weekly(sorted)
          ? span(sorted, locale)
          : compactDates(sorted, locale);
      return `${t.breakGroup(oneLine(item.reason))} ${list}`;
    }
  }
}

/**
 * A member's trainings as text blocks: the heading ("Judo Jugend (Dienstag
 * 18:00–19:30)") and its lines, without a list marker. Every line: what a
 * mail leaves out would be stored as told all the same.
 */
export function memberBlocks(
  n: MemberNotice,
  locale: MailLocale
): { heading: string; lines: string[] }[] {
  return n.trainings.map((training) => {
    const items = compressTraining(training);
    return {
      heading: heading(training, locale),
      lines: items.map((item, i) => displayText(item, locale, i < items.length - 1, n.firstTime))
    };
  });
}

function joinNames(names: string[], locale: MailLocale): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${TEXTS[locale].and} ${names[names.length - 1]}`;
}

/** The mail to one address: one section per member when they are several */
export function renderMail(
  members: MemberNotice[],
  ctx: MailContext
): { subject: string; text: string } {
  const { locale } = ctx;
  const t = TEXTS[locale];
  const club = oneLine(ctx.clubName);
  const sender = oneLine(ctx.senderName);
  const several = members.length > 1;
  const overview = members.length > 0 && members.every((m) => m.firstTime);
  const names = joinNames(
    members.map((m) => oneLine(m.firstname) || oneLine(m.lastname)),
    locale
  );

  const subject = oneLine(`${club ? `${club} – ` : ''}${t.subject(overview, names)}`);

  const sections = members.map((m) => {
    const blocks = memberBlocks(m, locale).map((b) =>
      [b.heading, ...b.lines.map((l) => `- ${l}`)].join('\n')
    );
    const name = oneLine(`${m.firstname} ${m.lastname}`);
    return (several ? [t.forMember(name), ...blocks] : blocks).join('\n\n');
  });

  const plural: Plural = { overview, several, sender };
  const link = `${ctx.origin.replace(/\/+$/, '')}/dashboard/training-plan`;
  const text = [
    t.hello(names),
    t.intro(plural),
    ...sections,
    [t.binding(link), t.calendars, t.questions(plural)].join('\n'),
    ...(club ? [club] : [])
  ].join('\n\n');

  return { subject, text: `${text}\n` };
}
