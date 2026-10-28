import { describe, it, expect } from 'vitest';
import {
  STALE_HOURS,
  acceptedOverrides,
  adapterErrors,
  beforeLayerSwitch,
  calendarDraft,
  changesKey,
  connectionAlerts,
  groupDraft,
  groupIssues,
  isLayerMissing,
  isStale,
  issueReferences,
  mappingAccept,
  mappingChanges,
  needsAttention,
  parseConnectionStatuses,
  parseMappingResult,
  refusalOverride,
  runCounts,
  runStatusClass,
  type CalendarRow,
  type ConnectionStatus,
  type IntegrationIssue,
  type LastRun,
  type MemberGroupRow
} from './integrations';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

// integration_status() as the populated test database answered it
const STATUS = {
  id: 'webling',
  provider: 'webling',
  display_name: 'Webling',
  enabled: true,
  runs_in: 'sync',
  members: { gone: 0, linked: 517, last_seen_at: '2026-10-28T09:42:09.151374+00:00' },
  events: { gone: 0, linked: 40, last_seen_at: '2026-10-28T09:42:10.106569+00:00' },
  breaks: 0,
  to_review: { groups: 5, calendars: 0 },
  last_run: {
    config: null,
    events: {
      id: 5,
      error: null,
      status: 'ok',
      dry_run: false,
      refused: null,
      started_at: '2026-10-28T09:42:10.106569+00:00',
      finished_at: '2026-10-28T09:42:10.106569+00:00'
    },
    members: {
      id: 4,
      error: 'fetch_failed',
      status: 'warning',
      dry_run: false,
      refused: null,
      started_at: '2026-10-28T09:42:09.151374+00:00',
      finished_at: '2026-10-28T09:42:09.151374+00:00'
    }
  },
  last_success: {
    events: '2026-10-28T09:42:10.106569+00:00',
    members: '2026-10-28T09:42:09.151374+00:00'
  },
  issues: { info: 1, error: 0, warning: 2 }
};

function run(values: Partial<LastRun> = {}): LastRun {
  return {
    id: 1,
    status: 'ok',
    dry_run: false,
    started_at: iso(2 * HOUR),
    finished_at: iso(2 * HOUR),
    refused: null,
    error: null,
    ...values
  };
}

function connection(values: Partial<ConnectionStatus> = {}): ConnectionStatus {
  return { ...parseConnectionStatuses([STATUS])[0], ...values };
}

describe('parseConnectionStatuses', () => {
  it('reads integration_status()', () => {
    const [c] = parseConnectionStatuses([STATUS]);
    expect(c.id).toBe('webling');
    expect(c.runs_in).toBe('sync');
    expect(c.members.linked).toBe(517);
    expect(c.to_review).toEqual({ groups: 5, calendars: 0 });
    expect(c.last_run.members?.status).toBe('warning');
    expect(c.last_run.config).toBeNull();
    expect(c.issues).toEqual({ error: 0, warning: 2, info: 1 });
  });

  it('defaults what is missing and skips rows without id', () => {
    expect(parseConnectionStatuses(null)).toEqual([]);
    expect(parseConnectionStatuses({})).toEqual([]);
    const [c] = parseConnectionStatuses([{ id: 'csv' }, { display_name: 'x' }, null]);
    expect(c).toMatchObject({
      id: 'csv',
      display_name: 'csv',
      enabled: true,
      runs_in: 'sync',
      members: { linked: 0, gone: 0, last_seen_at: null },
      breaks: 0,
      last_run: { members: null, events: null, config: null },
      last_success: { members: null, events: null },
      issues: { error: 0, warning: 0, info: 0 }
    });
  });
});

describe('isLayerMissing', () => {
  it('knows a missing function or table', () => {
    for (const code of ['PGRST202', '42883', 'PGRST205', '42P01']) {
      expect(isLayerMissing({ code })).toBe(true);
    }
    expect(isLayerMissing({ code: '42501' })).toBe(false);
    expect(isLayerMissing(null)).toBe(false);
  });
});

describe('connectionAlerts', () => {
  it('has nothing to say about a healthy connection', () => {
    expect(connectionAlerts(connection(), NOW)).toEqual([]);
  });

  it('reports a refused or failed latest run with its run id', () => {
    const c = connection({
      last_run: {
        members: run({ id: 9, status: 'refused', refused: 'members_gone' }),
        events: run({ id: 10, status: 'failed', error: '23514 events_date_check' })
      },
      last_success: { members: iso(3 * HOUR), events: iso(3 * HOUR) }
    });
    expect(connectionAlerts(c, NOW)).toEqual([
      { code: 'refused', kind: 'members', refused: 'members_gone', runId: 9 },
      { code: 'failed', kind: 'events', error: '23514 events_date_check', runId: 10 }
    ]);
  });

  it('warns when the latest success is older than 36 hours, or there is none', () => {
    const old = iso((STALE_HOURS + 1) * HOUR);
    const c = connection({
      last_run: { members: run({ status: 'running' }), events: run() },
      last_success: { members: old, events: null }
    });
    expect(connectionAlerts(c, NOW)).toEqual([
      { code: 'stale', kind: 'members', lastSuccess: old },
      { code: 'stale', kind: 'events', lastSuccess: null }
    ]);
  });

  it('reports open errors', () => {
    const c = connection({ issues: { error: 2, warning: 5, info: 9 } });
    expect(connectionAlerts(c, NOW)).toEqual([{ code: 'errors', count: 2 }]);
  });

  it('says nothing while the layer never ran a kind, or the connection is off', () => {
    const never = connection({ last_run: {}, last_success: {} });
    expect(connectionAlerts(never, NOW)).toEqual([]);
    const off = connection({ enabled: false, issues: { error: 3, warning: 0, info: 0 } });
    expect(connectionAlerts(off, NOW)).toEqual([]);
  });
});

describe('needsAttention (the avatar dot)', () => {
  it('is set by any connection with an alert', () => {
    expect(needsAttention([], NOW)).toBe(false);
    expect(needsAttention([connection()], NOW)).toBe(false);
    const refused = connection({
      last_run: { members: run({ status: 'refused', refused: 'status_drop' }) }
    });
    expect(needsAttention([connection(), refused], NOW)).toBe(true);
  });

  it('is not set before the layer ever ran', () => {
    const before = parseConnectionStatuses([{ ...STATUS, last_run: {}, last_success: {} }]);
    expect(needsAttention(before, NOW)).toBe(false);
  });
});

describe('isStale', () => {
  it('compares with 36 hours', () => {
    expect(isStale(iso(STALE_HOURS * HOUR - 1000), NOW)).toBe(false);
    expect(isStale(iso(STALE_HOURS * HOUR + 1000), NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale('not a date', NOW)).toBe(true);
  });
});

describe('beforeLayerSwitch', () => {
  it('holds until the first real members run of the layer', () => {
    expect(beforeLayerSwitch(connection({ last_run: {} }))).toBe(true);
    expect(beforeLayerSwitch(connection({ last_run: { events: run() } }))).toBe(true);
    expect(beforeLayerSwitch(connection())).toBe(false);
  });
});

describe('refusalOverride', () => {
  it('gives the exact override of each guard', () => {
    // As integration_apply() stored it for a run with 60 members gone
    const gone = {
      members: {
        limit: 51,
        former: 0,
        staged: 456,
        to_gone: 60,
        complete: true,
        active_links: 516
      },
      refused: 'members_gone',
      new_catalog_rows: 0
    };
    expect(refusalOverride(gone)).toEqual({ key: 'accept_gone', count: 60 });
    // Never-linked rows in the range count with the gone ones
    const former = { ...gone, members: { ...gone.members, to_gone: 3, former: 50 } };
    expect(refusalOverride(former)).toEqual({ key: 'accept_gone', count: 53 });
    const status = { status: { dropping: 153, gaining: 7 } };
    expect(refusalOverride({ ...status, refused: 'status_drop' })).toEqual({
      key: 'accept_status_drop',
      count: 153
    });
    expect(refusalOverride({ ...status, refused: 'status_gain' })).toEqual({
      key: 'accept_status_gain',
      count: 7
    });
    expect(refusalOverride({ events: { to_gone: 12 }, refused: 'events_gone' })).toEqual({
      key: 'accept_events_gone',
      count: 12
    });
  });

  it('has none for an empty snapshot or anything else', () => {
    expect(refusalOverride({ refused: 'empty_snapshot' })).toBeNull();
    expect(refusalOverride({})).toBeNull();
    expect(refusalOverride(null)).toBeNull();
  });
});

describe('runs', () => {
  it('colours statuses like the trial e-mails', () => {
    expect(runStatusClass('ok')).toBe('preset-tonal-success');
    expect(runStatusClass('warning')).toBe('preset-tonal-warning');
    expect(runStatusClass('refused')).toBe('preset-tonal-error');
    expect(runStatusClass('failed')).toBe('preset-tonal-error');
    expect(runStatusClass('running')).toBe('preset-tonal-surface');
  });

  it('lists the counts other than zero in a fixed order', () => {
    const result = {
      gone: 0,
      held: 0,
      issues: { open: 3, noted: 3, resolved: 0 },
      updated: 2,
      inserted: 1,
      received: 517,
      unchanged: 514
    };
    expect(runCounts({ kind: 'members', result })).toEqual([
      ['received', 517],
      ['inserted', 1],
      ['updated', 2]
    ]);
    expect(runCounts({ kind: 'config', result: { groups: 1, statuses_changed: 0 } })).toEqual([
      ['groups', 1]
    ]);
    expect(runCounts({ kind: 'events', result: {} })).toEqual([]);
  });

  it('shows the overrides used and the fetch errors', () => {
    expect(acceptedOverrides({ accepted: { gone: 60, status_drop: 7 } })).toEqual([
      'accept_gone=60',
      'accept_status_drop=7'
    ]);
    expect(acceptedOverrides({ accepted: {} })).toEqual([]);
    expect(adapterErrors({ adapter: { errors: 2, counters: {} } })).toBe(2);
    expect(adapterErrors({ adapter: {} })).toBe(0);
  });
});

function issue(values: Partial<IntegrationIssue>): IntegrationIssue {
  return {
    id: 1,
    connection: 'webling',
    kind: 'members',
    code: 'possible_duplicate',
    severity: 'warning',
    external_id: '3240',
    member_id: 3240,
    other_member_id: 10000001,
    event_id: null,
    detail: 'name_birthday',
    first_seen_at: '2026-10-28T09:42:09Z',
    last_seen_at: '2026-10-28T09:42:09Z',
    dismissed_at: null,
    ...values
  };
}

describe('groupIssues', () => {
  const all = { member: () => true, event: () => true };

  it('groups by kind and code, errors first, dismissed apart', () => {
    const issues = [
      issue({ id: 1 }),
      issue({ id: 2, member_id: 3248, last_seen_at: '2026-10-28T10:00:00Z' }),
      issue({ id: 3, dismissed_at: '2026-10-28T11:00:00Z', member_id: 3300 }),
      issue({ id: 4, code: 'invalid_value', severity: 'info', detail: 'birthday' }),
      issue({ id: 5, kind: 'events', code: 'write_failed', severity: 'error', event_id: 61001 }),
      issue({ id: 6, code: 'write_failed', severity: 'error', detail: '23514' })
    ];
    const groups = groupIssues(issues, all);
    expect(groups.map((g) => `${g.kind}:${g.code}`)).toEqual([
      'events:write_failed',
      'members:write_failed',
      'members:possible_duplicate',
      'members:invalid_value'
    ]);
    const duplicates = groups[2];
    expect(duplicates.open.map((i) => i.id)).toEqual([2, 1]);
    expect(duplicates.dismissed.map((i) => i.id)).toEqual([3]);
  });

  it('puts groups with only dismissed issues last', () => {
    const groups = groupIssues(
      [
        issue({
          id: 1,
          code: 'id_conflict',
          severity: 'error',
          dismissed_at: '2026-10-28T11:00:00Z'
        }),
        issue({ id: 2, code: 'invalid_value', severity: 'info' })
      ],
      all
    );
    expect(groups.map((g) => g.code)).toEqual(['invalid_value', 'id_conflict']);
  });

  it('leaves out issues about members or events that no longer exist', () => {
    const issues = [
      issue({ id: 1 }),
      issue({ id: 2, other_member_id: 999 }),
      issue({ id: 3, kind: 'events', code: 'event_gone_kept', event_id: 77, member_id: null }),
      // A held record has no member yet: kept
      issue({ id: 4, member_id: null, other_member_id: 10000001 })
    ];
    const groups = groupIssues(issues, {
      member: (id) => id !== 999,
      event: (id) => id !== 77
    });
    expect(groups.flatMap((g) => g.open.map((i) => i.id)).sort()).toEqual([1, 4]);
  });

  it('collects the ids to load names for', () => {
    expect(
      issueReferences([
        issue({ id: 1 }),
        issue({ id: 2, member_id: null, other_member_id: 10000001 }),
        issue({ id: 3, kind: 'events', member_id: null, other_member_id: null, event_id: 61001 })
      ])
    ).toEqual({ members: [3240, 10000001], events: [61001] });
  });
});

const GROUPS: MemberGroupRow[] = [
  {
    id: 2,
    connection: 'webling',
    external_id: 'g1',
    name: 'Aktiv',
    label: null,
    status: 'active',
    rank: 20,
    hidden: true,
    role: null,
    reviewed: true,
    last_seen_at: null
  },
  {
    id: 17,
    connection: 'webling',
    external_id: 'g940120358',
    name: 'Mitglieder',
    label: null,
    status: null,
    rank: 100,
    hidden: false,
    role: null,
    reviewed: false,
    last_seen_at: null
  }
];

const CALENDARS: CalendarRow[] = [
  {
    id: 6,
    connection: 'webling',
    external_id: null,
    name: 'Ferien und Feiertage',
    target: 'event',
    section: 'General',
    closed_max_days: 3,
    reviewed: true,
    last_seen_at: null
  }
];

function drafts() {
  return {
    groups: Object.fromEntries(GROUPS.map((g) => [g.id, groupDraft(g)])),
    calendars: Object.fromEntries(CALENDARS.map((c) => [c.id, calendarDraft(c)]))
  };
}

describe('mappingChanges', () => {
  it('sends nothing while nothing changed', () => {
    const d = drafts();
    expect(mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars)).toEqual({
      changes: { groups: [], calendars: [] },
      invalid: []
    });
  });

  it('sends only the keys that change', () => {
    const d = drafts();
    d.groups[17] = { ...d.groups[17], status: 'active', rank: '25' };
    d.groups[2] = { ...d.groups[2], status: '', hidden: false };
    d.calendars[6] = { ...d.calendars[6], target: 'break', closedMaxDays: '' };
    const { changes, invalid } = mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars);
    expect(invalid).toEqual([]);
    expect(changes).toEqual({
      groups: [
        { id: 2, status: null, hidden: false },
        { id: 17, status: 'active', rank: 25 }
      ],
      calendars: [{ id: 6, target: 'break', closed_max_days: null }]
    });
  });

  it('sends a new row an admin confirmed as it is, so it is marked reviewed', () => {
    const d = drafts();
    d.groups[17] = { ...d.groups[17], reviewed: true };
    expect(mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars).changes.groups).toEqual([
      { id: 17 }
    ]);
  });

  it('flags input the database would refuse', () => {
    const d = drafts();
    d.groups[2] = { ...d.groups[2], rank: '1000' };
    d.groups[17] = { ...d.groups[17], rank: 'zehn' };
    d.calendars[6] = { ...d.calendars[6], closedMaxDays: '-1' };
    const { changes, invalid } = mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars);
    expect(invalid).toEqual([2, 17, 6]);
    expect(changes).toEqual({ groups: [], calendars: [] });
  });

  it('keys the changes so a preview can tell it still fits', () => {
    const d = drafts();
    const before = changesKey(mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars).changes);
    d.groups[2] = { ...d.groups[2], role: 'trainer' };
    const after = changesKey(mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars).changes);
    expect(after).not.toBe(before);
  });
});

describe('mapping preview', () => {
  // integration_set_mapping() dry run on the populated test database: Aktiv without status
  const refused = {
    run: 7,
    hint: 'accept_status_drop=153',
    guard: {
      limit: 19,
      became: { non_member: 153 },
      gaining: 0,
      counting: 191,
      dropping: 153,
      by_status: { active: 153 },
      over_drop: true,
      over_gain: false
    },
    groups: 1,
    status: 'refused',
    accepted: {},
    calendars: 0,
    statuses_changed: 157
  };

  it('reads the answer', () => {
    expect(parseMappingResult(refused)).toEqual({
      run: 7,
      status: 'refused',
      groups: 1,
      calendars: 0,
      statuses_changed: 157,
      guard: {
        dropping: 153,
        gaining: 0,
        limit: 19,
        over_drop: true,
        over_gain: false,
        became: { non_member: 153 }
      },
      hint: 'accept_status_drop=153'
    });
    expect(parseMappingResult(null).status).toBe('dry_run');
  });

  it('accepts exactly the numbers the preview was over the guard with', () => {
    expect(mappingAccept(parseMappingResult(refused))).toEqual({ accept_status_drop: 153 });
    const both = { ...refused, guard: { ...refused.guard, gaining: 30, over_gain: true } };
    expect(mappingAccept(parseMappingResult(both))).toEqual({
      accept_status_drop: 153,
      accept_status_gain: 30
    });
    const fine = { ...refused, status: 'dry_run', guard: { ...refused.guard, over_drop: false } };
    expect(mappingAccept(parseMappingResult(fine))).toEqual({});
  });
});
