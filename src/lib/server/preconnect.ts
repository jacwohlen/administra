/**
 * `<link>` tags that let the browser open the connection to Supabase while it
 * still loads the app's JavaScript (DNS, TCP and TLS), so the first database
 * request does not pay for it (docs/PERFORMANCE.md). Written into app.html's
 * head by hooks.server.ts, for server-rendered pages and the dashboard's
 * shell alike.
 *
 * `crossorigin`: supabase-js fetches without credentials (CORS, "anonymous"),
 * and the browser only reuses a preconnected connection of the same mode.
 * Nothing for a missing or invalid URL.
 */
export function supabasePreconnectTags(supabaseUrl: string | undefined): string {
  let origin: string;
  try {
    origin = new URL(supabaseUrl ?? '').origin;
  } catch {
    return '';
  }
  if (origin === 'null') return '';
  return (
    `<link rel="preconnect" href="${origin}" crossorigin />` +
    `<link rel="dns-prefetch" href="${origin}" />`
  );
}
