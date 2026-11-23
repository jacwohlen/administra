import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/env', () => ({ browser: false }));
vi.mock('#lib/i18n/index.ts', () => ({}));
vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  return { locale: readable('de'), waitLocale: vi.fn(async () => {}) };
});
vi.mock('#lib/appSettings.ts', () => ({ loadAppSettings: vi.fn(async () => {}) }));

import { load } from './+layout.ts';

type LoadEvent = Parameters<typeof load>[0];

describe('root layout load', () => {
  it('passes the server data on', async () => {
    const data = { session: { user: { id: 'u1' } }, userProfile: { user_id: 'u1' }, access: null };
    const result = await load({ data } as unknown as LoadEvent);
    expect(result).toEqual(data);
  });

  it('returns a signed-out result when the server data is missing (root error page)', async () => {
    const result = await load({ data: null } as unknown as LoadEvent);
    expect(result).toEqual({ session: null, userProfile: null, access: null });
  });
});
