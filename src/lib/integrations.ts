import type { MembershipStatus } from './models';
import { isMissingSchemaError } from './eventLinks';

/**
 * The Integrations page (/dashboard/integrations, admins) and the warning
 * dot on the avatar: integration_status(), the run log (integration_runs)
 * and issues (integration_issues) of the integration layer, and the
 * mapping editor's changes for integration_set_mapping()
 * (docs/INTEGRATIONS.md). Pure, so the page and the dashboard layout only
 * load and render.
 */

/** A members or events run older than this without success is a warning */
export const STALE_HOURS = 36;

export type SyncKind = 'members' | 'events';
export type RunKind = SyncKind | 'config';
export type RunStatus = 'running' | 'applied' | 'refused' | 'ok' | 'warning' | 'failed';
export type IssueSeverity = 'info' | 'warning' | 'error';

/** The latest run of one kind, as integration_status() gives it (dry runs left out) */
export interface LastRun {
  id: number;
  status: RunStatus;
  dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  /** The guard that refused it (members_gone, status_drop, …) */
  refused: string | null;
  error: string | null;
}

export interface LinkCounts {
  linked: number;
  gone: number;
  last_seen_at: string | null;
}

/** One connection of integration_status() */
export interface ConnectionStatus {
  id: string;
  provider: string;
  display_name: string;
  enabled: boolean;
  runs_in: 'sync' | 'app';
  members: LinkCounts;
  events: LinkCounts;
  /** Holidays the connection brought (training_plan_breaks) */
  breaks: number;
  /** Catalog rows seen for the first time, not reviewed by an admin yet */
  to_review: { groups: number; calendars: number };
  last_run: Partial<Record<RunKind, LastRun | null>>;
  /** finished_at of the latest ok or warning run */
  last_success: Partial<Record<SyncKind, string | null>>;
  /** Open issues (neither resolved nor dismissed) by severity */
  issues: Record<IssueSeverity, number>;
}

/** A row of integration_runs: codes, ids and counts, never names */
export interface IntegrationRun {
  id: number;
  connection: string;
  kind: RunKind;
  scope: Record<string, unknown>;
  trigger: 'schedule' | 'manual' | 'app';
  runner: string | null;
  dry_run: boolean;
  status: RunStatus;
  started_at: string;
  applied_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown>;
  guard: Record<string, unknown>;
  accepted: Record<string, unknown>;
  adapter: Record<string, unknown>;
  error: string | null;
}

export const RUN_COLUMNS =
  'id, connection, kind, scope, trigger, runner, dry_run, status, started_at, applied_at, finished_at, result, guard, accepted, adapter, error';

/** A row of integration_issues */
export interface IntegrationIssue {
  id: number;
  connection: string;
  kind: SyncKind;
  code: string;
  severity: IssueSeverity;
  /** The provider's record, '' when the issue is about none */
  external_id: string;
  member_id: number | null;
  other_member_id: number | null;
  event_id: number | null;
  /** A code ('email', 'name_birthday', '23514'), never a value */
  detail: string | null;
  first_seen_at: string;
  last_seen_at: string;
  dismissed_at: string | null;
}

/** An event an issue names, as the page loads it */
export interface IssueEvent {
  id: number;
  title: string;
  date: string;
}

export const ISSUE_COLUMNS =
  'id, connection, kind, code, severity, external_id, member_id, other_member_id, event_id, detail, first_seen_at, last_seen_at, dismissed_at';

/**
 * integration_status() or a run table query on a database without the
 * integration layer (Netlify may deploy the app before a promotion applies
 * the migration): a missing function or table
 */
export function isLayerMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return isMissingSchemaError(error) || code === 'PGRST202' || code === '42883';
}

// ----- integration_status() -----

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function linkCounts(value: unknown): LinkCounts {
  const v = obj(value);
  return { linked: num(v.linked), gone: num(v.gone), last_seen_at: str(v.last_seen_at) };
}

function lastRun(value: unknown): LastRun | null {
  const v = obj(value);
  if (v.id == null || typeof v.status !== 'string') return null;
  return {
    id: num(v.id),
    status: v.status as RunStatus,
    dry_run: v.dry_run === true,
    started_at: str(v.started_at) ?? '',
    finished_at: str(v.finished_at),
    refused: str(v.refused),
    error: str(v.error)
  };
}

/** integration_status()'s answer, every field defaulted, so nothing on the page reads undefined */
export function parseConnectionStatuses(data: unknown): ConnectionStatus[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw): ConnectionStatus[] => {
    const c = obj(raw);
    const id = str(c.id);
    if (!id) return [];
    const runs = obj(c.last_run);
    const success = obj(c.last_success);
    const issues = obj(c.issues);
    const review = obj(c.to_review);
    return [
      {
        id,
        provider: str(c.provider) ?? id,
        display_name: str(c.display_name) ?? id,
        enabled: c.enabled !== false,
        runs_in: c.runs_in === 'app' ? 'app' : 'sync',
        members: linkCounts(c.members),
        events: linkCounts(c.events),
        breaks: num(c.breaks),
        to_review: { groups: num(review.groups), calendars: num(review.calendars) },
        last_run: {
          members: lastRun(runs.members),
          events: lastRun(runs.events),
          config: lastRun(runs.config)
        },
        last_success: { members: str(success.members), events: str(success.events) },
        issues: { error: num(issues.error), warning: num(issues.warning), info: num(issues.info) }
      }
    ];
  });
}

// ----- What needs an admin -----

export type IntegrationAlert =
  /** The latest run was stopped by a guard; the override is in its run row */
  | { code: 'refused'; kind: SyncKind; refused: string | null; runId: number }
  | { code: 'failed'; kind: SyncKind; error: string | null; runId: number }
  /** No success for STALE_HOURS (null: none at all) */
  | { code: 'stale'; kind: SyncKind; lastSuccess: string | null }
  /** Open issues with severity error */
  | { code: 'errors'; count: number };

const SYNC_KINDS: readonly SyncKind[] = ['members', 'events'];

/** Whether the latest success is older than STALE_HOURS (or there is none) */
export function isStale(lastSuccess: string | null | undefined, now: Date | number): boolean {
  if (!lastSuccess) return true;
  const at = Date.parse(lastSuccess);
  return !Number.isFinite(at) || Number(now) - at > STALE_HOURS * 3_600_000;
}

/**
 * What an admin should look at for a connection: the latest members or
 * events run refused or failed, no success for 36 hours, open errors. A
 * kind the layer never ran (before phase 3's switch, or a connection
 * without events) and a disabled connection raise nothing.
 */
export function connectionAlerts(
  c: ConnectionStatus,
  now: Date | number = Date.now()
): IntegrationAlert[] {
  if (!c.enabled) return [];
  const alerts: IntegrationAlert[] = [];
  for (const kind of SYNC_KINDS) {
    const last = c.last_run[kind];
    if (!last) continue;
    if (last.status === 'refused') {
      alerts.push({ code: 'refused', kind, refused: last.refused, runId: last.id });
    } else if (last.status === 'failed') {
      alerts.push({ code: 'failed', kind, error: last.error, runId: last.id });
    }
    const success = c.last_success[kind] ?? null;
    if (isStale(success, now)) alerts.push({ code: 'stale', kind, lastSuccess: success });
  }
  if (c.issues.error > 0) alerts.push({ code: 'errors', count: c.issues.error });
  return alerts;
}

/** The avatar's warning dot: any connection with an alert */
export function needsAttention(
  connections: readonly ConnectionStatus[],
  now: Date | number = Date.now()
): boolean {
  return connections.some((c) => connectionAlerts(c, now).length > 0);
}

/**
 * Before phase 3's switch the legacy sync still writes members and predicts
 * statuses with the old rule (member_status_from_labels()): a mapping
 * changed now would make it refuse or mispredict. The switch shows as the
 * connection's first real (not dry) members run of the layer.
 */
export function beforeLayerSwitch(c: ConnectionStatus): boolean {
  return !c.last_run.members;
}

// ----- Runs -----

/** Chip colours, as the trial e-mail statuses (sent, pending, skipped, failed) */
export function runStatusClass(status: RunStatus): string {
  switch (status) {
    case 'ok':
      return 'preset-tonal-success';
    case 'warning':
      return 'preset-tonal-warning';
    case 'refused':
    case 'failed':
      return 'preset-tonal-error';
    default:
      return 'preset-tonal-surface';
  }
}

export type OverrideKey =
  'accept_gone' | 'accept_status_drop' | 'accept_status_gain' | 'accept_events_gone';

/**
 * The exact override a refused run needs (the apply's hint, which the run
 * row does not keep), from its guard numbers; null when there is none
 * (empty_snapshot: check the provider instead)
 */
export function refusalOverride(guard: unknown): { key: OverrideKey; count: number } | null {
  const g = obj(guard);
  switch (g.refused) {
    case 'members_gone': {
      const m = obj(g.members);
      return { key: 'accept_gone', count: num(m.to_gone) + num(m.former) };
    }
    case 'status_drop':
      return { key: 'accept_status_drop', count: num(obj(g.status).dropping) };
    case 'status_gain':
      return { key: 'accept_status_gain', count: num(obj(g.status).gaining) };
    case 'events_gone':
      return { key: 'accept_events_gone', count: num(obj(g.events).to_gone) };
    default:
      return null;
  }
}

/** The counts the run table shows per kind, in this order (page.integrations.count.*) */
export const RUN_COUNT_KEYS: Record<RunKind, readonly string[]> = {
  members: [
    'received',
    'inserted',
    'adopted',
    'revived',
    'updated',
    'gone',
    'former',
    'statuses_recomputed',
    'held',
    'invalid',
    'conflicts',
    'write_failed'
  ],
  events: [
    'received',
    'inserted',
    'adopted',
    'revived',
    'updated',
    'gone',
    'deleted',
    'kept',
    'breaks_inserted',
    'breaks_adopted',
    'breaks_updated',
    'breaks_deleted',
    'holiday_events_deleted',
    'holiday_events_kept',
    'registrations_added',
    'registrations_removed',
    'registrations_adopted',
    'invalid',
    'conflicts',
    'write_failed'
  ],
  config: ['groups', 'calendars', 'statuses_changed']
};

/** A run's counts other than zero, as [key, count] */
export function runCounts(run: Pick<IntegrationRun, 'kind' | 'result'>): [string, number][] {
  const result = obj(run.result);
  return (RUN_COUNT_KEYS[run.kind] ?? []).flatMap((key): [string, number][] => {
    const n = num(result[key]);
    return n > 0 ? [[key, n]] : [];
  });
}

/** The overrides a run used ('accept_gone=60') */
export function acceptedOverrides(run: Pick<IntegrationRun, 'accepted'>): string[] {
  return Object.entries(obj(run.accepted)).map(([key, n]) => `accept_${key}=${num(n)}`);
}

/** Records the adapter could not fetch (its report) */
export function adapterErrors(run: Pick<IntegrationRun, 'adapter'>): number {
  return num(obj(run.adapter).errors);
}

// ----- Issues -----

export interface IssueGroup {
  connection: string;
  kind: SyncKind;
  code: string;
  /** The highest severity in the group */
  severity: IssueSeverity;
  open: IntegrationIssue[];
  dismissed: IntegrationIssue[];
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Which members and events the page loaded */
export interface IssueRecordsLoaded {
  member: (id: number) => boolean;
  event: (id: number) => boolean;
}

/**
 * Whether the page can show an issue. Issues have no foreign keys, so the
 * member or event one names may not exist: merged or deleted since, or never
 * written (an older row of a new record whose insert failed). Such an issue
 * still counts in the alerts (a failed insert is noted again by every run),
 * so it is shown by the provider's record number instead. Left out is only
 * what has nothing else to show it by: a possible duplicate whose pair is
 * gone (no duplicate any more; every members run checks those again) and an
 * issue without a record number.
 */
export function issueShown(issue: IntegrationIssue, loaded: IssueRecordsLoaded): boolean {
  const missing = (id: number | null) => id != null && !loaded.member(id);
  if (issue.code === 'possible_duplicate') {
    return !missing(issue.member_id) && !missing(issue.other_member_id);
  }
  const gone =
    missing(issue.member_id) ||
    missing(issue.other_member_id) ||
    (issue.event_id != null && !loaded.event(issue.event_id));
  return !gone || issue.external_id !== '';
}

/**
 * Issues grouped by connection, kind and code: errors first, then warnings,
 * then info; open ones newest first, dismissed ones apart. Only those the
 * page can show (issueShown()).
 */
export function groupIssues(
  issues: readonly IntegrationIssue[],
  loaded: IssueRecordsLoaded
): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    if (!issueShown(issue, loaded)) continue;
    const key = `${issue.connection}\u0000${issue.kind}\u0000${issue.code}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        connection: issue.connection,
        kind: issue.kind,
        code: issue.code,
        severity: issue.severity,
        open: [],
        dismissed: []
      };
      groups.set(key, group);
    }
    if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[group.severity]) {
      group.severity = issue.severity;
    }
    (issue.dismissed_at ? group.dismissed : group.open).push(issue);
  }
  const newestFirst = (a: IntegrationIssue, b: IntegrationIssue) =>
    b.last_seen_at.localeCompare(a.last_seen_at) || b.id - a.id;
  const list = [...groups.values()];
  for (const g of list) {
    g.open.sort(newestFirst);
    g.dismissed.sort(newestFirst);
  }
  return list.sort(
    (a, b) =>
      Number(a.open.length === 0) - Number(b.open.length === 0) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.kind.localeCompare(b.kind) ||
      a.code.localeCompare(b.code)
  );
}

/** The member and event ids issues name, to load their names */
export function issueReferences(issues: readonly IntegrationIssue[]): {
  members: number[];
  events: number[];
} {
  const members = new Set<number>();
  const events = new Set<number>();
  for (const i of issues) {
    if (i.member_id != null) members.add(i.member_id);
    if (i.other_member_id != null) members.add(i.other_member_id);
    if (i.event_id != null) events.add(i.event_id);
  }
  return { members: [...members], events: [...events] };
}

// ----- Mapping editor -----

export type GroupRole = 'trainer';
export type CalendarTarget = 'event' | 'break' | 'ignore';

/** A row of integration_member_groups */
export interface MemberGroupRow {
  id: number;
  connection: string;
  external_id: string | null;
  name: string;
  label: string | null;
  status: MembershipStatus | null;
  rank: number;
  hidden: boolean;
  role: GroupRole | null;
  reviewed: boolean;
  last_seen_at: string | null;
}

/** A row of integration_calendars */
export interface CalendarRow {
  id: number;
  connection: string;
  external_id: string | null;
  name: string;
  target: CalendarTarget;
  section: string | null;
  closed_max_days: number | null;
  reviewed: boolean;
  last_seen_at: string | null;
}

export const GROUP_COLUMNS =
  'id, connection, external_id, name, label, status, rank, hidden, role, reviewed, last_seen_at';
export const CALENDAR_COLUMNS =
  'id, connection, external_id, name, target, section, closed_max_days, reviewed, last_seen_at';

/** What the editor's inputs hold for a group ('' for none; text inputs as typed) */
export interface GroupDraft {
  status: MembershipStatus | '';
  rank: string;
  hidden: boolean;
  role: GroupRole | '';
  /** An admin confirmed a new group as it is */
  reviewed: boolean;
}

export interface CalendarDraft {
  target: CalendarTarget;
  section: string;
  closedMaxDays: string;
  reviewed: boolean;
}

export function groupDraft(row: MemberGroupRow): GroupDraft {
  return {
    status: row.status ?? '',
    rank: String(row.rank),
    hidden: row.hidden,
    role: row.role ?? '',
    reviewed: row.reviewed
  };
}

export function calendarDraft(row: CalendarRow): CalendarDraft {
  return {
    target: row.target,
    section: row.section ?? '',
    closedMaxDays: row.closed_max_days == null ? '' : String(row.closed_max_days),
    reviewed: row.reviewed
  };
}

/** Whether two drafts hold the same values */
export function sameDraft<D extends GroupDraft | CalendarDraft>(a: D, b: D): boolean {
  return (Object.keys(b) as (keyof D)[]).every((k) => a[k] === b[k]);
}

/**
 * A draft after its row loaded again (another admin saved, or the page
 * reloaded after a dismiss or merge). `base` is the draft of the row it was
 * made from, `fresh` the draft of the row now. A value the admin left as it
 * was loaded takes the row's value now, so a change saved meanwhile is not
 * sent back as one of ours; what the admin changed stays. Without a draft
 * (a new row) or a base: the row's values.
 */
export function rebaseDraft<D extends GroupDraft | CalendarDraft>(
  draft: D | undefined,
  base: D | undefined,
  fresh: D
): D {
  if (!draft || !base) return { ...fresh };
  const next = { ...draft };
  for (const k of Object.keys(fresh) as (keyof D)[]) {
    if (draft[k] === base[k]) next[k] = fresh[k];
  }
  return next;
}

/** integration_set_mapping()'s p_changes: catalog row ids and the keys that change */
export interface MappingChanges {
  groups: {
    id: number;
    status?: MembershipStatus | null;
    rank?: number;
    hidden?: boolean;
    role?: GroupRole | null;
  }[];
  calendars: {
    id: number;
    target?: CalendarTarget;
    section?: string | null;
    closed_max_days?: number | null;
  }[];
}

/** 0–999, as integration_set_mapping() takes it; null when not such a number */
function smallNumber(input: string): number | null {
  const s = input.trim();
  return /^\d{1,3}$/.test(s) ? Number(s) : null;
}

/**
 * The changes to send: rows whose inputs differ from the catalog, and new
 * rows an admin confirmed as they are (a row listed is marked reviewed).
 * `invalid` lists rows whose input integration_set_mapping() would refuse
 * (rank or days not a number 0–999, a section over 40 characters).
 */
export function mappingChanges(
  groups: readonly MemberGroupRow[],
  groupDrafts: Readonly<Record<number, GroupDraft>>,
  calendars: readonly CalendarRow[],
  calendarDrafts: Readonly<Record<number, CalendarDraft>>
): { changes: MappingChanges; invalid: number[] } {
  const changes: MappingChanges = { groups: [], calendars: [] };
  const invalid: number[] = [];

  for (const row of groups) {
    const d = groupDrafts[row.id];
    if (!d) continue;
    const change: MappingChanges['groups'][number] = { id: row.id };
    const status = d.status || null;
    if (status !== row.status) change.status = status;
    const rank = smallNumber(d.rank);
    if (rank === null) {
      invalid.push(row.id);
      continue;
    }
    if (rank !== row.rank) change.rank = rank;
    if (d.hidden !== row.hidden) change.hidden = d.hidden;
    const role = d.role || null;
    if (role !== row.role) change.role = role;
    if (Object.keys(change).length > 1 || (!row.reviewed && d.reviewed)) {
      changes.groups.push(change);
    }
  }

  for (const row of calendars) {
    const d = calendarDrafts[row.id];
    if (!d) continue;
    const change: MappingChanges['calendars'][number] = { id: row.id };
    if (d.target !== row.target) change.target = d.target;
    const section = d.section.trim() || null;
    if (section !== null && section.length > 40) {
      invalid.push(row.id);
      continue;
    }
    if (section !== row.section) change.section = section;
    const days = d.closedMaxDays.trim() === '' ? null : smallNumber(d.closedMaxDays);
    if (days === null && d.closedMaxDays.trim() !== '') {
      invalid.push(row.id);
      continue;
    }
    if (days !== row.closed_max_days) change.closed_max_days = days;
    if (Object.keys(change).length > 1 || (!row.reviewed && d.reviewed)) {
      changes.calendars.push(change);
    }
  }
  return { changes, invalid };
}

/** integration_set_mapping()'s answer */
export interface MappingResult {
  run: number | null;
  status: 'ok' | 'dry_run' | 'refused';
  groups: number;
  calendars: number;
  statuses_changed: number;
  /** integration_status_guard(): members losing or starting a membership that counts */
  guard: {
    dropping: number;
    gaining: number;
    /** For all members that count together (per status: more than half of that status) */
    limit: number;
    over_drop: boolean;
    over_gain: boolean;
    /** Those dropping by the status they had */
    by_status: Record<string, number>;
    became: Record<string, number>;
  };
  hint: string | null;
}

function counts(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(obj(value)).map(([k, v]) => [k, num(v)]));
}

export function parseMappingResult(data: unknown): MappingResult {
  const d = obj(data);
  const g = obj(d.guard);
  return {
    run: d.run == null ? null : num(d.run),
    status: d.status === 'ok' || d.status === 'refused' ? d.status : 'dry_run',
    groups: num(d.groups),
    calendars: num(d.calendars),
    statuses_changed: num(d.statuses_changed),
    guard: {
      dropping: num(g.dropping),
      gaining: num(g.gaining),
      limit: num(g.limit),
      over_drop: g.over_drop === true,
      over_gain: g.over_gain === true,
      by_status: counts(g.by_status),
      became: counts(g.became)
    },
    hint: str(d.hint)
  };
}

/**
 * The preview's line about members losing their membership (null: none
 * do). integration_status_guard() refuses more than its limit for all that
 * count, or more than half of one status while the total stays within the
 * limit; the second must not print the limit next to a smaller number, so
 * it names the status (with several, each one's count: the answer does
 * not tell which of them is over half).
 */
export type DropLine =
  | { key: 'dropping'; count: number; limit: number }
  | { key: 'droppingStatus'; count: number; status: string }
  | { key: 'droppingStatuses'; count: number; statuses: [string, number][] };

export function dropLine(guard: MappingResult['guard']): DropLine | null {
  const { dropping: count, limit } = guard;
  if (count <= 0) return null;
  const statuses = Object.entries(guard.by_status)
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  // Within both rules, or over the limit for all: the total and the limit
  // (also for an answer without by_status, which tells the total only)
  if (!guard.over_drop || count > limit || statuses.length === 0) {
    return { key: 'dropping', count, limit };
  }
  return statuses.length === 1
    ? { key: 'droppingStatus', count, status: statuses[0][0] }
    : { key: 'droppingStatuses', count, statuses };
}

/**
 * The overrides Save sends after the admin confirmed the preview: exactly
 * the numbers the preview was over the guard with. Should they differ by
 * then (a run changed statuses in between), the save is refused and shows
 * the new numbers.
 */
export function mappingAccept(preview: MappingResult): Record<string, number> {
  const accept: Record<string, number> = {};
  if (preview.guard.over_drop) accept.accept_status_drop = preview.guard.dropping;
  if (preview.guard.over_gain) accept.accept_status_gain = preview.guard.gaining;
  return accept;
}

/**
 * What a preview was made for, compared to tell whether it still fits: the
 * changes and the rows they apply to as loaded. That is every group (any
 * group's status or rank can change a member's status, so the numbers
 * depend on all of them) and the calendars changed. When another admin's
 * save reloads those rows, the preview no longer fits and Save waits for a
 * new one.
 */
export function changesKey(
  changes: MappingChanges,
  groups: readonly MemberGroupRow[],
  calendars: readonly CalendarRow[]
): string {
  const changed = new Set(changes.calendars.map((c) => c.id));
  return JSON.stringify({
    changes,
    groups: [...groups]
      .sort((a, b) => a.id - b.id)
      .map((g) => [g.id, g.status, g.rank, g.hidden, g.role, g.reviewed]),
    calendars: calendars
      .filter((c) => changed.has(c.id))
      .sort((a, b) => a.id - b.id)
      .map((c) => [c.id, c.target, c.section, c.closed_max_days, c.reviewed])
  });
}
