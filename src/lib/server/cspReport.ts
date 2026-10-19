import { scrubText } from '$lib/sentryScrub';

/**
 * One log line for a Content Security Policy violation report (the JSON
 * body a browser POSTs to the `report-uri`, see svelte.config.js), or null
 * if the body is not a report.
 *
 * Only the directive, the blocked origin (or "inline"/"eval") and the page
 * path are kept: full URLs may hold tokens (e.g. the trial status page), and
 * the endpoint is public, so nothing else from the body is trusted.
 */
export function summarizeCspReport(body: unknown): string | null {
  const report = (body as { 'csp-report'?: unknown } | null)?.['csp-report'];
  if (!report || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const directive = text(r['effective-directive']) || text(r['violated-directive']);
  if (!directive) return null;
  return [
    'CSP violation:',
    directive.split(' ')[0],
    'blocked',
    blocked(text(r['blocked-uri'])),
    'on',
    path(text(r['document-uri']))
  ].join(' ');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 500) : '';
}

function blocked(uri: string): string {
  if (!uri) return '(none)';
  try {
    const url = new URL(uri);
    return url.origin === 'null' ? `${url.protocol}` : url.origin;
  } catch {
    // "inline", "eval", "data", ...
    return uri.replace(/[^a-z-]/gi, '').slice(0, 20) || '(unknown)';
  }
}

function path(uri: string): string {
  try {
    return scrubText(new URL(uri).pathname);
  } catch {
    return '(unknown)';
  }
}
