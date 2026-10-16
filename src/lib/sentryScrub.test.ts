import { describe, expect, it } from 'vitest';
import { scrubEvent, scrubText } from './sentryScrub';

describe('scrubText', () => {
  it('removes sensitive query values but keeps the others', () => {
    expect(scrubText('/auth/callback?code=abc123&next=%2Fdashboard')).toBe(
      '/auth/callback?code=[Filtered]&next=%2Fdashboard'
    );
    expect(scrubText('/?email=anna%40example.ch')).toBe('/?email=[Filtered]');
    expect(scrubText('/#access_token=eyJabc&type=magiclink')).toBe(
      '/#access_token=[Filtered]&type=magiclink'
    );
    // Sentry's separate request.query_string field has no leading "?"
    expect(scrubText('email=anna%40example.ch&m=3')).toBe('email=[Filtered]&m=3');
    expect(scrubText('/club?m=12')).toBe('/club?m=12');
    expect(scrubText('barcode=123')).toBe('barcode=123');
  });

  it('removes e-mail addresses', () => {
    expect(scrubText('No member with anna.muster@example.ch')).toBe('No member with [email]');
  });
});

describe('scrubEvent', () => {
  it('scrubs nested strings, arrays and survives cycles', () => {
    const event: Record<string, unknown> = {
      request: {
        url: 'https://x.ch/?email=a%40b.ch',
        headers: { Referer: 'https://x.ch/?code=1' }
      },
      breadcrumbs: [{ message: 'sent to bob@example.ch' }],
      exception: { values: [{ value: 'mail to bob@example.ch failed' }] },
      level: 'error'
    };
    event.self = event;
    scrubEvent(event);
    expect(event).toMatchObject({
      request: {
        url: 'https://x.ch/?email=[Filtered]',
        headers: { Referer: 'https://x.ch/?code=[Filtered]' }
      },
      breadcrumbs: [{ message: 'sent to [email]' }],
      exception: { values: [{ value: 'mail to [email] failed' }] },
      level: 'error'
    });
  });
});
