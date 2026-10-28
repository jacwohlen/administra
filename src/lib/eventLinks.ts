import type { EventLink } from './models';

/**
 * A table or column the database does not have (PostgREST's schema cache,
 * or Postgres itself). event_links comes with the integration layer
 * migration, and Netlify may deploy the app before a promotion applies it.
 */
const MISSING_SCHEMA_CODES = new Set(['PGRST204', 'PGRST205', '42P01', '42703']);

export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MISSING_SCHEMA_CODES.has(code);
}

/**
 * The event's live provider link from an event_links query, or null: not
 * linked, or a database without the integration layer. Any other error is
 * treated as not linked too, so the event page still opens; the database
 * keeps refusing changes to a provider's event either way.
 */
export function eventLinkFromResult(result: { data: unknown; error: unknown }): EventLink | null {
  if (result.error) {
    if (!isMissingSchemaError(result.error)) {
      console.error('Error loading the event link:', result.error);
    }
    return null;
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as
    { connection?: unknown; url?: unknown } | null | undefined;
  if (!row || typeof row.connection !== 'string' || row.connection === '') {
    return null;
  }
  return {
    connection: row.connection,
    // Only ever rendered as a link: nothing but https
    url: typeof row.url === 'string' && row.url.startsWith('https://') ? row.url : null
  };
}

/** Edit and delete: writers, for events no provider maintains */
export function canChangeEvent(canWrite: boolean, link: EventLink | null | undefined): boolean {
  return canWrite && !link;
}
