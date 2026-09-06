import type { Badge, BadgeProgress } from '$lib/models';

const CATEGORY_ORDER = ['season', 'attendance', 'streak', 'trainer', 'event'];

export interface BadgeCategoryGroup {
  category: string;
  badges: Badge[];
  next?: BadgeProgress;
}

/** A badge earned in several seasons is several rows; key by all three parts. */
export function badgeKey(b: Pick<Badge, 'badgeId' | 'season' | 'context'>): string {
  return `${b.badgeId}:${b.season ?? 0}:${b.context ?? ''}`;
}

/** "Judo 2026" for a per-section season badge, "2026" for a season badge, "" for lifetime. */
export function badgeSuffix(b: Pick<Badge, 'season' | 'context'>): string {
  if (!b.season) return '';
  return b.context ? `${b.context} ${b.season}` : `${b.season}`;
}

export function getTopBadges(badges: Badge[], count = 2): Badge[] {
  return badges.slice(0, count);
}

export function groupBadgesByCategory(badges: Badge[]): { category: string; badges: Badge[] }[] {
  const map = new Map<string, Badge[]>();
  for (const badge of badges) {
    const list = map.get(badge.category) ?? [];
    list.push(badge);
    map.set(badge.category, list);
  }
  return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
    category: c,
    badges: map.get(c)!
  }));
}

/**
 * Lifetime badges read as a progression, lowest to highest.
 * Season badges read as a record, newest year first and most prestigious first within a year.
 */
function compareBadges(a: Badge, b: Badge): number {
  const sa = a.season ?? 0;
  const sb = b.season ?? 0;
  if (sa !== sb) return sb - sa;
  return sa === 0 ? a.sortOrder - b.sortOrder : b.sortOrder - a.sortOrder;
}

/**
 * Merge earned badges and next-badge progress into one list per category.
 * A category appears if it has either earned badges or a next badge to work toward.
 */
export function groupBadgesWithProgress(
  badges: Badge[],
  progress: BadgeProgress[]
): BadgeCategoryGroup[] {
  const earned = new Map<string, Badge[]>();
  for (const badge of badges) {
    const list = earned.get(badge.category) ?? [];
    list.push(badge);
    earned.set(badge.category, list);
  }
  const next = new Map(progress.map((p) => [p.category, p]));

  return CATEGORY_ORDER.filter((c) => earned.has(c) || next.has(c)).map((c) => ({
    category: c,
    badges: [...(earned.get(c) ?? [])].sort(compareBadges),
    next: next.get(c)
  }));
}

export function progressPercent(p: BadgeProgress): number {
  if (p.next_threshold <= 0) return 0;
  return Math.min(Math.round((p.current_count / p.next_threshold) * 100), 100);
}
