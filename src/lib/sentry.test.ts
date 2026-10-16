import { describe, expect, it } from 'vitest';
import { sentryEnvironment } from './sentry';

describe('sentryEnvironment', () => {
  it('maps Netlify deploy contexts', () => {
    expect(sentryEnvironment('production')).toBe('production');
    expect(sentryEnvironment('branch-deploy')).toBe('dev');
    expect(sentryEnvironment('deploy-preview')).toBe('preview');
    expect(sentryEnvironment('')).toBe('local');
    expect(sentryEnvironment(undefined)).toBe('local');
  });
});
