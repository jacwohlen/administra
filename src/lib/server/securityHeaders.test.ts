import { describe, expect, it } from 'vitest';
import { addSecurityHeaders } from './securityHeaders';

describe('addSecurityHeaders', () => {
  it('sets the headers without overriding existing ones', () => {
    const headers = new Headers({ 'Referrer-Policy': 'no-referrer' });
    addSecurityHeaders(headers);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    // Dictation in the Daten-Assistent, on the app's own pages only
    expect(headers.get('Permissions-Policy')).toContain('microphone=(self)');
    expect(headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
  });
});
