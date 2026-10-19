import { describe, expect, it } from 'vitest';
import { addSecurityHeaders, clubSiteOrigins, frameAncestors } from './securityHeaders';

describe('clubSiteOrigins', () => {
  it('returns the origin with and without www', () => {
    expect(clubSiteOrigins('https://jacwohlen.ch')).toEqual([
      'https://jacwohlen.ch',
      'https://www.jacwohlen.ch'
    ]);
    expect(clubSiteOrigins('https://www.jacwohlen.ch/kontakt')).toEqual([
      'https://jacwohlen.ch',
      'https://www.jacwohlen.ch'
    ]);
  });

  it('ignores invalid and non-https URLs', () => {
    expect(clubSiteOrigins('')).toEqual([]);
    expect(clubSiteOrigins(undefined)).toEqual([]);
    expect(clubSiteOrigins('not a url')).toEqual([]);
    expect(clubSiteOrigins('http://jacwohlen.ch')).toEqual([]);
    expect(clubSiteOrigins('javascript:alert(1)')).toEqual([]);
  });
});

describe('frameAncestors', () => {
  const club = 'https://jacwohlen.ch';

  it('lets only the app and the Webling portal frame internal pages', () => {
    for (const path of ['/', '/dashboard', '/club', '/probetraining-admin', '/api/health']) {
      expect(frameAncestors(path, club)).toBe("frame-ancestors 'self'");
    }
  });

  it('lets the club website embed the trial form and status page', () => {
    const expected = "frame-ancestors 'self' https://jacwohlen.ch https://www.jacwohlen.ch";
    expect(frameAncestors('/probetraining', club)).toBe(expected);
    expect(frameAncestors('/probetraining/status/abc', club)).toBe(expected);
  });
});

describe('addSecurityHeaders', () => {
  it('sets the headers without overriding existing ones', () => {
    const headers = new Headers({ 'Referrer-Policy': 'no-referrer' });
    addSecurityHeaders(headers, '/', 'https://jacwohlen.ch');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
  });
});
