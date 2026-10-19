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

  it('removes OAuth provider tokens', () => {
    expect(scrubText('/#access_token=a&provider_token=b&provider_refresh_token=c&x=1')).toBe(
      '/#access_token=[Filtered]&provider_token=[Filtered]&provider_refresh_token=[Filtered]&x=1'
    );
    expect(scrubText('/?refresh_token=r&token_hash=h')).toBe(
      '/?refresh_token=[Filtered]&token_hash=[Filtered]'
    );
  });

  it('removes the trial status token from paths', () => {
    const token = '00000000-0000-4000-8000-000000000001';
    expect(scrubText(`https://admin.example/probetraining/status/${token}`)).toBe(
      'https://admin.example/probetraining/status/[token]'
    );
    expect(scrubText(`/probetraining/status/${token}?lang=en#top`)).toBe(
      '/probetraining/status/[token]?lang=en#top'
    );
    expect(
      scrubText(`Navigated from /probetraining to /probetraining/status/${token} failed`)
    ).toBe('Navigated from /probetraining to /probetraining/status/[token] failed');
    // URL-encoded, e.g. inside another URL's query string
    expect(scrubText(`/?next=%2Fprobetraining%2Fstatus%2F${token}&x=1`)).toBe(
      '/?next=%2Fprobetraining%2Fstatus%2F[token]&x=1'
    );
    // The route ID stays readable, other routes are untouched
    expect(scrubText('GET /probetraining/status/[token]')).toBe(
      'GET /probetraining/status/[token]'
    );
    expect(scrubText('/probetraining')).toBe('/probetraining');
    expect(scrubText('/dashboard/members/42')).toBe('/dashboard/members/42');
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

describe('scrubEvent with a trial status URL', () => {
  it('scrubs request, breadcrumbs, transaction, spans and exception messages', () => {
    const token = '00000000-0000-4000-8000-000000000001';
    const url = `https://admin.example/probetraining/status/${token}`;
    const event = {
      request: { url, headers: { Referer: url } },
      transaction: `/probetraining/status/${token}`,
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/probetraining', to: `/probetraining/status/${token}` }
        },
        { category: 'fetch', data: { url } }
      ],
      spans: [{ description: `GET ${url}`, data: { 'url.full': url } }],
      exception: { values: [{ value: `Failed to load ${url}` }] }
    };
    const json = JSON.stringify(scrubEvent(event));
    expect(json).not.toContain(token);
    expect(event.transaction).toBe('/probetraining/status/[token]');
    expect(event.breadcrumbs[0].data).toEqual({
      from: '/probetraining',
      to: '/probetraining/status/[token]'
    });
  });
});
