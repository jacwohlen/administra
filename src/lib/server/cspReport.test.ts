import { describe, expect, it } from 'vitest';
import { summarizeCspReport } from './cspReport';

const token = '00000000-0000-4000-8000-000000000001';

describe('summarizeCspReport', () => {
  it('keeps directive, blocked origin and page path only', () => {
    expect(
      summarizeCspReport({
        'csp-report': {
          'document-uri': `https://admin.example/probetraining/status/${token}?x=1`,
          'effective-directive': 'connect-src',
          'violated-directive': 'connect-src',
          'blocked-uri': 'https://evil.example/collect?email=a@b.ch',
          'original-policy': "default-src 'self'"
        }
      })
    ).toBe(
      'CSP violation: connect-src blocked https://evil.example on /probetraining/status/[token]'
    );
  });

  it('handles inline violations and the older violated-directive field', () => {
    expect(
      summarizeCspReport({
        'csp-report': {
          'document-uri': 'https://admin.example/dashboard',
          'violated-directive': "script-src 'self'",
          'blocked-uri': 'inline'
        }
      })
    ).toBe('CSP violation: script-src blocked inline on /dashboard');
  });

  it('ignores anything that is not a report', () => {
    expect(summarizeCspReport(null)).toBeNull();
    expect(summarizeCspReport({})).toBeNull();
    expect(summarizeCspReport({ 'csp-report': 'x' })).toBeNull();
    expect(summarizeCspReport({ 'csp-report': { 'blocked-uri': 'inline' } })).toBeNull();
  });
});
