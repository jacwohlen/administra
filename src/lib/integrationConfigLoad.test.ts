import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { from: vi.fn() } }));
vi.mock('./supabase', () => ({ supabaseClient: mockSupabase }));

import { applyIntegrationConfig, integrationConfig } from './integrationConfig';
import { invalidateIntegrationConfig, loadIntegrationConfig } from './integrationConfigLoad';

type Result = { data: unknown; error: unknown };

/** from(table).select() answers with the result for that table */
function answer(results: Record<string, Result>) {
  mockSupabase.from.mockImplementation((table: string) => ({
    select: () => Promise.resolve(results[table] ?? { data: [], error: null })
  }));
}

const webling = { id: 'webling', display_name: 'Webling', settings: {} };

beforeEach(() => {
  vi.clearAllMocks();
  invalidateIntegrationConfig();
  applyIntegrationConfig(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadIntegrationConfig', () => {
  it('reads connections and groups once per session', async () => {
    answer({
      integration_connections: { data: [webling], error: null },
      integration_member_groups: { data: [{ name: 'Vorstand', hidden: true }], error: null }
    });
    await Promise.all([loadIntegrationConfig(), loadIntegrationConfig()]);
    await loadIntegrationConfig();
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    expect(integrationConfig.loaded).toBe(true);
    expect(integrationConfig.groupHidden.get('Vorstand')).toBe(true);
  });

  it('reads again after invalidateIntegrationConfig', async () => {
    answer({ integration_connections: { data: [webling], error: null } });
    await loadIntegrationConfig();
    invalidateIntegrationConfig();
    await loadIntegrationConfig();
    expect(mockSupabase.from).toHaveBeenCalledTimes(4);
  });

  it('keeps the built-in rules after an error and tries again next time', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer({ integration_member_groups: { data: null, error: { message: 'Failed to fetch' } } });
    await loadIntegrationConfig();
    expect(integrationConfig.loaded).toBe(false);
    expect(log).toHaveBeenCalledOnce();
    answer({ integration_connections: { data: [webling], error: null } });
    await loadIntegrationConfig();
    expect(integrationConfig.loaded).toBe(true);
  });

  it('keeps the built-in rules when no connection can be read', async () => {
    answer({
      integration_connections: { data: [], error: null },
      integration_member_groups: { data: [], error: null }
    });
    await loadIntegrationConfig();
    expect(integrationConfig.loaded).toBe(false);
  });

  it('never throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase.from.mockImplementation(() => {
      throw new Error('offline');
    });
    await expect(loadIntegrationConfig()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
  });
});
