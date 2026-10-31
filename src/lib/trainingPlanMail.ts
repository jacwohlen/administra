/**
 * "Trainer informieren": what changed in the training plan for each trainer
 * since they were last told (docs/TRAINING_PLAN.md).
 *
 * There is no change log. Per member the database keeps what they were last
 * told (training_plan_told_trainings, training_plan_told), and this module
 * compares it with the plan as it is now, by the rules of buildPlan(): the
 * planned trainer, else the main trainer, leads; a session's cancelled flag,
 * else a break closing the dojo, drops a date.
 *
 * What a member was told is kept as exceptions, so the endless weekly dates
 * of a training cost nothing: a main trainer leads every date unless a row
 * says 'cancelled' (would lead, dropped) or 'not_lead' (someone else leads);
 * any other trainer leads only the dates with a row ('lead', or 'cancelled'
 * when dropped). Only dates from today (Europe/Zurich) up to MAIL_DAYS_AHEAD
 * days ahead are compared.
 *
 * Pure (no SvelteKit or Supabase imports): the dialog previews with it in the
 * browser, and /api/training-plan/notify recomputes the same on the server
 * before it sends. Session notes are never read.
 */

import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import { buildPlan, type PlanRow } from './trainingPlanUtils';
import { parseTime, type FeedTraining } from './calendarFeed';

/** How far ahead dates are compared (like calendar_feed()) */
export const MAIL_DAYS_AHEAD = 400;
/** More lines of one kind per training than this become one line */
export const COMPRESS_OVER = 6;

export type MailLocale = 'de' | 'en';
export type ToldDateState = 'lead' | 'cancelled' | 'not_lead';

/** Row of training_plan_told_trainings */
export interface ToldTrainingRow {
  member_id: number;
  training_id: number;
  is_main: boolean;
  title: string;
  weekday: string | null;
  time_from: string | null;
  time_to: string | null;
  told_at: string;
}

/** Row of training_plan_told */
export interface ToldDateRow {
  member_id: number;
  training_id: number;
  date: string;
  state: ToldDateState;
}

export interface MailMember {
  id: number;
  firstname: string;
  lastname: string;
}

/** Row of training_plan_mail_addresses() */
export interface MailAddress {
  member_id: number;
  email: string | null;
  source: 'account' | 'member' | null;
}

/** A member's newest row of training_plan_mails still 'pending' (as far as RLS shows it) */
export interface PendingMail {
  member_id: number;
  created_at: string;
}

/**
 * Which trainings the account plans: the TK all (also told rows of trainings
 * no longer planned), a main trainer their own
 */
export interface MailScope {
  all: boolean;
  trainingIds: number[];
}

/** Everything the comparison needs; loaded by loadMailPlan() in the browser and on the server */
export interface MailPlanData {
  /** zurichToday(now) */
  today: string;
  /** addDays(today, MAIL_DAYS_AHEAD) */
  to: string;
  /** The planned trainings (with dateTo) */
  trainings: FeedTraining[];
  /** today..to; notes always null (never loaded) */
  sessions: TrainingPlanSession[];
  /** Overlapping today..to */
  breaks: TrainingPlanBreak[];
  toldTrainings: ToldTrainingRow[];
  /** date >= today */
  toldDates: ToldDateRow[];
  optOuts: number[];
  /** my_member_ids() of the signed-in account */
  ownMemberIds: number[];
  /** Every involved member (archived ones too) */
  members: MailMember[];
  /** training_plan_mail_addresses() */
  addresses: MailAddress[];
  /** Per involved member the newest log row still 'pending' */
  pendingMails: PendingMail[];
}

export interface Schedule {
  weekday: string | null;
  timeFrom: string | null;
  timeTo: string | null;
}

export type TrainingLineKind = 'main_new' | 'main_gone' | 'schedule' | 'training_gone';
export type DateLineKind =
  'lead' | 'not_lead' | 'cancelled' | 'resumed' | 'other_leads' | 'still_lead';
export type LineKind = TrainingLineKind | DateLineKind;

export interface NoticeLine {
  kind: LineKind;
  trainingId: number;
  /** Date lines */
  date?: string;
  /** not_lead / other_leads: who leads now; null: the date no longer exists */
  other?: { memberId: number; name: string } | 'open' | 'cancelled' | null;
  /** cancelled: the title of the break closing the dojo */
  reason?: string | null;
  /** lead / resumed / still_lead */
  topic?: string | null;
  /** main_new, schedule (now) */
  schedule?: Schedule;
  /** schedule (as told) */
  before?: Schedule;
}

export interface TrainingNotice {
  trainingId: number;
  title: string;
  schedule: Schedule | null;
  lines: NoticeLine[];
}

/** The p_states element of training_plan_set_told() */
export interface MemberTold {
  member_id: number;
  training_ids: number[];
  trainings: {
    training_id: number;
    is_main: boolean;
    title: string;
    weekday: string | null;
    time_from: string | null;
    time_to: string | null;
  }[];
  dates: { training_id: number; date: string; state: ToldDateState }[];
}

export interface MemberNotice {
  memberId: number;
  firstname: string;
  lastname: string;
  /** No told_trainings row of this member in scope */
  firstTime: boolean;
  /**
   * A mail to them whose outcome is unknown: the newest log row is still
   * 'pending' (the request timed out, the connection dropped, or a send is
   * under way) and newer than what they were last told; its created_at
   */
  unclearSince: string | null;
  /** Only trainings with lines, in plan order */
  trainings: TrainingNotice[];
  /** The full current state in scope, written on send/mark */
  told: MemberTold;
}

export type UnreachableReason = 'opted_out' | 'no_address' | 'test_address';

export interface RecipientGroup {
  /** addressKey() of the address */
  key: string;
  address: string;
  source: 'account' | 'member';
  members: MemberNotice[];
}

export interface UnreachableMember {
  member: MemberNotice;
  reason: UnreachableReason;
  address: string | null;
}

export interface NoticeSet {
  /** No told_trainings row in scope at all */
  firstTime: boolean;
  /** Pending (at least one line), the sender's own excluded, by lastname, firstname, id */
  members: MemberNotice[];
  /** The sender's own involved members (pending or not) */
  own: MemberNotice[];
  /** One mail each, in the order of their first member */
  groups: RecipientGroup[];
  unreachable: UnreachableMember[];
}

// The request and response of /api/training-plan/notify (shared by endpoint and client)
export type NotifyAction = 'send' | 'mark';

export interface NotifyRequest {
  action: NotifyAction;
  memberIds: number[];
  fingerprint: string;
  locale: MailLocale;
}

export interface NotifyResult {
  status: 'sent' | 'skipped' | 'failed' | 'marked';
  simulated: boolean;
  toldSaved: boolean;
  error?: string;
}

export const NOTIFY_ERROR_CODES = [
  'not_signed_in',
  'bad_request',
  'not_allowed',
  'stale',
  'unreachable',
  'several_addresses',
  'nothing_pending',
  'mail_off',
  'load_failed',
  'save_failed'
] as const;

export type NotifyErrorCode = (typeof NOTIFY_ERROR_CODES)[number];

/** "18.00" and "18:00" become "18:00"; other text stays (trimmed); empty is null */
export function normTime(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const minutes = parseTime(text);
  if (minutes == null) return text;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function schedule(
  weekday: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined
): Schedule {
  return { weekday: weekday || null, timeFrom: normTime(from), timeTo: normTime(to) };
}

/** Weekday and times of a training, as told rows store them */
export function scheduleOf(t: FeedTraining): Schedule {
  return schedule(t.weekday, t.dateFrom, t.dateTo);
}

function toldSchedule(told: ToldTrainingRow): Schedule {
  return schedule(told.weekday, told.time_from, told.time_to);
}

function sameSchedule(a: Schedule, b: Schedule): boolean {
  return a.weekday === b.weekday && a.timeFrom === b.timeFrom && a.timeTo === b.timeTo;
}

/** An address as one mail goes to it: trimmed, lower case (like normalize_email()) */
export function addressKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The sync's anonymized addresses (member-<id>@example.invalid) never reach anyone */
export function isTestAddress(email: string): boolean {
  return /\.invalid$/i.test(email.trim());
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TRAINING_KINDS: LineKind[] = ['main_new', 'main_gone', 'training_gone', 'schedule'];
const DATE_KINDS: LineKind[] = [
  'not_lead',
  'lead',
  'resumed',
  'still_lead',
  'other_leads',
  'cancelled'
];

/** A date for one member: L leads it, C would lead it but it is dropped, N does not lead it */
type Status = 'L' | 'C' | 'N';
const TOLD_STATUS: Record<ToldDateState, Status> = { lead: 'L', cancelled: 'C', not_lead: 'N' };

type Role = 'main' | 'sub' | null;

/** Same order for the same data, whatever the browser's or the server's locale */
const compareText = (a: string, b: string) => a.localeCompare(b, 'de');

/** A line with its properties in a fixed order, so the fingerprint is stable */
function line(
  kind: LineKind,
  trainingId: number,
  extra: Omit<NoticeLine, 'kind' | 'trainingId'> = {}
): NoticeLine {
  const l: NoticeLine = { kind, trainingId };
  if (extra.date !== undefined) l.date = extra.date;
  if (extra.other !== undefined) l.other = extra.other;
  if (extra.reason !== undefined) l.reason = extra.reason;
  if (extra.topic !== undefined) l.topic = extra.topic;
  if (extra.schedule) l.schedule = extra.schedule;
  if (extra.before) l.before = extra.before;
  return l;
}

function compareLines(a: NoticeLine, b: NoticeLine): number {
  const level = (l: NoticeLine) => TRAINING_KINDS.indexOf(l.kind);
  const la = level(a);
  const lb = level(b);
  if (la >= 0 || lb >= 0) return (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb);
  return (
    (a.date ?? '').localeCompare(b.date ?? '') ||
    DATE_KINDS.indexOf(a.kind) - DATE_KINDS.indexOf(b.kind)
  );
}

interface Examined {
  notice: TrainingNotice | null;
  /** Plan order: weekday, start time, title; trainings no longer planned last */
  order: [number, number, string, string, number];
  entry: MemberTold['trainings'][number] | null;
  dates: MemberTold['dates'];
}

interface Context {
  planned: Map<number, FeedTraining>;
  rows: Map<number, PlanRow[]>;
  told: Map<string, ToldTrainingRow>;
  toldDates: Map<string, Map<string, ToldDateState>>;
  name: (memberId: number) => string;
}

/** One member and one training: the lines, and what the member is told about it from now on */
function examine(memberId: number, trainingId: number, ctx: Context): Examined {
  const key = `${memberId}|${trainingId}`;
  const training = ctx.planned.get(trainingId) ?? null;
  const rows = ctx.rows.get(trainingId) ?? [];
  const told = ctx.told.get(key) ?? null;
  const toldRows = ctx.toldDates.get(key) ?? new Map<string, ToldDateState>();

  const role: Role = !training
    ? null
    : training.mainTrainerId === memberId
      ? 'main'
      : rows.some((r) => r.trainerId === memberId)
        ? 'sub'
        : null;
  const now = training ? scheduleOf(training) : null;
  const before = told ? toldSchedule(told) : null;
  const known = told != null && now != null && before!.weekday === now.weekday;
  const same = now != null && before != null && sameSchedule(now, before);
  const toldActive =
    told != null && (told.is_main || [...toldRows.values()].some((s) => s !== 'not_lead'));

  const statusNow = (r: PlanRow): Status =>
    r.trainerId !== memberId ? 'N' : r.cancelled ? 'C' : 'L';
  const statusTold = (date: string): Status => {
    if (!known) return 'N';
    const state = toldRows.get(date);
    return state ? TOLD_STATUS[state] : told!.is_main ? 'L' : 'N';
  };

  // A training no longer in the plan (taken out, or deleted)
  if (!training) {
    const lines = told && toldActive ? [line('training_gone', trainingId)] : [];
    const s = before!;
    return {
      notice: lines.length
        ? {
            trainingId,
            title: told!.title,
            schedule: s.weekday || s.timeFrom || s.timeTo ? s : null,
            lines
          }
        : null,
      order: [1, 0, '', told?.title ?? '', trainingId],
      entry: null,
      dates: []
    };
  }

  const lines: NoticeLine[] = [];
  const wasMain = told?.is_main === true;
  if (role === 'main' && !wasMain) {
    lines.push(line('main_new', trainingId, { schedule: now! }));
  } else if (wasMain && role !== 'main') {
    lines.push(line('main_gone', trainingId));
    if (role === 'sub' && !same) {
      lines.push(line('schedule', trainingId, { schedule: now!, before: before! }));
    }
  } else if (told && !same && (role != null || toldActive)) {
    lines.push(line('schedule', trainingId, { schedule: now!, before: before! }));
  }

  const topic = (r: PlanRow) => r.session?.topic?.trim() || null;
  const reason = (r: PlanRow) => (r.break?.cancels_training ? r.break.title : null);
  const leader = (r: PlanRow): NonNullable<NoticeLine['other']> =>
    r.trainerId == null ? 'open' : { memberId: r.trainerId, name: ctx.name(r.trainerId) };

  const overview = role === 'main' && !(wasMain && known);
  const mainGone = wasMain && role !== 'main';
  for (const r of rows) {
    const sc = statusNow(r);
    const st = statusTold(r.date);
    const date = r.date;
    const lead = (kind: DateLineKind) =>
      lines.push(line(kind, trainingId, { date, topic: topic(r) }));
    const cancelled = () => lines.push(line('cancelled', trainingId, { date, reason: reason(r) }));
    const notLead = () =>
      lines.push(
        line('not_lead', trainingId, { date, other: r.cancelled ? 'cancelled' : leader(r) })
      );

    // An overview lists every exception anew, whatever was told before: a
    // substitute's dropped date was stored as told without a line
    if (overview) {
      if (sc === 'L') {
        if (st === 'C') lead('resumed');
      } else if (sc === 'C') {
        cancelled();
      } else if (st === 'L') {
        notLead();
      } else if (!r.cancelled) {
        lines.push(line('other_leads', trainingId, { date, other: leader(r) }));
      } else {
        cancelled();
      }
    } else if (mainGone) {
      if (sc === 'L') lead(st === 'L' ? 'still_lead' : st === 'C' ? 'resumed' : 'lead');
    } else if (st === 'N' && sc === 'L') {
      lead('lead');
    } else if (st === 'L' && sc === 'C') {
      cancelled();
    } else if (st === 'L' && sc === 'N') {
      notLead();
    } else if (st === 'C' && sc === 'L') {
      lead('resumed');
    }
  }

  // A substitute's dates on a training's old weekday: buildPlan no longer
  // shows them, so each one is said to be gone
  if (told && !told.is_main && !known) {
    const current = new Set(rows.map((r) => r.date));
    for (const [date, state] of toldRows) {
      if (state === 'lead' && !current.has(date)) {
        lines.push(line('not_lead', trainingId, { date, other: null }));
      }
    }
  }
  lines.sort(compareLines);

  const weekday = WEEK.indexOf(training.weekday);
  const order: Examined['order'] = [
    0,
    weekday < 0 ? WEEK.length : weekday,
    now!.timeFrom ?? '',
    training.title ?? '',
    trainingId
  ];
  if (role == null) return { notice: noticeOf(training, lines), order, entry: null, dates: [] };

  const dates: MemberTold['dates'] = [];
  for (const r of rows) {
    const sc = statusNow(r);
    const state: ToldDateState | null =
      role === 'main'
        ? sc === 'C'
          ? 'cancelled'
          : sc === 'N'
            ? 'not_lead'
            : null
        : sc === 'L'
          ? 'lead'
          : sc === 'C'
            ? 'cancelled'
            : null;
    if (state) dates.push({ training_id: trainingId, date: r.date, state });
  }
  return {
    notice: noticeOf(training, lines),
    order,
    entry: {
      training_id: trainingId,
      is_main: role === 'main',
      title: training.title,
      weekday: training.weekday || null,
      time_from: normTime(training.dateFrom),
      time_to: normTime(training.dateTo)
    },
    dates
  };
}

function noticeOf(training: FeedTraining, lines: NoticeLine[]): TrainingNotice | null {
  return lines.length
    ? { trainingId: training.id, title: training.title, schedule: scheduleOf(training), lines }
    : null;
}

function compareOrder(a: Examined['order'], b: Examined['order']): number {
  return (
    a[0] - b[0] || a[1] - b[1] || compareText(a[2], b[2]) || compareText(a[3], b[3]) || a[4] - b[4]
  );
}

function compareMembers(a: MemberNotice, b: MemberNotice): number {
  return (
    compareText(a.lastname, b.lastname) ||
    compareText(a.firstname, b.firstname) ||
    a.memberId - b.memberId
  );
}

/**
 * For every member involved in the trainings of the scope (main trainers,
 * planned trainers, members told before): the lines of what changed since
 * they were last told, the state to store once they are told, and where to
 * mail it.
 */
export function computeNotices(data: MailPlanData, scope: MailScope): NoticeSet {
  const inScope = (id: number) => scope.all || scope.trainingIds.includes(id);
  const trainings = data.trainings.filter((t) => inScope(t.id));
  const toldTrainings = data.toldTrainings.filter((t) => inScope(t.training_id));
  const toldDates = data.toldDates.filter(
    (d) => inScope(d.training_id) && d.date >= data.today && d.date <= data.to
  );

  const rows = new Map<number, PlanRow[]>();
  for (const r of buildPlan(trainings, data.sessions, data.breaks, [], data.today, data.to)) {
    const list = rows.get(r.training.id) ?? [];
    list.push(r);
    rows.set(r.training.id, list);
  }

  const names = new Map(data.members.map((m) => [m.id, m]));
  const ctx: Context = {
    planned: new Map(trainings.map((t) => [t.id, t])),
    rows,
    told: new Map(toldTrainings.map((t) => [`${t.member_id}|${t.training_id}`, t])),
    toldDates: new Map(),
    name: (id) => {
      const m = names.get(id);
      return m ? `${m.firstname ?? ''} ${m.lastname ?? ''}`.replace(/\s+/g, ' ').trim() : '?';
    }
  };
  for (const d of toldDates) {
    const key = `${d.member_id}|${d.training_id}`;
    const map = ctx.toldDates.get(key) ?? new Map<string, ToldDateState>();
    map.set(d.date, d.state);
    ctx.toldDates.set(key, map);
  }

  // Who is involved in which training: its main trainer, whoever leads a
  // date of it, and whoever was told about it
  const involved = new Map<number, Set<number>>();
  const add = (memberId: number, trainingId: number) => {
    const set = involved.get(memberId) ?? new Set<number>();
    set.add(trainingId);
    involved.set(memberId, set);
  };
  for (const t of trainings) if (t.mainTrainerId != null) add(t.mainTrainerId, t.id);
  for (const list of rows.values()) {
    for (const r of list) if (r.trainerId != null) add(r.trainerId, r.training.id);
  }
  for (const t of toldTrainings) add(t.member_id, t.training_id);

  const toldMembers = new Set(toldTrainings.map((t) => t.member_id));
  // A pending log row after the member was last told (in scope): a mail
  // that may have left without being stored as told
  const lastTold = new Map<number, number>();
  for (const t of toldTrainings) {
    const at = Date.parse(t.told_at);
    if (at > (lastTold.get(t.member_id) ?? -Infinity)) lastTold.set(t.member_id, at);
  }
  const unclear = new Map<number, string>();
  for (const p of data.pendingMails) {
    const at = Date.parse(p.created_at);
    if (!(at > (lastTold.get(p.member_id) ?? -Infinity))) continue;
    const known = unclear.get(p.member_id);
    if (known === undefined || at > Date.parse(known)) unclear.set(p.member_id, p.created_at);
  }
  const all: MemberNotice[] = [];
  for (const [memberId, ids] of involved) {
    const examined = [...ids].map((id) => examine(memberId, id, ctx));
    const m = names.get(memberId);
    all.push({
      memberId,
      firstname: m?.firstname ?? '?',
      lastname: m?.lastname ?? '',
      firstTime: !toldMembers.has(memberId),
      unclearSince: unclear.get(memberId) ?? null,
      trainings: examined
        .filter((e) => e.notice)
        .sort((a, b) => compareOrder(a.order, b.order))
        .map((e) => e.notice!),
      told: {
        member_id: memberId,
        training_ids: [...ids].sort((a, b) => a - b),
        trainings: examined
          .flatMap((e) => (e.entry ? [e.entry] : []))
          .sort((a, b) => a.training_id - b.training_id),
        dates: examined
          .flatMap((e) => e.dates)
          .sort((a, b) => a.training_id - b.training_id || a.date.localeCompare(b.date))
      }
    });
  }
  all.sort(compareMembers);

  const own = new Set(data.ownMemberIds);
  const members = all.filter((n) => !own.has(n.memberId) && n.trainings.length > 0);

  const optedOut = new Set(data.optOuts);
  const addresses = new Map(data.addresses.map((a) => [a.member_id, a]));
  const groups = new Map<string, RecipientGroup>();
  const unreachable: UnreachableMember[] = [];
  for (const member of members) {
    const found = addresses.get(member.memberId);
    const address = found?.email?.trim() || null;
    if (optedOut.has(member.memberId)) {
      unreachable.push({ member, reason: 'opted_out', address });
    } else if (!address || !EMAIL.test(address)) {
      unreachable.push({ member, reason: 'no_address', address });
    } else if (isTestAddress(address)) {
      unreachable.push({ member, reason: 'test_address', address });
    } else {
      const key = addressKey(address);
      const source = found?.source === 'account' ? 'account' : 'member';
      const group = groups.get(key);
      if (group) {
        group.members.push(member);
        if (source === 'account') group.source = 'account';
      } else {
        groups.set(key, { key, address, source, members: [member] });
      }
    }
  }

  return {
    firstTime: toldTrainings.length === 0,
    members,
    own: all.filter((n) => own.has(n.memberId)),
    groups: [...groups.values()],
    unreachable
  };
}

// cyrb53, a small non-cryptographic hash: the server recomputes everything
// anyway, the fingerprint only tells a stale preview apart
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * What the preview showed, for the server to compare with what it computes:
 * the members' lines, whether a mail to them is unclear (so a send under way
 * elsewhere makes the preview stale) and, for a mail, the address key (null
 * when marking)
 */
export function fingerprint(members: MemberNotice[], addressKey: string | null): string {
  return cyrb53(
    JSON.stringify({
      a: addressKey,
      m: [...members]
        .sort((x, y) => x.memberId - y.memberId)
        .map((n) => [n.memberId, n.unclearSince, n.trainings.map((t) => [t.trainingId, t.lines])])
    })
  );
}
