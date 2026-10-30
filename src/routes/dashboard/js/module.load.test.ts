import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+layout';

// The J+S module is optional: switched off, its pages send back to the dashboard
async function target(jsEnabled: boolean) {
  try {
    await load({ parent: async () => ({ jsEnabled }) } as never);
    return null;
  } catch (e) {
    if (isRedirect(e)) return e.location;
    throw e;
  }
}

describe('J+S module layout', () => {
  it('redirects while the module is off', async () => {
    expect(await target(false)).toBe('/dashboard');
  });

  it('lets staff in while it is on', async () => {
    expect(await target(true)).toBeNull();
  });
});
