import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyHeaders, supabaseApi } from './api.js';

afterEach(() => vi.unstubAllGlobals());

/** fetch answering every call with `body`, recording the calls */
function answer(body) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
  return calls;
}

describe('apiKeys', () => {
  it('takes the new keys before the legacy ones (retired at the end of 2026)', async () => {
    answer([
      { name: 'anon', type: 'legacy', api_key: 'eyJ.anon' },
      { name: 'service_role', type: 'legacy', api_key: 'eyJ.service' },
      { name: 'default', type: 'publishable', api_key: 'sb_publishable_x' },
      { name: 'default', type: 'secret', api_key: 'sb_secret_x' }
    ]);
    expect(await supabaseApi('token').apiKeys('ref')).toEqual({
      anonKey: 'sb_publishable_x',
      serviceKey: 'sb_secret_x'
    });
  });

  it('falls back to the legacy keys, and skips disabled ones', async () => {
    answer([
      { name: 'anon', type: 'legacy', api_key: 'eyJ.anon' },
      { name: 'service_role', type: 'legacy', api_key: 'eyJ.service' },
      { name: 'old', type: 'secret', api_key: 'sb_secret_old', disabled: true }
    ]);
    expect(await supabaseApi('token').apiKeys('ref')).toEqual({
      anonKey: 'eyJ.anon',
      serviceKey: 'eyJ.service'
    });
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
    const calls = answer({ name: 'photos' });
    await supabaseApi('token').ensureBucket('ref', 'sb_secret_x', { id: 'photos' });
    expect(calls[0].url).toBe('https://ref.supabase.co/storage/v1/bucket');
    expect(calls[0].init.headers).toEqual({
      apikey: 'sb_secret_x',
      'Content-Type': 'application/json'
    });
  });
});
