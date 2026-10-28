"""Provider-neutral core of the sync (integrations phase 3).

The adapter (e.g. webling_adapter) only fetches and translates; the
database's integration layer (supabase/migrations/20261029120000_integration_layer.sql,
docs/INTEGRATIONS.md) resolves identity, maps, guards and writes:
integration_begin -> integration_stage -> integration_apply ->
integration_finish. Nothing in this package knows a provider's names.
"""
