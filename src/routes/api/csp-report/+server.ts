import type { RequestHandler } from '@sveltejs/kit';
import { summarizeCspReport } from '$lib/server/cspReport';

/**
 * Receives Content Security Policy violation reports from browsers (the
 * policy is Report-Only for now, see docs/SECURITY_HEADERS.md) and writes
 * one line per report to the Netlify function log.
 */
export const POST: RequestHandler = async ({ request }) => {
  const raw = await request.text();
  if (raw.length <= 20_000) {
    try {
      const line = summarizeCspReport(JSON.parse(raw));
      if (line) console.warn(line);
    } catch {
      // Not JSON: ignore
    }
  }
  return new Response(null, { status: 204 });
};
