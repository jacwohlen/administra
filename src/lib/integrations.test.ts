import { describe, it, expect, vi } from 'vitest';
import {
  STALE_HOURS,
  acceptedOverrides,
  adapterErrors,
  calendarDraft,
  canDismissAll,
  changesKey,
  connectionAlerts,
  dismissIssues,
  dropLine,
  eventUrlTemplate,
  groupDraft,
  groupIssues,
  isStale,
  issueEventUrl,
  issueReferences,
  issueShown,
  mappingAccept,
  mappingChanges,
  needsAttention,
  parseConnectionStatuses,
  parseMappingResult,
  rebaseDraft,
  refusalOverride,
  runCounts,
  runStatusClass,
  sameDraft,
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
    // The first layer run after phase 4 (run history keeps it): holidays replaced the
    // events the sync wrote before the layer
    expect(
      runCounts({
        kind: 'events',
        result: {
          received: 60,
          holiday_events_kept: 1,
          breaks_inserted: 9,
          holiday_events_deleted: 8,
          adopted: 51
        }
      })
    ).toEqual([
      ['received', 60],
      ['adopted', 51],
      ['breaks_inserted', 9],
      ['holiday_events_deleted', 8],
      ['holiday_events_kept', 1]
    ]);
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

  // Ids 999 (member) and 77 (event) do not exist: merged, deleted, or never written
  const loaded = { member: (id: number) => id !== 999, event: (id: number) => id !== 77 };
  const failedInsert = {
    code: 'write_failed',
    severity: 'error' as const,
    external_id: '4711',
    other_member_id: null,
    detail: '23514'
  };

  it('shows an error about a record that was never written, by its record number', () => {
    // The insert of a new provider record failed: the counted error must be visible
    const fresh = issue({ id: 1, ...failedInsert, member_id: null });
    // An older row named the id the insert would have used
    const older = issue({ id: 2, ...failedInsert, member_id: 999 });
    const event = issue({
      id: 3,
      kind: 'events',
      ...failedInsert,
      external_id: '77',
      member_id: null,
      event_id: 77
    });
    for (const i of [fresh, older, event]) expect(issueShown(i, loaded)).toBe(true);
    const groups = groupIssues([fresh, older, event], loaded);
    expect(groups.map((g) => `${g.kind}:${g.code}:${g.open.length}`)).toEqual([
      'events:write_failed:1',
      'members:write_failed:2'
    ]);
  });

  it('shows other issues about members or events no longer there by their record number', () => {
    const conflict = issue({ id: 1, code: 'id_conflict', severity: 'error', member_id: 999 });
    const kept = issue({
      id: 2,
      kind: 'events',
      code: 'event_gone_kept',
      external_id: '61001',
      member_id: null,
      other_member_id: null,
      event_id: 77
    });
    expect(issueShown(conflict, loaded)).toBe(true);
    expect(issueShown(kept, loaded)).toBe(true);
  });

  it("shows a holiday's issue, which names no event, by its record number", () => {
    // Webling's "Ferien und Feiertage" fill training_plan_breaks (phase 4)
    const holiday = issue({
      id: 4,
      kind: 'events',
      code: 'invalid_value',
      severity: 'info',
      external_id: '94002',
      member_id: null,
      other_member_id: null,
      event_id: null,
      detail: 'all_day'
    });
    expect(issueShown(holiday, loaded)).toBe(true);
    expect(groupIssues([holiday], loaded).map((g) => g.open.length)).toEqual([1]);
  });

  it('leaves out only what has nothing else to show it by', () => {
    const issues = [
      issue({ id: 1 }),
      // The pair of a possible duplicate is gone (merged): no duplicate any more
      issue({ id: 2, other_member_id: 999 }),
      issue({ id: 3, member_id: 999 }),
      // A held record has no member yet: kept
      issue({ id: 4, member_id: null, other_member_id: 10000001 }),
      // No record number to fall back on
      issue({ id: 5, ...failedInsert, external_id: '', member_id: 999 }),
      // Never named a member: kept as before
      issue({ id: 6, ...failedInsert, external_id: '', member_id: null })
    ];
    const groups = groupIssues(issues, loaded);
    expect(groups.flatMap((g) => g.open.map((i) => i.id)).sort()).toEqual([1, 4, 6]);
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

describe('dismiss all', () => {
  const open = (n: number) =>
    Array.from({ length: n }, (_, i) => issue({ id: i + 1, code: 'unknown_participant' }));

  it('is offered for two open issues or more, never for possible duplicates', () => {
    expect(canDismissAll({ code: 'unknown_participant', open: open(2) })).toBe(true);
    expect(canDismissAll({ code: 'unknown_participant', open: open(1) })).toBe(false);
    expect(canDismissAll({ code: 'possible_duplicate', open: open(5) })).toBe(false);
  });

  it('dismisses one after the other', async () => {
    const order: string[] = [];
    const dismiss = vi.fn(async (id: number) => {
      order.push(`start ${id}`);
      await Promise.resolve();
      order.push(`end ${id}`);
      return { error: null };
    });
    expect(await dismissIssues([4, 7, 9], dismiss)).toEqual({ dismissed: 3, error: null });
    expect(order).toEqual(['start 4', 'end 4', 'start 7', 'end 7', 'start 9', 'end 9']);
  });

  it('stops at the first error and says how many went through', async () => {
    const failure = { code: '42501', message: 'NOT_ALLOWED' };
    const dismiss = vi.fn(async (id: number) => ({ error: id === 7 ? failure : null }));
    expect(await dismissIssues([4, 7, 9], dismiss)).toEqual({ dismissed: 1, error: failure });
    expect(dismiss.mock.calls.map(([id]) => id)).toEqual([4, 7]);
    const thrown = new Error('offline');
    expect(
      await dismissIssues([4, 7], async () => {
        throw thrown;
      })
    ).toEqual({ dismissed: 0, error: thrown });
  });
});

describe('links to the provider', () => {
  const template = 'https://club.webling.ch/portal#/calendar/event/{id}';
  const settings = { hidden_group_pattern: '^\\d\\d_', record_urls: { event: template } };
  const event = issue({
    id: 5,
    kind: 'events',
    code: 'write_failed',
    severity: 'error',
    external_id: '61001',
    member_id: null,
    other_member_id: null,
    event_id: 61001
  });

  it("reads the connection's event template", () => {
    expect(eventUrlTemplate(settings)).toBe(template);
    expect(eventUrlTemplate({})).toBeNull();
    expect(eventUrlTemplate(null)).toBeNull();
    expect(eventUrlTemplate({ record_urls: 'x' })).toBeNull();
    expect(eventUrlTemplate({ record_urls: { member: template } })).toBeNull();
  });

  it('takes only https with {id} once, after the host', () => {
    for (const unsafe of [
      'http://club.webling.ch/portal#/calendar/event/{id}',
      'javascript:alert({id})',
      ' https://club.webling.ch/{id}',
      'https://club.webling.ch/portal',
      'https://club.webling.ch/{id}/{id}',
      'https://{id}/event',
      'https://{id}.webling.ch/',
      'https://club.webling.ch{id}',
      42
    ]) {
      expect(eventUrlTemplate({ record_urls: { event: unsafe } })).toBeNull();
      expect(issueEventUrl(event, unsafe as string)).toBeNull();
    }
    expect(eventUrlTemplate({ record_urls: { event: 'https://x.example/?event={id}' } })).toBe(
      'https://x.example/?event={id}'
    );
  });

  it("links an issue about an event to the provider's page", () => {
    expect(issueEventUrl(event, template)).toBe(
      'https://club.webling.ch/portal#/calendar/event/61001'
    );
    // a holiday is an event at the provider too
    expect(issueEventUrl({ ...event, code: 'invalid_value', external_id: '94002' }, template)).toBe(
      'https://club.webling.ch/portal#/calendar/event/94002'
    );
    expect(issueEventUrl({ ...event, external_id: 'ab:c.d-e_f' }, template)).toBe(
      'https://club.webling.ch/portal#/calendar/event/ab%3Ac.d-e_f'
    );
  });

  it('links nothing else', () => {
    // a member issue, and a participant: its number is the member's, not the event's
    expect(issueEventUrl(issue({ external_id: '3240' }), template)).toBeNull();
    expect(issueEventUrl({ ...event, code: 'unknown_participant' }, template)).toBeNull();
    for (const id of ['', '61001/../x', '61 001', '<b>', '$&', 'x'.repeat(201)]) {
      expect(issueEventUrl({ ...event, external_id: id }, template)).toBeNull();
    }
    expect(issueEventUrl(event, null)).toBeNull();
    expect(issueEventUrl(event, undefined)).toBeNull();
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
    last_seen_at: null,
    gone_at: null
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
    const key = () =>
      changesKey(
        mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars).changes,
        GROUPS,
        CALENDARS
      );
    const before = key();
    d.groups[2] = { ...d.groups[2], role: 'trainer' };
    expect(key()).not.toBe(before);
  });

  it('keys the rows under the changes, so another admin’s save outdates a preview', () => {
    const d = drafts();
    d.groups[17] = { ...d.groups[17], status: 'passive' };
    const { changes } = mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars);
    const before = changesKey(changes, GROUPS, CALENDARS);
    // The same changes now apply to a row another admin moved
    const moved = GROUPS.map((g) => (g.id === 17 ? { ...g, status: 'left' as const } : g));
    expect(changesKey(changes, moved, CALENDARS)).not.toBe(before);
    // Any group's mapping changes the numbers, not only the changed one's
    const ranked = GROUPS.map((g) => (g.id === 2 ? { ...g, rank: 25 } : g));
    expect(changesKey(changes, ranked, CALENDARS)).not.toBe(before);
    // A run only seeing the rows again changes nothing
    const seen = GROUPS.map((g) => ({ ...g, last_seen_at: '2026-10-28T09:42:09Z' }));
    expect(changesKey(changes, seen, CALENDARS)).toBe(before);
    // Calendars count only where they change
    const other = CALENDARS.map((c) => ({ ...c, section: 'Judo' }));
    expect(changesKey(changes, GROUPS, other)).toBe(before);
    d.calendars[6] = { ...d.calendars[6], target: 'break' };
    const withCalendar = mappingChanges(GROUPS, d.groups, CALENDARS, d.calendars).changes;
    expect(changesKey(withCalendar, GROUPS, other)).not.toBe(
      changesKey(withCalendar, GROUPS, CALENDARS)
    );
  });
});

describe('rebaseDraft (rows loaded again)', () => {
  const passiv: MemberGroupRow = {
    ...GROUPS[0],
    id: 5,
    name: 'Passiv',
    status: 'passive',
    rank: 30
  };
  // Another admin saved rank 25 and moved the group to left
  const saved: MemberGroupRow = { ...passiv, status: 'left', rank: 25 };

  it('takes the new values of a row the admin did not touch', () => {
    const base = groupDraft(passiv);
    const rebased = rebaseDraft(groupDraft(passiv), base, groupDraft(saved));
    expect(rebased).toEqual(groupDraft(saved));
    // So it is no change of ours, and nothing reverts the other admin's save
    expect(mappingChanges([saved], { 5: rebased }, [], {}).changes.groups).toEqual([]);
  });

  it('keeps what the admin changed and refreshes the rest', () => {
    const base = groupDraft(passiv);
    const touched = { ...groupDraft(passiv), hidden: false, role: 'trainer' as const };
    const rebased = rebaseDraft(touched, base, groupDraft(saved));
    expect(rebased).toEqual({ ...groupDraft(saved), hidden: false, role: 'trainer' });
    expect(mappingChanges([saved], { 5: rebased }, [], {}).changes.groups).toEqual([
      { id: 5, hidden: false, role: 'trainer' }
    ]);
  });

  it('starts a new row, or one without base, from the row', () => {
    expect(rebaseDraft(undefined, undefined, groupDraft(saved))).toEqual(groupDraft(saved));
    const c = calendarDraft(CALENDARS[0]);
    expect(rebaseDraft({ ...c, section: 'Judo' }, undefined, c)).toEqual(c);
  });

  it('works for calendars and compares drafts by value', () => {
    const base = calendarDraft(CALENDARS[0]);
    const now = calendarDraft({ ...CALENDARS[0], closed_max_days: 5 });
    const touched = { ...base, section: 'Judo' };
    expect(rebaseDraft(touched, base, now)).toEqual({ ...now, section: 'Judo' });
    expect(sameDraft(base, calendarDraft(CALENDARS[0]))).toBe(true);
    expect(sameDraft(base, now)).toBe(false);
    expect(sameDraft(groupDraft(passiv), groupDraft(saved))).toBe(false);
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
        by_status: { active: 153 },
        became: { non_member: 153 }
      },
      hint: 'accept_status_drop=153'
    });
    expect(parseMappingResult(null).status).toBe('dry_run');
    expect(parseMappingResult(null).guard.by_status).toEqual({});
  });

  it('says the total and the limit when over the limit for all, or within both rules', () => {
    expect(dropLine(parseMappingResult(refused).guard)).toEqual({
      key: 'dropping',
      count: 153,
      limit: 19
    });
    const within = { ...refused.guard, dropping: 3, by_status: { passive: 3 }, over_drop: false };
    expect(dropLine(parseMappingResult({ guard: within }).guard)).toEqual({
      key: 'dropping',
      count: 3,
      limit: 19
    });
    const none = { ...refused.guard, dropping: 0, by_status: {}, over_drop: false };
    expect(dropLine(parseMappingResult({ guard: none }).guard)).toBeNull();
  });

  it('names the status when more than half of it drops while the total is within the limit', () => {
    // As on prod: 269 active and 30 passive counting, Passiv without status
    const passive = {
      limit: 29,
      counting: 299,
      dropping: 20,
      gaining: 0,
      by_status: { passive: 20 },
      became: { non_member: 20 },
      over_drop: true,
      over_gain: false
    };
    expect(dropLine(parseMappingResult({ guard: passive }).guard)).toEqual({
      key: 'droppingStatus',
      count: 20,
      status: 'passive'
    });
    // With several statuses the answer does not tell which is over half: each one's count
    const both = { ...passive, dropping: 26, by_status: { active: 6, passive: 20 } };
    expect(dropLine(parseMappingResult({ guard: both }).guard)).toEqual({
      key: 'droppingStatuses',
      count: 26,
      statuses: [
        ['passive', 20],
        ['active', 6]
      ]
    });
    // An answer without by_status: the total is all there is to say
    const bare = { ...passive, by_status: undefined };
    expect(dropLine(parseMappingResult({ guard: bare }).guard)?.key).toBe('dropping');
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
