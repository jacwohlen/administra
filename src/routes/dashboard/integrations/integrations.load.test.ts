import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProfile } from '$lib/models';

type Result = { data: unknown; error: unknown };

/** Calls made on each table's query, as [table, method, args] */
const calls: [string, string, unknown[]][] = [];

/** A query chain that records its calls and answers with the table's result */
function chain(table: string, result: Result) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return (...args: unknown[]) => {
        calls.push([table, String(prop), args]);
        return new Proxy({}, handler);
      };
    }
  };
  return new Proxy({}, handler);
}

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn(), rpc: vi.fn() }
}));

vi.mock('$lib/supabase', () => ({ supabaseClient: mockSupabase }));

vi.mock('@sveltejs/kit', () => ({
  error: (status: number, body: unknown) => {
    throw Object.assign(new Error(typeof body === 'string' ? body : JSON.stringify(body)), {
      status
    });
  },
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`redirect ${status} ${location}`), { status, location });
  }
}));

import { load } from './+page';

const admin: Partial<UserProfile> = { user_id: 'u1', role: 'admin', status: 'approved' };

function event(profile: Partial<UserProfile> | null) {
  return {
    parent: vi.fn().mockResolvedValue({ session: {}, userProfile: profile }),
    depends: vi.fn()
  } as never;
}

const STATUS = [
  {
    id: 'webling',
    provider: 'webling',
    display_name: 'Webling',
    enabled: true,
    runs_in: 'sync',
    members: { linked: 517, gone: 0, last_seen_at: null },
    events: { linked: 40, gone: 0, last_seen_at: null },
    breaks: 0,
    to_review: { groups: 5, calendars: 0 },
    last_run: { members: null, events: null, config: null },
    last_success: { members: null, events: null },
    issues: { error: 0, warning: 2, info: 1 }
  }
];

const ISSUES = [
  {
    id: 2,
    connection: 'webling',
    kind: 'members',
    code: 'possible_duplicate',
    member_id: 3240,
    other_member_id: 10000001,
    event_id: null
  },
  {
    id: 4,
    connection: 'webling',
    kind: 'events',
    code: 'event_gone_kept',
    member_id: null,
    other_member_id: null,
    event_id: 61001
  }
];

function answer(tables: Record<string, Result>, rpc: Result = { data: STATUS, error: null }) {
  mockSupabase.rpc.mockReturnValue(chain('rpc', rpc));
  mockSupabase.from.mockImplementation((table: string) =>
    chain(table, tables[table] ?? { data: [], error: null })
  );
}

describe('integrations page load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it('sends everybody but approved admins back to the dashboard, before any query', async () => {
    for (const profile of [
      { role: 'trainer', status: 'approved' },
      { role: 'viewer', status: 'approved' },
      { role: 'admin', status: 'pending' },
      null
    ] as Partial<UserProfile>[]) {
      await expect(load(event(profile))).rejects.toMatchObject({
        status: 303,
        location: '/dashboard'
      });
    }
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fails on an error of integration_status(), before any other query', async () => {
    for (const failure of [
      { code: '42501', message: 'NOT_ALLOWED' },
      { code: 'PGRST202', message: 'Could not find the function' }
    ]) {
      answer({}, { data: null, error: failure });
      await expect(load(event(admin))).rejects.toMatchObject({
        status: 500,
        message: failure.message
      });
    }
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('loads status, runs, issues with the names they need, and the mapping', async () => {
    const runs = [{ id: 5, connection: 'webling', kind: 'events', status: 'ok' }];
    const groups = [{ id: 17, connection: 'webling', name: 'Mitglieder' }];
    const calendars = [{ id: 1, connection: 'webling', name: 'Judo Agenda' }];
    answer({
      integration_runs: { data: runs, error: null },
      integration_issues: { data: ISSUES, error: null },
      integration_member_groups: { data: groups, error: null },
      integration_calendars: { data: calendars, error: null },
      members: {
        data: [
          { id: '3240', firstname: 'A', lastname: 'B' },
          { id: 10000001, firstname: 'A', lastname: 'B' }
        ],
        error: null
      },
      events: { data: [{ id: '61001', title: 'Kurs 1', date: '2026-10-31' }], error: null }
    });

    const result = (await load(event(admin))) as {
      connections: { id: string }[];
      members: { id: number }[];
    };

    expect(mockSupabase.rpc).toHaveBeenCalledWith('integration_status');
    expect(result).toMatchObject({
      runs,
      issues: ISSUES,
      groups,
      calendars,
      events: [{ id: 61001, title: 'Kurs 1', date: '2026-10-31' }]
    });
    expect(result.connections[0]).toMatchObject({ id: 'webling', to_review: { groups: 5 } });
    expect(result.members.map((m) => m.id)).toEqual([3240, 10000001]);
    // Only the members and events the issues name; runs newest first, 50 of them,
    // without mapping previews; issues not resolved
    expect(calls).toContainEqual(['members', 'in', ['id', [3240, 10000001]]]);
    expect(calls).toContainEqual(['events', 'in', ['id', [61001]]]);
    expect(calls).toContainEqual(['integration_runs', 'limit', [50]]);
    expect(calls).toContainEqual(['integration_runs', 'or', ['kind.neq.config,dry_run.is.false']]);
    expect(calls).toContainEqual(['integration_issues', 'is', ['resolved_at', null]]);
  });

  it('asks for no names when there are no issues', async () => {
    answer({});
    const result = await load(event(admin));
    expect(result).toMatchObject({ issues: [], members: [], events: [], eventUrls: {} });
    expect(mockSupabase.from).not.toHaveBeenCalledWith('members');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('events');
  });

  it('fails when the calendars cannot be read', async () => {
    answer({ integration_calendars: { data: null, error: { code: '42501', message: 'denied' } } });
    await expect(load(event(admin))).rejects.toMatchObject({ status: 500, message: 'denied' });
  });

  it('fails when the run log cannot be read', async () => {
    answer({ integration_runs: { data: null, error: { message: 'runs failed' } } });
    await expect(load(event(admin))).rejects.toMatchObject({ status: 500, message: 'runs failed' });
  });

  it("reads each connection's link to its events, safe templates only", async () => {
    answer({
      integration_connections: {
        data: [
          {
            id: 'webling',
            settings: {
              hidden_group_pattern: '^\\d\\d_',
              record_urls: { event: 'https://club.webling.ch/portal#/calendar/event/{id}' }
            }
          },
          { id: 'csv', settings: {} },
          { id: 'other', settings: { record_urls: { event: 'javascript:alert({id})' } } }
        ],
        error: null
      }
    });
    const result = await load(event(admin));
    expect(result).toMatchObject({
      eventUrls: { webling: 'https://club.webling.ch/portal#/calendar/event/{id}' }
    });
    expect(Object.keys((result as { eventUrls: object }).eventUrls)).toEqual(['webling']);
    expect(calls).toContainEqual(['integration_connections', 'select', ['id, settings']]);
  });

  it('opens without links when the connections cannot be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer({ integration_connections: { data: null, error: { message: 'denied' } } });
    const result = await load(event(admin));
    expect(result).toMatchObject({ connections: [{ id: 'webling' }], eventUrls: {} });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
