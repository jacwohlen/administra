import type { TrainerRole, TrainingPlanBreak, TrainingPlanSession } from '$lib/models';
import { breakOn, isCancelled } from '$lib/trainingPlanUtils';
import {
  bestMatch,
  normalizeName,
  SUGGEST_SCORE,
  type MatchableMember,
  type MemberMatch
} from './nameMatch';
import { cleanText, isIsoDate, MAX_LENGTH } from './proposals';
import type { AttendanceProposal, Confidence } from './types';

/**
 * Review of "Teilnehmerliste einlesen" (docs/AI_ASSISTANT.md): the names
 * on an attendance list become check-ins of the training the check-in page
 * shows, written like the page does it (participants upsert, then
 * set_attendance). Only ever marks people present, never removes anyone,
 * and leaves check-ins already recorded alone unless the user ticks
 * "overwrite" for a row.
 *
 * A list is either one session (every name was there on one date) or a
 * grid with a column per date. The draft holds what the user can change;
 * `reviewDraft` derives statuses, problems and the writes from it.
 */

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const;

/** A member as loaded for matching (members, not archived) */
export interface AttendanceMember extends MatchableMember {
  labels: string[];
}

/** English weekday of a YYYY-MM-DD date, as in trainings.weekday */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export type DateIssue = 'invalid' | 'future' | 'weekday' | 'duplicate';

/** Every issue but a weekday mismatch rules a date out; that one the user may override */
export function isHardIssue(issue: DateIssue | null): boolean {
  return issue !== null && issue !== 'weekday';
}

/** What is wrong with one date of the list, `weekday` being the training's */
export function dateIssue(date: string, today: string, weekday: string | null): DateIssue | null {
  if (!isIsoDate(date)) return 'invalid';
  if (date > today) return 'future';
  if (weekday && (WEEKDAYS as readonly string[]).includes(weekday) && weekdayOf(date) !== weekday) {
    return 'weekday';
  }
  return null;
}

export interface DateDraft {
  date: string;
  /** Check-ins on this date are written; off by default for a date with an issue */
  include: boolean;
}

/** The issue of each date; a date that occurs twice counts once */
export function dateIssues(
  dates: readonly DateDraft[],
  today: string,
  weekday: string | null
): (DateIssue | null)[] {
  return dates.map((d, i) => {
    const issue = dateIssue(d.date, today, weekday);
    if (issue === 'invalid') return issue;
    return dates.findIndex((o) => o.date === d.date) < i ? 'duplicate' : issue;
  });
}

/** A date the user typed in: included again unless something is wrong with it */
export function withDate(date: string, today: string, weekday: string | null): DateDraft {
  return { date, include: dateIssue(date, today, weekday) === null };
}

/**
 * What happens with a name: still to decide, an existing member, a new
 * member, or not taken over.
 */
export type EntryAction = 'open' | 'member' | 'create' | 'skip';

export interface EntryDraft {
  /** As written on the list */
  name: string;
  remark: string;
  confidence: Confidence;
  role: TrainerRole;
  action: EntryAction;
  memberId: number | null;
  /** Preselected as the likely member, but not certain: the user confirms it */
  unconfirmed: boolean;
  /**
   * The unconfirmed suggestion is on the roster, read with confidence and
   * written with the member's own last name (or as just their first name),
   * and no other roster member comes close: it may be confirmed together
   * with the others (`confirmRosterSuggestions`)
   */
  rosterSuggestion: boolean;
  /** Members the name could stand for, best first */
  candidates: number[];
  /** Names of a member to create, prefilled from the list */
  lastname: string;
  firstname: string;
  /** Present, per date of the draft (one session: a single true) */
  marks: boolean[];
  /** Rewrite check-ins already recorded with another role */
  overwrite: boolean;
}

export interface AttendanceDraft {
  /** Several dates with marks per person, rather than one session */
  grid: boolean;
  dates: DateDraft[];
  /** Dates written on the list, to point out another date than the chosen one */
  listDates: string[];
  entries: EntryDraft[];
}

export interface DraftOptions {
  members: readonly AttendanceMember[];
  /** Members on the training's roster, preferred when matching */
  roster: ReadonlySet<number>;
  /** Date of the check-in page the list was opened on */
  pageDate: string;
  today: string;
  /** trainings.weekday ('Monday'), null when not set */
  weekday: string | null;
}

/**
 * "Muster, Lena" → Muster / Lena. Otherwise the first word is the last name
 * (as when a member is created on the check-in page), or the last word when
 * the list writes first names first.
 */
export function splitName(
  name: string,
  lastNameFirst = true
): [lastname: string, firstname: string] {
  const comma = name.indexOf(',');
  if (comma > 0) return [name.slice(0, comma).trim(), name.slice(comma + 1).trim()];
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [words[0] ?? '', ''];
  return lastNameFirst
    ? [words[0], words.slice(1).join(' ')]
    : [words[words.length - 1], words.slice(0, -1).join(' ')];
}

/**
 * Whether the list writes "Nachname Vorname", judged by the names that
 * matched a member clearly; ties keep the check-in page's order.
 */
export function writesLastNameFirst(matched: { name: string; member: MatchableMember }[]): boolean {
  let lastFirst = 0;
  let firstLast = 0;
  for (const { name, member } of matched) {
    if (name.includes(',')) {
      lastFirst++;
      continue;
    }
    const [word = ''] = normalizeName(name).split(' ');
    if (word.length < 2) continue;
    if (normalizeName(member.lastname).startsWith(word)) lastFirst++;
    else if (normalizeName(member.firstname).startsWith(word.slice(0, 3))) firstLast++;
  }
  return lastFirst >= firstLast;
}

/**
 * A clear match the user still confirms: a former member or a trial
 * candidate who is not on the roster (putting a candidate on it marks their
 * trial as assigned).
 */
export function needsConfirmation(
  member: Pick<AttendanceMember, 'id' | 'labels'>,
  roster: ReadonlySet<number>
): boolean {
  const hint = memberHint(member);
  return (hint === 'former' || hint === 'trial') && !roster.has(member.id);
}

export function createDraft(proposal: AttendanceProposal, options: DraftOptions): AttendanceDraft {
  const { members, roster, pageDate, today, weekday } = options;
  const grid = proposal.entries.some((e) => e.dates.length > 0);
  // One session: the date on the list if it fits the training, else the page's
  const [written] = proposal.dates;
  const single =
    proposal.dates.length === 1 && dateIssue(written, today, weekday) === null ? written : pageDate;
  const dates = grid ? proposal.dates : [single];

  const matches = proposal.entries.map((e) => bestMatch(e.name, members, { preferred: roster }));
  // For names to create: in the order the list writes the names it shares with Administra
  const lastNameFirst = writesLastNameFirst(
    proposal.entries.flatMap((e, i) => {
      const member = matches[i].member;
      return member ? [{ name: e.name, member }] : [];
    })
  );

  const entries = proposal.entries.map((e, i): EntryDraft => {
    const match = matches[i];
    const top = match.candidates[0];
    const member = match.member ?? (top && top.score >= SUGGEST_SCORE ? top.member : null);
    const [lastname, firstname] = splitName(e.name, lastNameFirst);
    const unconfirmed =
      member !== null &&
      (match.member === null || e.confidence === 'low' || needsConfirmation(member, roster));
    return {
      name: e.name,
      remark: e.remark,
      confidence: e.confidence,
      role: e.role,
      action: member ? 'member' : 'open',
      memberId: member?.id ?? null,
      unconfirmed,
      rosterSuggestion:
        unconfirmed && member !== null && isRosterSuggestion(e, member, match.candidates, roster),
      candidates: match.candidates.map((c) => c.member.id),
      lastname,
      firstname,
      marks: grid ? dates.map((d) => e.dates.includes(d)) : [true],
      overwrite: false
    };
  });

  return {
    grid,
    dates: dates.map((date) => withDate(date, today, weekday)),
    listDates: [...proposal.dates],
    entries
  };
}

/** Lead a roster suggestion needs over every other roster member to be confirmed with the others */
const ROSTER_MARGIN = 0.1;

/** Words of a name, double names also by their parts, without initials' dots */
function nameParts(value: string): string[] {
  const out: string[] = [];
  for (const word of normalizeName(value).split(/[\s,]+/)) {
    const w = word.replace(/^[.-]+|[.-]+$/g, '');
    if (!w) continue;
    out.push(w);
    if (w.includes('-')) out.push(...w.split('-').filter(Boolean));
  }
  return out;
}

/**
 * The written name has the member's own last name, or is just their first
 * name (kids' lists); a look-alike last name ("Hug" for Hugentobler) is not
 */
function namesMember(written: string, member: MatchableMember): boolean {
  const last = new Set(nameParts(member.lastname));
  if (nameParts(written).some((w) => last.has(w))) return true;
  const first = normalizeName(written).replace(/\./g, '').trim();
  return first !== '' && first === normalizeName(member.firstname);
}

function isRosterSuggestion(
  entry: { name: string; confidence: Confidence },
  member: AttendanceMember,
  candidates: readonly MemberMatch<AttendanceMember>[],
  roster: ReadonlySet<number>
): boolean {
  if (!roster.has(member.id) || entry.confidence === 'low' || !namesMember(entry.name, member)) {
    return false;
  }
  const own = candidates.find((c) => c.member.id === member.id)?.score ?? 0;
  const rival = candidates.find((c) => c.member.id !== member.id && roster.has(c.member.id));
  return !rival || own - rival.score >= ROSTER_MARGIN;
}

/** A suggestion `confirmRosterSuggestions` confirms */
export function isRosterSuggestionOpen(entry: EntryDraft): boolean {
  return entry.action === 'member' && entry.unconfirmed && entry.rosterSuggestion;
}

/** Confirms every open roster suggestion (`EntryDraft.rosterSuggestion`); returns their rows */
export function confirmRosterSuggestions(entries: EntryDraft[]): number[] {
  const rows: number[] = [];
  entries.forEach((e, i) => {
    if (!isRosterSuggestionOpen(e)) return;
    e.unconfirmed = false;
    rows.push(i);
  });
  return rows;
}

/**
 * The user's choice in a row's select: `m:<id>` for a member, `create`,
 * `skip`, or '' for none. A choice of the user's own counts as confirmed.
 * A ticked "overwrite" was consent for the person chosen before, so it is
 * withdrawn.
 */
export function chooseEntry(
  entry: EntryDraft,
  value: string,
  isMember: (id: number) => boolean
): void {
  entry.unconfirmed = false;
  entry.rosterSuggestion = false;
  entry.overwrite = false;
  const id = value.startsWith('m:') ? Number(value.slice(2)) : NaN;
  if (Number.isInteger(id) && isMember(id)) {
    entry.action = 'member';
    entry.memberId = id;
  } else {
    entry.action = value === 'create' || value === 'skip' ? value : 'open';
    entry.memberId = null;
  }
}

/**
 * Points rows at a member that exists now: one the save created (confirmed)
 * or one an insert created despite reporting an error (to be confirmed).
 */
export function adoptMember(
  entries: EntryDraft[],
  rows: readonly number[],
  memberId: number,
  confirmed: boolean
): void {
  for (const i of rows) {
    const e = entries[i];
    e.action = 'member';
    e.memberId = memberId;
    e.unconfirmed = !confirmed;
    e.rosterSuggestion = false;
    e.overwrite = false;
  }
}

/** Key of a recorded check-in in `ReviewContext.existing` */
export function checkInKey(date: string, memberId: number): string {
  return `${date}|${memberId}`;
}

export interface ReviewContext {
  members: ReadonlyMap<number, AttendanceMember>;
  roster: ReadonlySet<number>;
  /** Check-ins already recorded for the training, by `checkInKey` */
  existing: ReadonlyMap<string, TrainerRole>;
  /** Dates the training plan has the session cancelled on */
  cancelled: ReadonlySet<string>;
  today: string;
  weekday: string | null;
}

/** Per date and row: what a mark means */
export type CellState =
  /** Not marked */
  | 'off'
  /** Marked, but the date is not taken over */
  | 'excluded'
  /** Marked; the row is not written yet (open, skipped, a problem) */
  | 'pending'
  | 'new'
  /** Recorded with the same role */
  | 'exists'
  /** Recorded with another role */
  | 'changed';

export type EntryStatus =
  | 'new'
  | 'exists'
  | 'changed'
  | 'invalid'
  | 'duplicate'
  | 'skipped'
  /** Nothing marked on a date that is taken over */
  | 'empty';

/** Why a row cannot be saved yet: pick a member, confirm the suggested one, complete the names */
export type EntryProblem = 'pick' | 'confirm' | 'name';

export interface DateReview {
  date: string;
  issue: DateIssue | null;
  /** Check-ins on this date are written */
  usable: boolean;
  /** The training plan has the session cancelled */
  cancelled: boolean;
  /** Rows marked present on this date (not skipped) */
  marked: number;
}

export interface EntryReview {
  status: EntryStatus;
  problem: EntryProblem | null;
  /** Index of the row this one is merged into (same person twice) */
  duplicateOf: number | null;
  member: AttendanceMember | null;
  /**
   * Not on the training's roster yet and checked in: added to it before the
   * check-ins. For a suggestion still to confirm: confirming it would add
   * them, so an off-roster pick is noticed before the click.
   */
  addsToRoster: boolean;
  cells: CellState[];
  /** Roles the differing check-ins were recorded with */
  existingRoles: TrainerRole[];
}

export interface NewMember {
  lastname: string;
  firstname: string;
}

/** One person to write, with everything merged from the rows that name them */
export interface PlannedMember {
  /** First row naming the person */
  entry: number;
  /** null for a member to create first */
  memberId: number | null;
  create: NewMember | null;
  addToRoster: boolean;
  checkIns: { date: string; role: TrainerRole }[];
}

export interface AttendanceReview {
  dates: DateReview[];
  entries: EntryReview[];
  /** Rows still waiting for a decision; nothing is saved while there are any */
  open: number;
  plan: PlannedMember[];
  checkIns: number;
  creates: number;
  rosterAdds: number;
}

const ROLE_RANK: Record<TrainerRole, number> = { attendee: 0, assistant: 1, main_trainer: 2 };

/** The names of a member to create as they are saved; null when one is missing */
export function newMemberNames(
  entry: Pick<EntryDraft, 'lastname' | 'firstname'>
): NewMember | null {
  const lastname = cleanText(entry.lastname, MAX_LENGTH.name);
  const firstname = cleanText(entry.firstname, MAX_LENGTH.name);
  return lastname && firstname ? { lastname, firstname } : null;
}

interface Identity {
  /** Same person, same key: 'm:12', or 'new:muster lena' for one to create */
  key: string | null;
  problem: EntryProblem | null;
  member: AttendanceMember | null;
  create: NewMember | null;
}

function identify(entry: EntryDraft, members: ReadonlyMap<number, AttendanceMember>): Identity {
  const none = { key: null, member: null, create: null };
  switch (entry.action) {
    case 'skip':
      return { ...none, problem: null };
    case 'open':
      return { ...none, problem: 'pick' };
    case 'member': {
      const member = entry.memberId === null ? undefined : members.get(entry.memberId);
      if (!member) return { ...none, problem: 'pick' };
      return {
        key: `m:${member.id}`,
        problem: entry.unconfirmed ? 'confirm' : null,
        member,
        create: null
      };
    }
    case 'create': {
      const create = newMemberNames(entry);
      if (!create) return { ...none, problem: 'name' };
      return {
        key: `new:${normalizeName(`${create.lastname} ${create.firstname}`)}`,
        problem: null,
        member: null,
        create
      };
    }
  }
}

interface Group {
  primary: number;
  identity: Identity;
  /** Role per date of the draft; null where no row marks the person */
  roles: (TrainerRole | null)[];
  overwrite: boolean;
}

/** The higher of two roles, a missing one counting as none */
function higherRole(a: TrainerRole | null, b: TrainerRole): TrainerRole {
  return a !== null && ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export function reviewDraft(draft: AttendanceDraft, ctx: ReviewContext): AttendanceReview {
  const issues = dateIssues(draft.dates, ctx.today, ctx.weekday);
  const usable = draft.dates.map((d, i) => d.include && !isHardIssue(issues[i]));
  const identities = draft.entries.map((e) => identify(e, ctx.members));

  // The same person twice (two rows, or a leader also listed as a
  // participant): merged into the first row; on a date both rows mark,
  // the higher role counts
  const groups = new Map<string, Group>();
  const duplicateOf = identities.map((identity, i): number | null => {
    if (!identity.key) return null;
    const group = groups.get(identity.key);
    if (group) return group.primary;
    groups.set(identity.key, {
      primary: i,
      identity,
      roles: draft.dates.map(() => null),
      overwrite: false
    });
    return null;
  });
  draft.entries.forEach((entry, i) => {
    const { key, problem } = identities[i];
    const group = key ? groups.get(key) : undefined;
    if (!group || problem) return;
    group.roles = group.roles.map((role, j) =>
      entry.marks[j] === true ? higherRole(role, entry.role) : role
    );
    group.overwrite ||= entry.overwrite;
  });

  const recorded = (memberId: number | null, date: string) =>
    memberId === null ? undefined : ctx.existing.get(checkInKey(date, memberId));
  // A check-in is written when none is recorded, or one with another role the user overwrites
  const writes = (before: TrainerRole | undefined, role: TrainerRole, overwrite: boolean) =>
    before === undefined || (before !== role && overwrite);

  // What is written per person: check-ins not recorded yet, and the ones
  // recorded with another role only when the user asked to overwrite them
  const planned = new Map<string, PlannedMember>();
  for (const [key, group] of groups) {
    const memberId = group.identity.member?.id ?? null;
    const checkIns = draft.dates.flatMap((d, j) => {
      const role = group.roles[j];
      if (!usable[j] || role === null) return [];
      return writes(recorded(memberId, d.date), role, group.overwrite)
        ? [{ date: d.date, role }]
        : [];
    });
    if (checkIns.length === 0) continue;
    planned.set(key, {
      entry: group.primary,
      memberId,
      create: group.identity.create,
      addToRoster: memberId === null || !ctx.roster.has(memberId),
      checkIns
    });
  }

  const entries = draft.entries.map((entry, i): EntryReview => {
    const { key, problem, member } = identities[i];
    // Rows written: an identified person without a problem (skipped rows have no key)
    const group = key && !problem ? groups.get(key) : undefined;
    const existingRoles = new Set<TrainerRole>();
    const cells = draft.dates.map((d, j): CellState => {
      if (!entry.marks[j]) return 'off';
      if (!usable[j]) return 'excluded';
      if (!group) return 'pending';
      const role = recorded(member?.id ?? null, d.date);
      if (role === undefined) return 'new';
      if (role === group.roles[j]) return 'exists';
      existingRoles.add(role);
      return 'changed';
    });
    let status: EntryStatus;
    if (entry.action === 'skip') status = 'skipped';
    else if (problem) status = 'invalid';
    else if (duplicateOf[i] !== null) status = 'duplicate';
    else if (cells.includes('changed')) status = 'changed';
    else if (cells.includes('new')) status = 'new';
    else if (cells.includes('exists')) status = 'exists';
    else status = 'empty';
    const addsToRoster = group
      ? key !== null && planned.get(key)?.addToRoster === true
      : problem === 'confirm' &&
        member !== null &&
        !ctx.roster.has(member.id) &&
        draft.dates.some(
          (d, j) =>
            entry.marks[j] === true &&
            usable[j] &&
            writes(recorded(member.id, d.date), entry.role, entry.overwrite)
        );
    return {
      status,
      problem,
      duplicateOf: duplicateOf[i],
      member,
      addsToRoster,
      cells,
      existingRoles: [...existingRoles]
    };
  });

  const plan = [...planned.values()].sort((a, b) => a.entry - b.entry);

  const dates = draft.dates.map((d, j): DateReview => ({
    date: d.date,
    issue: issues[j],
    usable: usable[j],
    cancelled: ctx.cancelled.has(d.date),
    marked: draft.entries.filter((e) => e.action !== 'skip' && e.marks[j]).length
  }));

  return {
    dates,
    entries,
    open: entries.filter((e) => e.problem !== null).length,
    plan,
    checkIns: plan.reduce((sum, p) => sum + p.checkIns.length, 0),
    creates: plan.filter((p) => p.create).length,
    rosterAdds: plan.filter((p) => p.addToRoster).length
  };
}

/** The rows merged into the person planned from row `primary` (`PlannedMember.entry`) */
export function personRows(review: Pick<AttendanceReview, 'entries'>, primary: number): number[] {
  return review.entries.flatMap((e, i) => (i === primary || e.duplicateOf === primary ? [i] : []));
}

/**
 * What a save could not write for one person: creating them, putting them
 * on the roster (either way none of their check-ins is saved), or some of
 * their check-ins. `createdAnyway`: the insert reported an error, but the
 * member exists; the rows now suggest them, to be confirmed.
 */
export type SaveStep = 'create' | 'createdAnyway' | 'roster' | 'checkIn';

export interface SaveFailure {
  step: SaveStep;
  /** null while the person to create does not exist */
  memberId: number | null;
  /** Check-ins not saved */
  checkIns: { date: string; role: TrainerRole }[];
}

/**
 * The failures still open with the recorded check-ins reloaded: a check-in
 * that committed despite the error is saved after all, and a person whose
 * check-ins all did is no failure any more.
 */
export function openFailures(
  failures: ReadonlyMap<number, SaveFailure>,
  existing: ReadonlyMap<string, TrainerRole>
): Map<number, SaveFailure> {
  const out = new Map<number, SaveFailure>();
  for (const [row, failure] of failures) {
    const { memberId } = failure;
    const checkIns = failure.checkIns.filter(
      (c) => memberId === null || existing.get(checkInKey(c.date, memberId)) !== c.role
    );
    if (failure.step === 'checkIn' && checkIns.length === 0) continue;
    out.set(row, { ...failure, checkIns });
  }
  return out;
}

/**
 * A member with exactly the names of `create` that was not known before: the
 * one an insert created although it reported an error (a timeout)
 */
export function createdAnyway<M extends MatchableMember>(
  create: NewMember,
  found: readonly M[],
  known: { has(id: number): boolean }
): M | null {
  const name = normalizeName(`${create.lastname} ${create.firstname}`);
  return (
    found.find((m) => !known.has(m.id) && normalizeName(`${m.lastname} ${m.firstname}`) === name) ??
    null
  );
}

/** Rows without a member yet, set to "not taken over" */
export function skipOpen(entries: EntryDraft[]): void {
  for (const e of entries) if (e.action === 'open') e.action = 'skip';
}

/**
 * Dates the training plan has the session cancelled on, read like the
 * check-in page does: breaks count only for trainings in the plan.
 */
export function cancelledDates(
  dates: readonly string[],
  plan: {
    planned: boolean;
    sessions: readonly Pick<TrainingPlanSession, 'date' | 'cancelled'>[];
    breaks: readonly TrainingPlanBreak[];
  }
): Set<string> {
  const out = new Set<string>();
  for (const date of dates) {
    const session = plan.sessions.find((s) => s.date === date) ?? null;
    const brk = plan.planned ? breakOn(date, [...plan.breaks]) : null;
    if ((plan.planned || session) && isCancelled(session, brk)) out.add(date);
  }
  return out;
}

const WEEKDAY_WORDS: Record<string, string> = {
  montag: 'Monday',
  monday: 'Monday',
  dienstag: 'Tuesday',
  tuesday: 'Tuesday',
  mittwoch: 'Wednesday',
  wednesday: 'Wednesday',
  donnerstag: 'Thursday',
  thursday: 'Thursday',
  freitag: 'Friday',
  friday: 'Friday',
  samstag: 'Saturday',
  saturday: 'Saturday',
  sonntag: 'Sunday',
  sunday: 'Sunday'
};

/** Weekdays named in full in a text ("Montagstraining", "Kids Dienstag") */
export function writtenWeekdays(text: string): string[] {
  const found = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    const day = Object.keys(WEEKDAY_WORDS).find((w) => word.startsWith(w));
    if (day) found.add(WEEKDAY_WORDS[day]);
  }
  return [...found];
}

/** Something worth knowing about a member before they are checked in */
export type MemberHint = 'former' | 'passive' | 'trial';

export function memberHint(member: Pick<AttendanceMember, 'labels'>): MemberHint | null {
  const labels = member.labels.map((l) => l.toLowerCase());
  if (labels.some((l) => l.includes('austritt'))) return 'former';
  if (labels.includes('passiv')) return 'passive';
  if (labels.includes('probetraining')) return 'trial';
  return null;
}

/** What tells members with the same name apart in a select */
export type MemberDetail = 'roster' | 'notRoster' | MemberHint | 'new';

export interface TwinDetails {
  details: MemberDetail[];
  /** The details are the same for two of them: the id is shown as well */
  showId: boolean;
}

/**
 * Members whose name another member shares, by id ("Muster Hans" twice:
 * often a member created on the check-in page and the later Webling
 * record), with what tells them apart: the roster, the labels, else the id.
 */
export function nameTwins(
  members: readonly AttendanceMember[],
  roster: ReadonlySet<number>
): Map<number, TwinDetails> {
  const byName = new Map<string, AttendanceMember[]>();
  for (const m of members) {
    const name = normalizeName(`${m.lastname} ${m.firstname}`);
    const same = byName.get(name);
    if (same) same.push(m);
    else byName.set(name, [m]);
  }
  const out = new Map<number, TwinDetails>();
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    const details = same.map((m): MemberDetail[] => {
      const hint = memberHint(m);
      return [
        roster.has(m.id) ? 'roster' : 'notRoster',
        ...(hint ? [hint] : []),
        ...(m.labels.some((l) => l.toLowerCase() === 'new') ? (['new'] as const) : [])
      ];
    });
    const keys = details.map((d) => d.join());
    same.forEach((m, i) =>
      out.set(m.id, {
        details: details[i],
        showId: keys.filter((k) => k === keys[i]).length > 1
      })
    );
  }
  return out;
}

/** Members by last and first name */
export function sortMembers<M extends MatchableMember>(members: readonly M[]): M[] {
  return [...members].sort(
    (a, b) =>
      a.lastname.localeCompare(b.lastname, 'de') || a.firstname.localeCompare(b.firstname, 'de')
  );
}

/** Members whose name has a word starting with every word of `query` */
export function filterMembers<M extends MatchableMember>(
  members: readonly M[],
  query: string
): M[] {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...members];
  return members.filter((m) => {
    const name = normalizeName(`${m.firstname} ${m.lastname}`).split(/[\s-]+/);
    return words.every((w) => name.some((n) => n.startsWith(w)));
  });
}

/** Labels as stored (jsonb): only the strings of an array */
export function labelList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((l): l is string => typeof l === 'string') : [];
}

/**
 * All rows of a query, page by page: PostgREST returns at most 1000 rows
 * per request. `fetchPage` gets the inclusive range for `.range()`.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
