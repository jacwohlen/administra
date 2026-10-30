import { describe, it, expect, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

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
// The settings page reads the environment's defaults, which tests do not have
vi.mock('$lib/appSettings', () => ({
  loadAppSettings: async () => {},
  getSettingDefaults: () => ({})
}));
import { load as users } from './users/+page';
import { load as settings } from './settings/+page';
import { load as integrations } from './integrations/+page';
import { load as duplicates } from './members/duplicates/+page';

// Admin pages: user management, settings, integrations, merging duplicates.
// The dashboard layout already let staff in; these send everybody else back.
type Load = (event: never) => unknown;

async function redirectTarget(load: Load, userProfile: object | null) {
  try {
    await load({
      parent: async () => ({ session: {}, userProfile }),
      params: {},
      depends: () => {}
    } as never);
    return null;
  } catch (e) {
    if (isRedirect(e)) return e.location;
    throw e;
  }
}

const viewer = { role: 'viewer', status: 'approved' };
const trainer = { role: 'trainer', status: 'approved', exam_role: 'manager' };
const admin = { role: 'admin', status: 'approved' };

describe('admin-only dashboard pages', () => {
  const cases: [string, Load, string][] = [
    ['users', users as Load, '/dashboard'],
    ['settings', settings as Load, '/dashboard'],
    ['integrations', integrations as Load, '/dashboard'],
    ['duplicates', duplicates as Load, '/dashboard/members']
  ];

  for (const [name, load, target] of cases) {
    it(`${name}: redirects viewers and trainers (also the TK) to ${target}`, async () => {
      expect(await redirectTarget(load, viewer)).toBe(target);
      expect(await redirectTarget(load, trainer)).toBe(target);
      expect(await redirectTarget(load, null)).toBe(target);
    });

    it(`${name}: lets admins in`, async () => {
      expect(await redirectTarget(load, admin)).toBeNull();
    });
  }
});
