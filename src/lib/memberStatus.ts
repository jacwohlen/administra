import type { MembershipStatus } from './models';
import { integrationConfig, type IntegrationConfig } from './integrationConfig';

/**
 * Members who belong to the club right now: shown in the member list by
 * default and offered as trainers. Non-members and people who left stay in
 * the database (attendance history) but are hidden unless asked for.
 */
export function isCurrentMember(status: MembershipStatus | null | undefined): boolean {
  return status !== 'non_member' && status !== 'left';
}

/** Members who may lead a training: active or passive, not trial candidates */
export function canBeTrainer(status: MembershipStatus | null | undefined): boolean {
  return status === 'active' || status === 'passive' || status == null;
}

/** The app's own labels: the trial candidate ('probetraining') and 'new'. Never chips. */
const APP_LABELS = new Set(['probetraining', 'new']);

/**
 * Built-in rule, used while the integration configuration is not loaded:
 * labels that only repeat the membership status (shown as its own chip) and
 * Webling bookkeeping ("01_Anmeldung", "03_Austritt", "Test"), as the
 * seeded catalog (integration_member_groups.hidden) has them. Exact
 * spelling, so a label staff typed (always lowercase) stays visible.
 */
const STATUS_LABELS = new Set([
  'Aktiv',
  'Passiv',
  'Ehrenmitglieder',
  'Nicht-Mitglieder',
  'Probetraining',
  'Test'
]);
const BOOKKEEPING_LABEL = /^\d\d_[A-Z]/;

/**
 * The labels worth showing as chips: roles and groups like
 * 'Erwachsenentrainer' or 'J&S'. A provider group's label is hidden when
 * its catalog row says so; a label the catalog does not know yet when it
 * matches the connection's hidden_group_pattern.
 */
export function visibleLabels(
  labels: string[] | null | undefined,
  config: IntegrationConfig = integrationConfig
): string[] {
  return (labels ?? []).filter((label) => {
    if (APP_LABELS.has(label)) return false;
    if (!config.loaded) return !STATUS_LABELS.has(label) && !BOOKKEEPING_LABEL.test(label);
    const hidden = config.groupHidden.get(label);
    if (hidden !== undefined) return !hidden;
    return !config.hiddenPatterns.some((p) => p.test(label));
  });
}

/**
 * Whether a member's labels mark a trainer: a group with role 'trainer' in
 * the catalog (Webling's "Erwachsenentrainer"), case ignored. A label the
 * catalog does not know (typed by staff, or a group the layer has not seen
 * yet) keeps the built-in rule.
 */
export function hasTrainerLabel(
  labels: string[] | null | undefined,
  config: IntegrationConfig = integrationConfig
): boolean {
  return (labels ?? []).some((label) =>
    config.loaded && config.groupHidden.has(label)
      ? config.trainerLabels.has(label.toLowerCase())
      : label.toLowerCase().includes('erwachsenentrainer')
  );
}

/** 'active' is the normal case and gets no chip; every other status does */
export function statusChip(status: MembershipStatus | null | undefined): MembershipStatus | null {
  return status && status !== 'active' ? status : null;
}

/** Display name of a connection (member_links, event_links): its display_name */
export function providerName(
  connection: string,
  config: IntegrationConfig = integrationConfig
): string {
  return config.displayNames.get(connection) ?? (connection === 'webling' ? 'Webling' : connection);
}

/** The database refused a change to a field the provider owns (trigger_guard_provider_fields) */
export function isManagedByProviderError(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? '';
  return message.includes('MANAGED_BY_PROVIDER');
}
