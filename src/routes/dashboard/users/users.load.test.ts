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
    from: vi.fn()
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

const adminProfile: Partial<UserProfile> = { user_id: 'u1', role: 'admin', status: 'approved' };
const trainerProfile: Partial<UserProfile> = { user_id: 'u2', role: 'trainer', status: 'approved' };

function parentWith(profile: Partial<UserProfile> | null) {
  return vi.fn().mockResolvedValue({ session: {}, userProfile: profile });
}

describe('users admin load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects non-admins to the dashboard', async () => {
    await expect(load({ parent: parentWith(trainerProfile) } as never)).rejects.toMatchObject({
      status: 303,
      location: '/dashboard'
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('redirects when no profile is present', async () => {
    await expect(load({ parent: parentWith(null) } as never)).rejects.toMatchObject({
      status: 303,
      location: '/dashboard'
    });
  });

  it('returns profiles and members for admins', async () => {
    const profiles: Partial<UserProfile>[] = [
      { user_id: 'u1', email: 'a@example.com', status: 'approved', role: 'admin' },
      { user_id: 'u3', email: 'b@example.com', status: 'pending', role: 'viewer' }
    ];
    const members = [{ id: 1, firstname: 'Alice', lastname: 'Smith' }];

    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: profiles, error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: members, error: null }));

    const result = await load({ parent: parentWith(adminProfile) } as never);

    expect(result).toEqual({ profiles, members });
    expect(mockSupabase.from).toHaveBeenCalledWith('user_profiles');
    expect(mockSupabase.from).toHaveBeenCalledWith('members');
  });

  it('throws when loading profiles fails', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: null, error: { message: 'boom' } }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    await expect(load({ parent: parentWith(adminProfile) } as never)).rejects.toThrow('boom');
  });

  it('returns empty arrays when nothing exists', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    const result = await load({ parent: parentWith(adminProfile) } as never);
    expect(result).toEqual({ profiles: [], members: [] });
  });
});
