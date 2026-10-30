import { supabaseClient } from './supabase';
import { applyIntegrationConfig, parseIntegrationConfig } from './integrationConfig';

/**
 * Loads the integration configuration (`./integrationConfig`) once per app
 * session, for staff: the dashboard layout awaits it before a page renders,
 * and loaders that need it before the layout is done (the training plan's
 * trainers) await it too; both share one request.
 *
 * A failure is logged and not cached, so the next navigation tries again;
 * until then the built-in rules apply, they are what the seeded catalog
 * says. Never throws: the configuration can never take a page down.
 */

let loaded = false;
let pending: Promise<void> | null = null;

export function loadIntegrationConfig(): Promise<void> {
  if (loaded) return Promise.resolve();
  pending ??= fetchIntegrationConfig().finally(() => {
    pending = null;
  });
  return pending;
}

async function fetchIntegrationConfig(): Promise<void> {
  try {
    const [connections, groups] = await Promise.all([
      supabaseClient.from('integration_connections').select('id, display_name, enabled, settings'),
      supabaseClient.from('integration_member_groups').select('name, label, hidden, role')
    ]);
    const failure = connections.error ?? groups.error;
    if (failure) {
      console.error('Error loading the integration configuration:', failure);
      return;
    }
    const rows = Array.isArray(connections.data) ? connections.data : [];
    // No connection to read (none configured, or RLS shows none): the
    // built-in rules, rather than hiding nothing
    applyIntegrationConfig(
      rows.length > 0
        ? parseIntegrationConfig(rows, Array.isArray(groups.data) ? groups.data : [])
        : null
    );
    loaded = true;
  } catch (e) {
    console.error('Error loading the integration configuration:', e);
  }
}

/** After a mapping change: the next load reads the configuration again */
export function invalidateIntegrationConfig(): void {
  loaded = false;
}
