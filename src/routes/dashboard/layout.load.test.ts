import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { data: unknown; error: unknown; count?: number };

function chain(result: Result) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
      return () => new Proxy({}, handler);
    }
  };
  return new Proxy({}, handler);
}

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn(), rpc: vi.fn() }
}));
vi.mock('$lib/supabase', () => ({ supabaseClient: mockSupabase }));

import { load } from './+layout';
import { integrationConfig } from '$lib/integrationConfig';
import { invalidateIntegrationConfig } from '$lib/integrationConfigLoad';

const admin = { role: 'admin', status: 'approved' };
const trainer = { role: 'trainer', status: 'approved' };

async function layout(userProfile: object) {
  return (await load({
    parent: async () => ({ session: {}, userProfile, access: null }),
    depends: () => {}
  } as never)) as { integrationAlert: boolean; pendingUsers: number };
}

const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

function status(members: object | null, issues = { error: 0, warning: 0, info: 0 }) {
  return {
    data: [
      {
        id: 'webling',
        display_name: 'Webling',
        enabled: true,
        last_run: { members, events: null },
        last_success: { members: hourAgo, events: null },
        issues
      }
    ],
    error: null
  };
}

function answer(rpc: Result) {
  mockSupabase.rpc.mockReturnValue(chain(rpc));
  mockSupabase.from.mockImplementation((table: string) =>
    chain(
      table === 'user_profiles'
        ? { data: null, error: null, count: 2 }
        : table === 'integration_connections'
          ? { data: [{ id: 'webling', display_name: 'Webling', settings: {} }], error: null }
          : { data: [{ name: 'Vorstand', hidden: true }], error: null }
    )
  );
}

const ok = { id: 4, status: 'ok', started_at: hourAgo, finished_at: hourAgo };

describe('dashboard layout: integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateIntegrationConfig();
  });

  it('loads the integration configuration for staff before a page renders', async () => {
    answer(status(ok));
    await layout(trainer);
    expect(mockSupabase.from).toHaveBeenCalledWith('integration_member_groups');
    expect(integrationConfig.loaded).toBe(true);
    expect(integrationConfig.groupHidden.get('Vorstand')).toBe(true);
  });

  it('asks trainers nothing about runs and shows them no dot', async () => {
    answer(status({ ...ok, status: 'refused', refused: 'members_gone' }));
    expect((await layout(trainer)).integrationAlert).toBe(false);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('shows admins a dot for a refused run or open errors, none when all is well', async () => {
    answer(status(ok));
    expect(await layout(admin)).toMatchObject({ integrationAlert: false, pendingUsers: 2 });
    answer(status({ ...ok, status: 'refused', refused: 'members_gone' }));
    expect((await layout(admin)).integrationAlert).toBe(true);
    answer(status(ok, { error: 1, warning: 0, info: 0 }));
    expect((await layout(admin)).integrationAlert).toBe(true);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('integration_status');
  });

  it('shows no dot before the layer ever ran, nor on a database without it', async () => {
    answer(status(null));
    expect((await layout(admin)).integrationAlert).toBe(false);
    answer({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    expect((await layout(admin)).integrationAlert).toBe(false);
  });
});
