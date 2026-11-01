import { describe, expect, it } from 'vitest';
import { filterQueryValues, scrubEvent, scrubText, scrubTransaction } from './sentryScrub';

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

  it('removes the calendar feed token from paths', () => {
    const token = 'ab'.repeat(32);
    expect(scrubText(`https://admin.example/api/calendar/${token}/alle.ics`)).toBe(
      'https://admin.example/api/calendar/[token]/alle.ics'
    );
    expect(scrubText(`/api/calendar/${token}/mine.ics?x=1#top`)).toBe(
      '/api/calendar/[token]/mine.ics?x=1#top'
    );
    expect(scrubText(`webcal://admin.example/api/calendar/${token}/all.ics`)).toBe(
      'webcal://admin.example/api/calendar/[token]/all.ics'
    );
    expect(scrubText(`Fetching /api/calendar/${token}/meine.ics failed`)).toBe(
      'Fetching /api/calendar/[token]/meine.ics failed'
    );
    // URL-encoded, e.g. inside Google's ?cid= subscribe link
    expect(
      scrubText(`/render?cid=webcal%3A%2F%2Fadmin.example%2Fapi%2Fcalendar%2F${token}%2Falle.ics`)
    ).toBe('/render?cid=webcal%3A%2F%2Fadmin.example%2Fapi%2Fcalendar%2F[token]%2Falle.ics');
    // The route ID stays readable, other routes are untouched
    expect(scrubText('GET /api/calendar/[token]/[feed].ics')).toBe(
      'GET /api/calendar/[token]/[feed].ics'
    );
    expect(scrubText('/api/health')).toBe('/api/health');
    expect(scrubText('/dashboard/training-plan')).toBe('/dashboard/training-plan');
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

describe('scrubEvent with a calendar feed URL', () => {
  it('scrubs request, transaction, breadcrumbs, spans and exception messages', () => {
    const token = '0123456789abcdef'.repeat(4);
    const url = `https://admin.example/api/calendar/${token}/alle.ics`;
    const event = {
      request: { url, headers: { Referer: url } },
      transaction: 'GET /api/calendar/[token]/[feed].ics',
      breadcrumbs: [{ category: 'fetch', data: { url } }],
      spans: [{ description: `GET ${url}`, data: { 'url.full': url } }],
      exception: { values: [{ value: `Failed to load ${url}` }] }
    };
    const json = JSON.stringify(scrubEvent(event));
    expect(json).not.toContain(token);
    expect(event.request.url).toBe('https://admin.example/api/calendar/[token]/alle.ics');
    expect(event.transaction).toBe('GET /api/calendar/[token]/[feed].ics');
  });
});

describe('filterQueryValues', () => {
  it('keeps the column list, order and paging but filters every other value', () => {
    expect(
      filterQueryValues(
        'GET https://x.supabase.co/rest/v1/members?select=id%2Cname&name=ilike.*Muster*&order=name.asc&limit=20'
      )
    ).toBe(
      'GET https://x.supabase.co/rest/v1/members?select=id%2Cname&name=[Filtered]&order=name.asc&limit=20'
    );
    expect(filterQueryValues('/rest/v1/members?id=eq.12')).toBe('/rest/v1/members?id=[Filtered]');
    expect(filterQueryValues('/dashboard/members')).toBe('/dashboard/members');
  });
});

describe('scrubTransaction', () => {
  it('filters request URLs in spans, also a query string without "?"', () => {
    const event = {
      transaction: '/dashboard/members/[id]',
      spans: [
        {
          op: 'http.client',
          description: 'GET https://x.supabase.co/rest/v1/members?select=*&lastname=eq.Muster',
          data: {
            url: 'https://x.supabase.co/rest/v1/members',
            'http.query': 'select=*&email=eq.anna%40example.ch&lastname=eq.Muster'
          }
        }
      ]
    };
    const scrubbed = scrubTransaction(event);
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain('Muster');
    expect(json).not.toContain('anna');
    expect(scrubbed.spans[0].description).toBe(
      'GET https://x.supabase.co/rest/v1/members?select=*&lastname=[Filtered]'
    );
    expect(scrubbed.spans[0].data['http.query']).toBe(
      'select=*&email=[Filtered]&lastname=[Filtered]'
    );
    expect(scrubbed.transaction).toBe('/dashboard/members/[id]');
  });
});
