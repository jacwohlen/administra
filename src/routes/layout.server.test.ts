import { describe, expect, it, vi } from 'vitest';
import { load } from './+layout.server';

function supabaseWith(profile: object | null, access: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(access) });
  return {
    rpc,
    from: vi.fn().mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }) })
      })
    })
  };
}

async function run(
  profile: object | null,
  access: { data: unknown; error: unknown } = { data: null, error: null }
) {
  const supabase = supabaseWith(profile, access);
  const safeGetSession = vi.fn().mockResolvedValue({ session: {}, user: { id: 'u1' } });
  const data = (await load({ locals: { safeGetSession, supabase } } as never)) as {
    access: unknown;
  };
  return { data, rpc: supabase.rpc };
}

describe('root layout load', () => {
  it('asks the database whether a member account is let in', async () => {
    const access = { has_access: false, member_statuses: ['left'] };
    const { data, rpc } = await run(
      { status: 'approved', role: 'member' },
      { data: access, error: null }
    );
    expect(rpc).toHaveBeenCalledWith('my_access');
    expect(data.access).toEqual(access);
  });

  it('also for waiting accounts, so the pending page can say why', async () => {
    const { rpc } = await run({ status: 'pending', role: 'member' });
    expect(rpc).toHaveBeenCalledWith('my_access');
  });

  it('does not ask for staff, disabled accounts or without a profile', async () => {
    for (const profile of [
      { status: 'approved', role: 'trainer' },
      { status: 'disabled', role: 'member' },
      null
    ]) {
      const { data, rpc } = await run(profile);
      expect(rpc).not.toHaveBeenCalled();
      expect(data.access).toBeNull();
    }
  });

  it('leaves access unknown when the call fails', async () => {
    const { data } = await run(
      { status: 'approved', role: 'member' },
      { data: null, error: { message: 'function public.my_access() does not exist' } }
    );
    expect(data.access).toBeNull();
  });
});
