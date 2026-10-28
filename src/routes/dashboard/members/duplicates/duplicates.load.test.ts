import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProfile } from '$lib/models';

function createChainFromResult(result: { data: unknown; error: unknown }) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      if (typeof prop === 'string') {
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      }
      return undefined;
    }
  };
  return new Proxy({}, handler);
}

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn(),
    rpc: vi.fn()
  }
}));

vi.mock('$lib/supabase', () => ({
  supabaseClient: mockSupabase
}));

vi.mock('@sveltejs/kit', () => ({
  error: (status: number, body: unknown) => {
    const e = new Error(typeof body === 'string' ? body : JSON.stringify(body));
    (e as unknown as Record<string, unknown>).status = status;
    throw e;
  },
  redirect: (status: number, location: string) => {
    const e = new Error(`redirect ${status} ${location}`);
    (e as unknown as Record<string, unknown>).status = status;
    (e as unknown as Record<string, unknown>).location = location;
    throw e;
  }
}));

import { load } from './+page';

const admin: Partial<UserProfile> = { user_id: 'u1', role: 'admin', status: 'approved' };
const trainer: Partial<UserProfile> = { user_id: 'u2', role: 'trainer', status: 'approved' };

function event(profile: Partial<UserProfile> | null) {
  return {
    parent: vi.fn().mockResolvedValue({ session: {}, userProfile: profile }),
    depends: vi.fn()
  } as never;
}

describe('duplicates load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends trainers and viewers back to the member list', async () => {
    await expect(load(event(trainer))).rejects.toMatchObject({
      status: 303,
      location: '/dashboard/members'
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('sends a pending admin back too', async () => {
    await expect(load(event({ ...admin, status: 'pending' }))).rejects.toMatchObject({
      status: 303
    });
  });

  it('lists a trial registration and the Webling member of the same name', async () => {
    const members = [
      {
        id: 4321,
        firstname: 'Mira',
        lastname: 'Dupont',
        labels: ['Aktiv'],
        membership_status: 'active'
      },
      {
        id: 10000005,
        firstname: 'Mira',
        lastname: 'Dupont',
        labels: ['probetraining'],
        membership_status: 'trial'
      },
      { id: 7, firstname: 'Leo', lastname: 'Other', labels: [], membership_status: 'active' }
    ];
    mockSupabase.from.mockImplementation((table: string) =>
      createChainFromResult({
        data: table === 'members' ? members : [{ member_id: 4321, gone_at: null }],
        error: null
      })
    );

    const result = (await load(event(admin))) as {
      pairs: { keep: { id: number }; drop: { id: number }; reasons: string[] }[];
    };

    expect(result.pairs.map((p) => [p.keep.id, p.drop.id, p.reasons])).toEqual([
      [4321, 10000005, ['trial_name']]
    ]);
    expect(mockSupabase.from).toHaveBeenCalledWith('members');
    expect(mockSupabase.from).toHaveBeenCalledWith('member_links');
  });

  it('fails the page when members cannot be read', async () => {
    mockSupabase.from.mockReturnValue(
      createChainFromResult({ data: null, error: { message: 'permission denied' } })
    );
    await expect(load(event(admin))).rejects.toMatchObject({ status: 500 });
  });
});
