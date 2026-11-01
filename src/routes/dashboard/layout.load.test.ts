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
import { load as serverLoad } from './+layout.server';
import { integrationConfig } from '$lib/integrationConfig';
import { invalidateIntegrationConfig } from '$lib/integrationConfigLoad';

const admin = { role: 'admin', status: 'approved' };
const trainer = { role: 'trainer', status: 'approved' };

/** The server load (admin badges, see +layout.server.ts), then the universal one */
async function layout(userProfile: object) {
  const parent = async () => ({ session: {}, userProfile, access: null });
  const data = await serverLoad({
    parent,
    depends: () => {},
    locals: { supabase: mockSupabase }
  } as never);
  return (await load({ data, parent } as never)) as {
    integrationAlert: boolean;
    pendingUsers: number;
  };
}

const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

function status(
  members: object | null,
  issues = { error: 0, warning: 0, info: 0 },
  to_review = { groups: 0, calendars: 0 }
) {
  return {
    data: [
      {
        id: 'webling',
        display_name: 'Webling',
        enabled: true,
        last_run: { members, events: null },
        last_success: { members: hourAgo, events: null },
        issues,
        to_review
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

  it('leaves the admin badges to the server: the universal load asks no more', async () => {
    answer(status(ok));
    await load({
      data: { pendingUsers: 3, integrationAlert: true },
      parent: async () => ({ session: {}, userProfile: admin, access: null })
    } as never);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalledWith('user_profiles');
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

  it('shows admins a dot while a new group or calendar waits for review', async () => {
    answer(status(ok, undefined, { groups: 1, calendars: 0 }));
    expect((await layout(admin)).integrationAlert).toBe(true);
    answer(status(ok, undefined, { groups: 0, calendars: 2 }));
    expect((await layout(admin)).integrationAlert).toBe(true);
  });

  it('shows no dot before the layer ever ran, nor when the status cannot be read', async () => {
    answer(status(null));
    expect((await layout(admin)).integrationAlert).toBe(false);
    answer({ data: null, error: { code: '42501', message: 'NOT_ALLOWED' } });
    expect((await layout(admin)).integrationAlert).toBe(false);
  });
});

describe('dashboard layout: J+S module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateIntegrationConfig();
  });

  function withJs(enabled: boolean) {
    mockSupabase.rpc.mockReturnValue(chain(status(ok)));
    mockSupabase.from.mockImplementation((table: string) =>
      chain(
        table === 'user_profiles'
          ? { data: null, error: null, count: 0 }
          : table === 'integration_connections'
            ? {
                data: [
                  { id: 'webling', display_name: 'Webling', enabled: true, settings: {} },
                  { id: 'js', display_name: 'J+S (NDS)', enabled, settings: {} }
                ],
                error: null
              }
            : { data: [], error: null }
      )
    );
  }

  async function jsEnabled(userProfile: object) {
    return ((await layout(userProfile)) as unknown as { jsEnabled: boolean }).jsEnabled;
  }

  it('offers the switched-on module to trainers and admins', async () => {
    withJs(true);
    expect(await jsEnabled(trainer)).toBe(true);
    invalidateIntegrationConfig();
    expect(await jsEnabled(admin)).toBe(true);
  });

  it('never to viewers', async () => {
    withJs(true);
    expect(await jsEnabled({ role: 'viewer', status: 'approved' })).toBe(false);
  });

  it('to nobody while it is switched off', async () => {
    withJs(false);
    expect(await jsEnabled(trainer)).toBe(false);
  });
});
