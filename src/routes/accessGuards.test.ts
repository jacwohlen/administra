import { describe, it, expect, vi } from 'vitest';

// Every query comes back empty; the guards only look at parent()
vi.mock('$lib/supabase', () => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
      }
      return () => new Proxy({}, handler);
    }
  };
  return { supabaseClient: new Proxy({}, handler) };
});
vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`redirect ${status} ${location}`), { status, location });
  }
}));

import { load as clubLayout } from './club/+layout';
import { load as pendingPage } from './pending/+page';
import { load as dashboardLayout } from './dashboard/+layout';

type Load = (event: never) => unknown;

async function target(load: unknown, userProfile: object | null, access: object | null) {
  const event = {
    parent: async () => ({ session: {}, userProfile, access }),
    depends: () => {}
  } as never;
  try {
    await (load as Load)(event);
    return 'stays';
  } catch (e) {
    return (e as { location?: string }).location ?? String(e);
  }
}

const member = { status: 'approved', role: 'member' };

describe('access guards', () => {
  it('lets a member whose membership counts into the club area only', async () => {
    const access = { has_access: true, member_statuses: ['active'] };
    expect(await target(clubLayout, member, access)).toBe('stays');
    expect(await target(pendingPage, member, access)).toBe('/club');
    expect(await target(dashboardLayout, member, access)).toBe('/club');
  });

  it('sends an approved member without membership to the pending page, which keeps it', async () => {
    const access = { has_access: false, member_statuses: ['left'] };
    expect(await target(clubLayout, member, access)).toBe('/pending');
    expect(await target(dashboardLayout, member, access)).toBe('/pending');
    expect(await target(pendingPage, member, access)).toBe('stays');
  });

  it('routes by the status when access is unknown', async () => {
    expect(await target(clubLayout, member, null)).toBe('stays');
    expect(await target(pendingPage, member, null)).toBe('/club');
  });

  it('keeps staff on the dashboard whatever their member records say', async () => {
    const trainer = { status: 'approved', role: 'trainer' };
    expect(await target(dashboardLayout, trainer, null)).toBe('stays');
    expect(await target(clubLayout, trainer, null)).toBe('stays');
    expect(await target(pendingPage, trainer, null)).toBe('/dashboard');
  });
});
