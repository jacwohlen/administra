import { describe, expect, it } from 'vitest';
import { GET } from './+server';

const manifestFor = async (host: string) => {
  const res = await (GET as (e: { url: URL }) => Response)({ url: new URL(`https://${host}/`) });
  return { res, body: await res.json() };
};

describe('GET /manifest.webmanifest', () => {
  it('names the app for the host', async () => {
    expect((await manifestFor('alleda.ch')).body.name).toBe('Alleda');
    const { res, body } = await manifestFor('app.azumus.ch');
    expect(body.name).toBe('Azumus');
    expect(body.short_name).toBe('Azumus');
    expect(res.headers.get('content-type')).toBe('application/manifest+json');
    expect(body.icons).toHaveLength(3);
  });
});
