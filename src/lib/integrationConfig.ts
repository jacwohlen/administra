/**
 * What the app reads from the integration layer's configuration
 * (docs/INTEGRATIONS.md, phase 2): which provider groups are no chips,
 * which groups mark trainers, and the providers' display names. Staff read
 * integration_connections and integration_member_groups (RLS). The
 * dashboard layout loads them once per app session
 * (`./integrationConfigLoad`) and fills this object in place, so helpers
 * like visibleLabels() read it without being handed it.
 *
 * `loaded` stays false for member accounts (no read access) and after a
 * failed load: the helpers then keep the built-in rules, which are what the
 * seeded catalog says.
 *
 * Pure (no Supabase import), so memberStatus.ts and its tests can use it.
 */

export interface IntegrationConfig {
  /** false: not read from the database, the built-in rules apply */
  loaded: boolean;
  /** integration_connections.display_name per connection id ('webling' → 'Webling') */
  displayNames: Map<string, string>;
  /**
   * The connections' hidden_group_pattern: hides labels of provider groups
   * the catalog does not have (such as stale labels of members gone from
   * the provider)
   */
  hiddenPatterns: RegExp[];
  /** Label as written to members (label, else the group's name) → hidden, for every catalog group */
  groupHidden: Map<string, boolean>;
  /** Labels of groups with role 'trainer', lower case */
  trainerLabels: Set<string>;
}

export function emptyIntegrationConfig(): IntegrationConfig {
  return {
    loaded: false,
    displayNames: new Map(),
    hiddenPatterns: [],
    groupHidden: new Map(),
    trainerLabels: new Set()
  };
}

/** The configuration of this app session; filled in place by applyIntegrationConfig() */
export const integrationConfig: IntegrationConfig = emptyIntegrationConfig();

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * The pattern is a Postgres regular expression; the simple ones the layer
 * uses ('^\d\d_[A-Z]') mean the same in JavaScript. One JavaScript cannot
 * read is left out rather than guessed.
 */
function pattern(source: unknown): RegExp | null {
  const s = text(source);
  if (!s) return null;
  try {
    return new RegExp(s);
  } catch {
    return null;
  }
}

/**
 * The configuration from the rows of integration_connections (id,
 * display_name, settings) and integration_member_groups (name, label,
 * hidden, role). A label two groups share is hidden when either hides it.
 */
export function parseIntegrationConfig(
  connections: readonly unknown[],
  groups: readonly unknown[]
): IntegrationConfig {
  const config = emptyIntegrationConfig();
  config.loaded = true;
  for (const raw of connections) {
    const c = (raw ?? {}) as { id?: unknown; display_name?: unknown; settings?: unknown };
    const id = text(c.id);
    if (!id) continue;
    const name = text(c.display_name);
    if (name) config.displayNames.set(id, name.trim());
    const settings = (c.settings ?? {}) as { hidden_group_pattern?: unknown };
    const hidden = pattern(settings.hidden_group_pattern);
    if (hidden) config.hiddenPatterns.push(hidden);
  }
  for (const raw of groups) {
    const g = (raw ?? {}) as { name?: unknown; label?: unknown; hidden?: unknown; role?: unknown };
    const label = text(g.label) ?? text(g.name);
    if (!label) continue;
    config.groupHidden.set(label, (config.groupHidden.get(label) ?? false) || g.hidden === true);
    if (g.role === 'trainer') config.trainerLabels.add(label.toLowerCase());
  }
  return config;
}

/** Make `next` the session's configuration; null goes back to the built-in rules */
export function applyIntegrationConfig(next: IntegrationConfig | null): void {
  Object.assign(integrationConfig, next ?? emptyIntegrationConfig());
}
