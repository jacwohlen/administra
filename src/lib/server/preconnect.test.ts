import { describe, expect, it } from 'vitest';
import { supabasePreconnectTags } from './preconnect';

describe('supabasePreconnectTags', () => {
  it('preconnects to the Supabase origin, as a CORS connection', () => {
    expect(supabasePreconnectTags('https://abc.supabase.co')).toBe(
      '<link rel="preconnect" href="https://abc.supabase.co" crossorigin />' +
        '<link rel="dns-prefetch" href="https://abc.supabase.co" />'
    );
    // Only the origin, never a path
    expect(supabasePreconnectTags('http://127.0.0.1:54321/rest/v1')).toContain(
      'href="http://127.0.0.1:54321"'
    );
  });

  it('writes nothing for a missing or invalid URL', () => {
    expect(supabasePreconnectTags(undefined)).toBe('');
    expect(supabasePreconnectTags('')).toBe('');
    expect(supabasePreconnectTags('not a url')).toBe('');
  });
});
