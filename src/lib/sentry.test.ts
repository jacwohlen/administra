import { describe, expect, it } from 'vitest';
import { sentryEnvironment, sentryOptions } from './sentry';

describe('sentryEnvironment', () => {
  it('maps Netlify deploy contexts', () => {
    expect(sentryEnvironment('production')).toBe('production');
    expect(sentryEnvironment('branch-deploy')).toBe('dev');
    expect(sentryEnvironment('deploy-preview')).toBe('preview');
    expect(sentryEnvironment('')).toBe('local');
    expect(sentryEnvironment(undefined)).toBe('local');
  });
});

describe('sentryOptions', () => {
  it('collects no personal data: no bodies, AI prompts or stack frame variables', () => {
    const { dataCollection } = sentryOptions('https://key@o0.ingest.de.sentry.io/0', 'production');
    expect(dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false
    });
  });
});
