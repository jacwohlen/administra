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

/**
 * Delete: writers, for events no provider maintains (the database refuses
 * it: the next run would bring the event back without its attendance).
 * Writers edit every event; a linked one only in the fields its provider
 * leaves to the app (lockedEventFields).
 */
export function canDeleteEvent(canWrite: boolean, link: EventLink | null | undefined): boolean {
  return canWrite && !link;
}

/**
 * Event fields a provider may own or fill (integration_field_policy_ok() in
 * the integration layer migration; all_day from phase 4). The registration
 * deadline is never one of them: it always stays the app's.
 */
export const PROVIDER_EVENT_FIELDS = [
  'title',
  'description',
  'date',
  'date_to',
  'all_day',
  'timeFrom',
  'timeTo',
  'location',
  'section',
  'maxParticipants'
] as const;

export type ProviderEventField = (typeof PROVIDER_EVENT_FIELDS)[number];

/** All day and the times: the database derives one from the other (events_all_day). */
const ALL_DAY_AND_TIMES: readonly ProviderEventField[] = ['all_day', 'timeFrom', 'timeTo'];

/**
 * The fields of an event the app cannot change while its provider has it:
 * those the connection's field_policy marks 'owned' or 'fill' (what
 * trigger_guard_provider_event() refuses). All day and the times are locked
 * together: times written to an all-day event make it timed, all day drops
 * the times. Without a readable policy, every field a provider may write,
 * so the edit page never offers a change the database would refuse.
 */
export function lockedEventFields(
  link: EventLink | null | undefined,
  fieldPolicy: unknown
): ProviderEventField[] {
  if (!link) {
    return [];
  }
  if (!fieldPolicy || typeof fieldPolicy !== 'object' || Array.isArray(fieldPolicy)) {
    return [...PROVIDER_EVENT_FIELDS];
  }
  const policy = fieldPolicy as Record<string, unknown>;
  const owned = (field: ProviderEventField) =>
    ['owned', 'fill'].includes(policy[`event.${field}`] as string);
  const timesLocked = ALL_DAY_AND_TIMES.some(owned);
  return PROVIDER_EVENT_FIELDS.filter(
    (field) => owned(field) || (timesLocked && ALL_DAY_AND_TIMES.includes(field))
  );
}
