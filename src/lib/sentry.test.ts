import { describe, expect, it } from 'vitest';
import { browserBeforeSend, isBrowserNetworkNoise, sentryEnvironment } from './sentry';

describe('sentryEnvironment', () => {
  it('maps Netlify deploy contexts', () => {
    expect(sentryEnvironment('production')).toBe('production');
    expect(sentryEnvironment('branch-deploy')).toBe('dev');
    expect(sentryEnvironment('deploy-preview')).toBe('preview');
    expect(sentryEnvironment('')).toBe('local');
    expect(sentryEnvironment(undefined)).toBe('local');
  });
});

describe('browserBeforeSend', () => {
  const report = (...values: string[]) => ({
    exception: { values: values.map((value) => ({ type: 'TypeError', value })) }
  });

  it('drops dropped connections and stale deploy files', () => {
    for (const message of [
      'Failed to fetch',
      'Failed to fetch (admin.jacwohlen.ch)',
      'Load failed',
      'Load failed (admin.jacwohlen.ch)',
      'NetworkError when attempting to fetch resource.',
      'Failed to fetch dynamically imported module: https://admin.jacwohlen.ch/_app/immutable/nodes/11.js',
      'Importing a module script failed.'
    ]) {
      expect(browserBeforeSend(report(message)), message).toBeNull();
      expect(isBrowserNetworkNoise(message), message).toBe(true);
    }
  });

  it('keeps real errors and scrubs them', () => {
    const event = report("Cannot read properties of undefined (reading 'title')");
    expect(browserBeforeSend(event)).toBe(event);
    const withMail = report('Failed for anna@example.ch');
    expect(JSON.stringify(browserBeforeSend(withMail))).not.toContain('anna@example.ch');
  });

  it('keeps messages without an exception', () => {
    const event = { message: 'Upload failed' };
    expect(browserBeforeSend(event)).toBe(event);
  });
});
