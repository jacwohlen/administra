import { normalizeName } from '$lib/assistant/nameMatch';
import type { MembershipStatus } from './models';

/**
 * Likely duplicate members for the admins' list (/dashboard/members/duplicates)
 * and the order in which a pair is merged. Runs in the browser on the members
 * staff can read; merge_members() in the database decides, these only suggest
 * (20261028110000_merge_duplicate_members.sql, docs/INTEGRATIONS.md).
 */

export interface DuplicateCandidate {
  id: number;
  firstname: string;
  lastname: string;
  birthday?: string | null;
  email?: string | null;
  labels?: string[] | null;
  membership_status?: MembershipStatus | null;
  archivedAt?: string | null;
  trialRegisteredAt?: string | null;
}

/** member_links state of a member: 'active' while Webling has it, 'gone' after, null without a link */
export type LinkState = 'active' | 'gone' | null;

export type DuplicateReason = 'name_birthday' | 'email_name' | 'trial_name';

export interface DuplicatePair<M extends DuplicateCandidate = DuplicateCandidate> {
  /** The row that stays (suggestKeep) */
  keep: M;
  drop: M;
  reasons: DuplicateReason[];
  /** Both in Webling: merge them there; the database refuses (BOTH_IN_PROVIDER) */
  blocked: boolean;
}

/** Webling ids: app ids are below 1'000 or from 10'000'001 on (fence_member_event_ids) */
export const WEBLING_ID_MIN = 1000;
export const WEBLING_ID_MAX = 10_000_000;

/** member_links rows to a state per member, as provider_link_state() in SQL */
export function linkStates(
  links: { member_id: number; gone_at: string | null }[]
): Map<number, LinkState> {
  const states = new Map<number, LinkState>();
  for (const link of links) {
    if (link.gone_at == null) states.set(link.member_id, 'active');
    else if (!states.has(link.member_id)) states.set(link.member_id, 'gone');
  }
  return states;
}

/**
 * In Webling: an active link, or no link yet and a Webling id. The same rule
 * as merge_members_apply() and trigger_set_membership_status().
 */
export function inProvider(id: number, link: LinkState | undefined): boolean {
  if (link === 'active') return true;
  if (link === 'gone') return false;
  return id >= WEBLING_ID_MIN && id < WEBLING_ID_MAX;
}

/** Came from the trial form: the trial label (either spelling) or a registration date */
export function isTrialOrigin(member: DuplicateCandidate): boolean {
  return (
    (member.labels ?? []).some((label) => label.toLowerCase() === 'probetraining') ||
    member.trialRegisteredAt != null
  );
}

function normalizedEmail(email: string | null | undefined): string | null {
  const value = (email ?? '').trim().toLowerCase();
  return value === '' ? null : value;
}

/**
 * First and last name as one key, word order ignored ("Keller Kim" = "Kim
 * Keller", as names come in swapped on forms), umlauts and case folded.
 * Null below two words: a first name alone matches far too many people.
 */
export function nameKey(member: Pick<DuplicateCandidate, 'firstname' | 'lastname'>): string | null {
  const words = normalizeName(`${member.firstname ?? ''} ${member.lastname ?? ''}`)
    .split(/[\s-]+/)
    .filter(Boolean)
    .sort();
  return words.length >= 2 ? words.join(' ') : null;
}

/**
 * Why merging these two would be refused, from the keep / drop order alone:
 * the row Webling has must stay, and two Webling rows are merged in Webling.
 */
export function mergeOrderProblem(
  keepInProvider: boolean,
  dropInProvider: boolean
): 'BOTH_IN_PROVIDER' | 'KEEP_PROVIDER_ROW' | null {
  if (keepInProvider && dropInProvider) return 'BOTH_IN_PROVIDER';
  if (dropInProvider) return 'KEEP_PROVIDER_ROW';
  return null;
}

/**
 * Which of two rows stays: the one in Webling (required), then one that is
 * not a trial registration, then one not archived, then active or passive,
 * then the older (lower) id. Returns [keep, drop].
 */
export function suggestKeep<M extends DuplicateCandidate>(
  a: M,
  b: M,
  links: Map<number, LinkState>
): [M, M] {
  const rank = (m: M): number[] => [
    inProvider(m.id, links.get(m.id)) ? 0 : 1,
    isTrialOrigin(m) ? 1 : 0,
    m.archivedAt ? 1 : 0,
    m.membership_status === 'active' || m.membership_status === 'passive' ? 0 : 1,
    m.id
  ];
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] < rb[i] ? [a, b] : [b, a];
  }
  return [a, b];
}

/**
 * Pairs that are probably one person:
 * - name_birthday: same name (nameKey) and birthday
 * - email_name: same e-mail and the same first name. Siblings share a
 *   parent's address, twins also a birthday, and without a "not a
 *   duplicate" list a false pair would stay here for good.
 * - trial_name: a trial registration and a row that is none with the same
 *   name (also an app row converted from an earlier trial)
 * A group of three rows gives each pair; blocked pairs (both in Webling) last.
 */
export function findDuplicatePairs<M extends DuplicateCandidate>(
  members: M[],
  links: Map<number, LinkState>
): DuplicatePair<M>[] {
  const pairs = new Map<string, { a: M; b: M; reasons: Set<DuplicateReason> }>();
  const add = (a: M, b: M, reason: DuplicateReason) => {
    if (a.id === b.id) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}-${y.id}`;
    const pair = pairs.get(key) ?? { a: x, b: y, reasons: new Set<DuplicateReason>() };
    pair.reasons.add(reason);
    pairs.set(key, pair);
  };
  const groups = (key: (m: M) => string | null): M[][] => {
    const map = new Map<string, M[]>();
    for (const m of members) {
      const k = key(m);
      if (k == null) continue;
      const list = map.get(k);
      if (list) list.push(m);
      else map.set(k, [m]);
    }
    return [...map.values()].filter((list) => list.length > 1);
  };
  const eachPair = (list: M[], fn: (a: M, b: M) => void) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) fn(list[i], list[j]);
    }
  };

  for (const list of groups(nameKey)) {
    eachPair(list, (a, b) => {
      const birthday = a.birthday?.trim();
      if (birthday && birthday === b.birthday?.trim()) add(a, b, 'name_birthday');
      if (isTrialOrigin(a) !== isTrialOrigin(b)) add(a, b, 'trial_name');
    });
  }
  for (const list of groups((m) => normalizedEmail(m.email))) {
    eachPair(list, (a, b) => {
      const first = normalizeName(a.firstname ?? '');
      if (first && first === normalizeName(b.firstname ?? '')) add(a, b, 'email_name');
    });
  }

  const result: DuplicatePair<M>[] = [...pairs.values()].map(({ a, b, reasons }) => {
    const [keep, drop] = suggestKeep(a, b, links);
    return {
      keep,
      drop,
      reasons: [...reasons].sort(),
      blocked:
        mergeOrderProblem(
          inProvider(keep.id, links.get(keep.id)),
          inProvider(drop.id, links.get(drop.id))
        ) !== null
    };
  });
  return result.sort(
    (x, y) =>
      Number(x.blocked) - Number(y.blocked) ||
      x.keep.lastname.localeCompare(y.keep.lastname, 'de') ||
      x.keep.firstname.localeCompare(y.keep.firstname, 'de') ||
      x.keep.id - y.keep.id
  );
}
