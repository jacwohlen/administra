import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyHeaders, supabaseApi } from './api.js';

afterEach(() => vi.unstubAllGlobals());

/**
 * fetch answering by path: `keys` for the key list, `legacy` for
 * /api-keys/legacy (a status number answers with that status)
 */
function answer({ keys = [], legacy = { enabled: true }, other = {} } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url, init });
      const body = url.endsWith('/api-keys/legacy')
        ? legacy
        : url.includes('/api-keys?reveal=true')
          ? keys
          : other;
      return typeof body === 'number'
        ? new Response('{}', { status: body })
        : new Response(JSON.stringify(body), { status: 200 });
    })
  );
  return calls;
}

const LEGACY = [
  { name: 'anon', type: 'legacy', api_key: 'eyJ.anon' },
  { name: 'service_role', type: 'legacy', api_key: 'eyJ.service' }
];

describe('apiKeys', () => {
  it('takes the new keys before the legacy ones (retired at the end of 2026)', async () => {
    answer({
      keys: [
        ...LEGACY,
        { name: 'default', type: 'publishable', api_key: 'sb_publishable_x' },
        { name: 'default', type: 'secret', api_key: 'sb_secret_x' }
      ]
    });
    expect(await supabaseApi('token').apiKeys('ref')).toEqual({
      anonKey: 'sb_publishable_x',
      serviceKey: 'sb_secret_x'
    });
  });

  it('falls back to the legacy keys while they are on', async () => {
    for (const legacy of [{ enabled: true }, 404, 403]) {
      answer({ keys: LEGACY, legacy });
      expect(await supabaseApi('token').apiKeys('ref')).toEqual({
        anonKey: 'eyJ.anon',
        serviceKey: 'eyJ.service'
      });
    }
  });

  it('never falls back to legacy keys that are switched off', async () => {
    answer({
      keys: [...LEGACY, { name: 'default', type: 'publishable', api_key: 'sb_publishable_x' }],
      legacy: { enabled: false }
    });
    await expect(supabaseApi('token').apiKeys('ref')).rejects.toThrow('ref: API keys not found');
  });
});

describe('keyHeaders', () => {
  it('sends a new key as apikey only, a legacy JWT also as bearer', () => {
    expect(keyHeaders('sb_secret_x')).toEqual({ apikey: 'sb_secret_x' });
    expect(keyHeaders('eyJ.service')).toEqual({
      apikey: 'eyJ.service',
      Authorization: 'Bearer eyJ.service'
    });
  });

  it('is what ensureBucket sends', async () => {
    const calls = answer({ other: { name: 'photos' } });
    await supabaseApi('token').ensureBucket('ref', 'sb_secret_x', { id: 'photos' });
    expect(calls[0].url).toBe('https://ref.supabase.co/storage/v1/bucket');
    expect(calls[0].init.headers).toEqual({
      apikey: 'sb_secret_x',
      'Content-Type': 'application/json'
    });
  });
});
