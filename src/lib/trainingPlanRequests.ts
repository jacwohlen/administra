/**
 * Substitutes and swaps in the training plan (docs/TRAINING_PLAN.md,
 * "Vertretung und Tausch"): the trainer of a date asks one other member to
 * take it over (substitute), or to trade it for one of their dates (swap).
 * Only the person asked confirms; the database applies it
 * (training_plan_request_*(), 20261111120000_training_plan_requests.sql).
 *
 * This module is pure: what the plan page shows and offers, and the mails
 * the server sends (in the sender's language, like the plan mails).
 */

import type { PlanRow } from './trainingPlanUtils';
import { formatDate } from './trainingPlanMailText';
import type { MailLocale } from './trainingPlanMail';

export type RequestKind = 'substitute' | 'swap';
export type RequestStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired';

/** Row of training_plan_requests */
export interface PlanRequest {
  id: number;
  kind: RequestKind;
  training_id: number;
  date: string;
  other_training_id: number | null;
  other_date: string | null;
  from_member_id: number;
  to_member_id: number;
  message: string | null;
  move_note: boolean;
  other_move_note: boolean;
  status: RequestStatus;
  created_at: string;
  answered_at: string | null;
}

export const REQUEST_COLUMNS =
  'id, kind, training_id, date, other_training_id, other_date, from_member_id, to_member_id, ' +
  'message, move_note, other_move_note, status, created_at, answered_at';

/** Error codes of the request functions and the endpoint */
export const REQUEST_ERROR_CODES = [
  'not_signed_in',
  'bad_request',
  'not_allowed',
  'not_your_date',
  'not_planned',
  'past',
  'cancelled',
  'bad_member',
  'not_their_date',
  'busy',
  'not_found',
  'failed'
] as const;
export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

/** What happened to the mail about a request */
export type RequestMailOutcome = 'sent' | 'simulated' | 'skipped' | 'failed' | 'off';

/** The answer of /api/training-plan/requests */
export interface RequestResult {
  status: RequestStatus;
  id: number;
  mail: RequestMailOutcome;
}

/** The body of a POST to /api/training-plan/requests */
export type RequestAction =
  | {
      action: 'create';
      kind: RequestKind;
      trainingId: number;
      date: string;
      toMemberId: number;
      otherTrainingId?: number;
      otherDate?: string;
      message?: string | null;
      moveNote?: boolean;
      otherMoveNote?: boolean;
    }
  | { action: 'answer'; id: number; accept: boolean }
  | { action: 'withdraw'; id: number };

/** Posts a request action; failures come back as a code */
export async function postRequestAction(
  body: RequestAction,
  locale: MailLocale,
  fetchFn: typeof fetch = fetch
): Promise<({ ok: true } & RequestResult) | { ok: false; code: RequestErrorCode }> {
  let res: Response;
  try {
    res = await fetchFn('/api/training-plan/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...body, locale })
    });
  } catch {
    return { ok: false, code: 'failed' };
  }
  const answer = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = answer?.code;
    return {
      ok: false,
      code: (REQUEST_ERROR_CODES as readonly string[]).includes(code as string)
        ? (code as RequestErrorCode)
        : 'failed'
    };
  }
  return { ok: true, ...(answer as unknown as RequestResult) };
}

/** The database's exception message as a code */
export function requestErrorCode(message: string | null | undefined): RequestErrorCode {
  const code = (message ?? '').trim().toLowerCase();
  return (REQUEST_ERROR_CODES as readonly string[]).includes(code)
    ? (code as RequestErrorCode)
    : 'failed';
}

const slotKey = (trainingId: number, date: string) => `${trainingId}|${date}`;

/** The open requests by the dates they hold: the asker's and (swap) the other one */
export function openRequestsBySlot(requests: PlanRequest[]): Map<string, PlanRequest> {
  const map = new Map<string, PlanRequest>();
  for (const r of requests) {
    if (r.status !== 'open') continue;
    map.set(slotKey(r.training_id, r.date), r);
    if (r.kind === 'swap' && r.other_training_id != null && r.other_date) {
      map.set(slotKey(r.other_training_id, r.other_date), r);
    }
  }
  return map;
}

export function requestOnRow(
  row: Pick<PlanRow, 'training' | 'date'>,
  bySlot: Map<string, PlanRequest>
): PlanRequest | null {
  return bySlot.get(slotKey(row.training.id, row.date)) ?? null;
}

/**
 * What a confirmed request left on a date, while the plan still shows it:
 * 'substitute' (the trainer stands in for `for`) or 'swap' (the trainer
 * swapped with `with`). The newest confirmed request per date wins.
 */
export type RowHistory = { kind: 'substitute'; for: number } | { kind: 'swap'; with: number };

export function acceptedOnRow(
  row: Pick<PlanRow, 'training' | 'date' | 'trainerId'>,
  requests: PlanRequest[]
): RowHistory | null {
  const accepted = requests
    .filter((r) => r.status === 'accepted')
    .sort((a, b) => (b.answered_at ?? '').localeCompare(a.answered_at ?? '') || b.id - a.id);
  for (const r of accepted) {
    if (r.training_id === row.training.id && r.date === row.date) {
      if (row.trainerId !== r.to_member_id) return null;
      return r.kind === 'swap'
        ? { kind: 'swap', with: r.from_member_id }
        : { kind: 'substitute', for: r.from_member_id };
    }
    if (r.kind === 'swap' && r.other_training_id === row.training.id && r.other_date === row.date) {
      return row.trainerId === r.from_member_id ? { kind: 'swap', with: r.to_member_id } : null;
    }
  }
  return null;
}

/**
 * Whether an open request still applies, by the rule the database checks
 * when it is accepted: both dates from today on, held, the asker still leads
 * the first and (swap) the person asked the other
 */
export function requestStillValid(
  r: PlanRequest,
  rows: Pick<PlanRow, 'training' | 'date' | 'trainerId' | 'cancelled'>[],
  today: string
): boolean {
  const find = (trainingId: number | null, date: string | null) =>
    rows.find((row) => row.training.id === trainingId && row.date === date);
  const a = find(r.training_id, r.date);
  if (!a || r.date < today || a.cancelled || a.trainerId !== r.from_member_id) return false;
  if (r.kind !== 'swap') return true;
  const b = find(r.other_training_id, r.other_date);
  return (
    !!b && !!r.other_date && r.other_date >= today && !b.cancelled && b.trainerId === r.to_member_id
  );
}

/** Whether the account can hand this date on: one of its members leads it, from today on */
export function canHandOver(
  row: Pick<PlanRow, 'date' | 'trainerId' | 'cancelled'>,
  mine: Set<number>,
  today: string
): boolean {
  return row.date >= today && !row.cancelled && row.trainerId != null && mine.has(row.trainerId);
}

/** The dates a swap can offer: someone else's held dates from today on, by date */
export function swapCandidates<T extends Pick<PlanRow, 'date' | 'trainerId' | 'cancelled'>>(
  rows: T[],
  memberId: number,
  today: string,
  taken: (row: T) => boolean = () => false
): T[] {
  return rows.filter(
    (r) => r.date >= today && !r.cancelled && r.trainerId === memberId && !taken(r)
  );
}

/**
 * How a confirmed request changes a session, as the database writes it: the
 * new trainer, topic and note of the asker's date (a) and the other date (b)
 */
export function swapResult(
  a: { topic: string | null; notes: string | null },
  b: { topic: string | null; notes: string | null },
  moveNote: boolean,
  otherMoveNote: boolean
): {
  a: { topic: string | null; notes: string | null };
  b: { topic: string | null; notes: string | null };
} {
  const clean = (s: string | null) => (s?.trim() ? s.trim() : null);
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || null;
  return {
    a: {
      topic: b.topic,
      notes: join(moveNote ? null : clean(a.notes), otherMoveNote ? clean(b.notes) : null)
    },
    b: {
      topic: a.topic,
      notes: join(otherMoveNote ? null : clean(b.notes), moveNote ? clean(a.notes) : null)
    }
  };
}

// ---------------------------------------------------------------------------
// Mails
// ---------------------------------------------------------------------------

/** What the mails about a request say, from training_plan_request_mail() */
export interface RequestMailPerson {
  id: number;
  name: string;
  firstname: string | null;
  email: string | null;
  optout: boolean;
}
export interface RequestMailDate {
  training_id: number;
  date: string;
  title: string | null;
  weekday: string | null;
  time_from: string | null;
  time_to: string | null;
  topic: string | null;
}
export interface RequestMailData {
  id: number;
  kind: RequestKind;
  status: RequestStatus;
  message: string | null;
  from: RequestMailPerson;
  to: RequestMailPerson;
  date: RequestMailDate;
  other_date: RequestMailDate | null;
}

/** What happened: the mail goes to the person asked (asked, withdrawn) or the asker */
export type RequestEvent = 'asked' | 'accepted' | 'declined' | 'withdrawn';

export function mailRecipient(event: RequestEvent, data: RequestMailData): RequestMailPerson {
  return event === 'asked' || event === 'withdrawn' ? data.to : data.from;
}

export interface RequestMailContext {
  locale: MailLocale;
  clubName: string;
  origin: string;
}

const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function dateLine(d: RequestMailDate, locale: MailLocale): string {
  const time = d.time_from ? (d.time_to ? `${d.time_from}–${d.time_to}` : d.time_from) : '';
  return [formatDate(d.date, locale), oneLine(d.title), time].filter(Boolean).join(', ');
}

const TEXTS = {
  de: {
    hello: (name: string) => `Hallo ${name}`,
    askedSubject: (swap: boolean, date: string) =>
      swap ? `Tausch-Anfrage: ${date}` : `Vertretung gesucht: ${date}`,
    askedSubstitute: (from: string) =>
      `${from} fragt dich, ob du dieses Training übernehmen kannst:`,
    askedSwap: (from: string) => `${from} möchte mit dir Trainingstage tauschen:`,
    youLead: 'Du leitest neu',
    theyLead: (name: string) => `${name} leitet neu`,
    withTopic: (topic: string) => `mit deinem Thema (${topic})`,
    withTheirTopic: (topic: string) => `mit dem eigenen Thema (${topic})`,
    topic: (topic: string) => `Thema: ${topic}`,
    message: (text: string) => `Nachricht: ${text}`,
    answer: (link: string) =>
      `Bitte sag in der App zu oder ab: ${link}\nDer Plan ändert sich erst, wenn du zusagst.`,
    acceptedSubject: (swap: boolean, date: string) =>
      swap ? `Tausch bestätigt: ${date}` : `Vertretung zugesagt: ${date}`,
    acceptedSubstitute: (to: string, date: string) =>
      `${to} übernimmt dein Training am ${date}. Der Plan ist angepasst.`,
    acceptedSwap: (to: string, mine: string, theirs: string) =>
      `${to} hat den Tausch bestätigt. Du leitest neu am ${mine}, ${to} am ${theirs}. Der Plan ist angepasst.`,
    declinedSubject: (swap: boolean, date: string) =>
      swap ? `Tausch abgelehnt: ${date}` : `Vertretung abgelehnt: ${date}`,
    declinedSubstitute: (to: string, date: string) =>
      `${to} kann dein Training am ${date} leider nicht übernehmen. Du leitest es weiterhin; frag gern jemand anderen.`,
    declinedSwap: (to: string, date: string) =>
      `${to} hat den Tausch für den ${date} abgelehnt. Der Plan bleibt, wie er ist.`,
    withdrawnSubject: (date: string) => `Anfrage zurückgezogen: ${date}`,
    withdrawn: (from: string, date: string) =>
      `${from} hat die Anfrage für den ${date} zurückgezogen. Du musst nichts tun.`,
    plan: (link: string) => `Trainingsplan: ${link}`
  },
  en: {
    hello: (name: string) => `Hello ${name}`,
    askedSubject: (swap: boolean, date: string) =>
      swap ? `Swap request: ${date}` : `Substitute needed: ${date}`,
    askedSubstitute: (from: string) => `${from} asks whether you can take over this training:`,
    askedSwap: (from: string) => `${from} would like to swap training dates with you:`,
    youLead: 'You lead',
    theyLead: (name: string) => `${name} leads`,
    withTopic: (topic: string) => `with your topic (${topic})`,
    withTheirTopic: (topic: string) => `with their own topic (${topic})`,
    topic: (topic: string) => `Topic: ${topic}`,
    message: (text: string) => `Message: ${text}`,
    answer: (link: string) =>
      `Please accept or decline in the app: ${link}\nThe plan only changes once you accept.`,
    acceptedSubject: (swap: boolean, date: string) =>
      swap ? `Swap confirmed: ${date}` : `Substitute found: ${date}`,
    acceptedSubstitute: (to: string, date: string) =>
      `${to} takes over your training on ${date}. The plan has been updated.`,
    acceptedSwap: (to: string, mine: string, theirs: string) =>
      `${to} confirmed the swap. You now lead on ${mine}, ${to} on ${theirs}. The plan has been updated.`,
    declinedSubject: (swap: boolean, date: string) =>
      swap ? `Swap declined: ${date}` : `Substitute declined: ${date}`,
    declinedSubstitute: (to: string, date: string) =>
      `${to} cannot take over your training on ${date}. You still lead it; feel free to ask someone else.`,
    declinedSwap: (to: string, date: string) =>
      `${to} declined the swap for ${date}. The plan stays as it is.`,
    withdrawnSubject: (date: string) => `Request withdrawn: ${date}`,
    withdrawn: (from: string, date: string) =>
      `${from} withdrew the request for ${date}. Nothing to do for you.`,
    plan: (link: string) => `Training plan: ${link}`
  }
};

/** The mail about a request, to mailRecipient() */
export function renderRequestMail(
  event: RequestEvent,
  data: RequestMailData,
  ctx: RequestMailContext
): { subject: string; text: string } {
  const { locale } = ctx;
  const t = TEXTS[locale];
  const club = oneLine(ctx.clubName);
  const swap = data.kind === 'swap' && data.other_date != null;
  const to = mailRecipient(event, data);
  const fromName = oneLine(data.from.name);
  const toName = oneLine(data.to.name);
  const date = formatDate(data.date.date, locale);
  const otherDate = swap ? formatDate(data.other_date!.date, locale) : '';
  const link = `${ctx.origin.replace(/\/+$/, '')}/dashboard/training-plan`;

  let subject: string;
  let body: string[];
  switch (event) {
    case 'asked': {
      subject = t.askedSubject(swap, date);
      const message = oneLine(data.message);
      if (swap) {
        const mine = data.other_date!.topic
          ? `, ${t.withTopic(oneLine(data.other_date!.topic))}`
          : '';
        const theirs = data.date.topic ? `, ${t.withTheirTopic(oneLine(data.date.topic))}` : '';
        body = [
          [
            t.askedSwap(fromName),
            `- ${t.youLead}: ${dateLine(data.date, locale)}${mine}`,
            `- ${t.theyLead(fromName)}: ${dateLine(data.other_date!, locale)}${theirs}`
          ].join('\n')
        ];
      } else {
        body = [
          [
            t.askedSubstitute(fromName),
            `- ${dateLine(data.date, locale)}`,
            ...(data.date.topic ? [`- ${t.topic(oneLine(data.date.topic))}`] : [])
          ].join('\n')
        ];
      }
      if (message) body.push(t.message(message));
      body.push(t.answer(link));
      break;
    }
    case 'accepted':
      subject = t.acceptedSubject(swap, date);
      body = [swap ? t.acceptedSwap(toName, otherDate, date) : t.acceptedSubstitute(toName, date)];
      body.push(t.plan(link));
      break;
    case 'declined':
      subject = t.declinedSubject(swap, date);
      body = [swap ? t.declinedSwap(toName, date) : t.declinedSubstitute(toName, date)];
      body.push(t.plan(link));
      break;
    case 'withdrawn':
      subject = t.withdrawnSubject(date);
      body = [t.withdrawn(fromName, swap ? `${date} / ${otherDate}` : date), t.plan(link)];
      break;
  }

  const name = oneLine(to.firstname) || oneLine(to.name);
  const text = [t.hello(name), ...body, ...(club ? [club] : [])].join('\n\n');
  return { subject: oneLine(`${club ? `${club} – ` : ''}${subject}`), text: `${text}\n` };
}
