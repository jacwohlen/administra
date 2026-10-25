import type { MembershipStatus } from './models';

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

/**
 * Labels that only repeat the membership status (shown as its own chip) or
 * are Webling bookkeeping ("01_Anmeldung", "02_Rechnung verschickt", "Test"):
 * hidden in chips. The status mapping itself lives in SQL,
 * member_status_from_labels() in 20261025230000_membership_status_and_member_links.sql.
 */
const STATUS_LABELS = new Set([
  'aktiv',
  'passiv',
  'ehrenmitglieder',
  'nicht-mitglieder',
  'probetraining',
  'new',
  'test'
]);
const BOOKKEEPING_LABEL = /^\d\d_/;

/** The labels worth showing as chips: roles and groups like 'Erwachsenentrainer' or 'J&S' */
export function visibleLabels(labels: string[] | null | undefined): string[] {
  return (labels ?? []).filter(
    (label) => !STATUS_LABELS.has(label.toLowerCase()) && !BOOKKEEPING_LABEL.test(label)
  );
}

/** 'active' is the normal case and gets no chip; every other status does */
export function statusChip(status: MembershipStatus | null | undefined): MembershipStatus | null {
  return status && status !== 'active' ? status : null;
}

/** Display name of a member_links.connection */
export function providerName(connection: string): string {
  return connection === 'webling' ? 'Webling' : connection;
}

/** The database refused a change to a field the provider owns (trigger_guard_provider_fields) */
export function isManagedByProviderError(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? '';
  return message.includes('MANAGED_BY_PROVIDER');
}
