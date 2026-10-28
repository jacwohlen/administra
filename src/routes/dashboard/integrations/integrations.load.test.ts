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

  it('says the layer is missing on a database without it', async () => {
    answer({}, { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const result = await load(event(admin));
    expect(result).toMatchObject({ available: false, connections: [], runs: [] });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fails on any other error of integration_status()', async () => {
    answer({}, { data: null, error: { code: '42501', message: 'NOT_ALLOWED' } });
    await expect(load(event(admin))).rejects.toMatchObject({ status: 500 });
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
      available: true,
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
    expect(result).toMatchObject({ available: true, issues: [], members: [], events: [] });
    expect(mockSupabase.from).not.toHaveBeenCalledWith('members');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('events');
  });

  it('fails when the run log cannot be read', async () => {
    answer({ integration_runs: { data: null, error: { message: 'runs failed' } } });
    await expect(load(event(admin))).rejects.toMatchObject({ status: 500, message: 'runs failed' });
  });
});
