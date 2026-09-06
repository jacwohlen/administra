import type { Badge, BadgeProgress } from '$lib/models';

const CATEGORY_ORDER = ['top_performer', 'attendance', 'streak', 'trainer', 'event'];

export interface BadgeCategoryGroup {
  category: string;
  badges: Badge[];
  next?: BadgeProgress;
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
 * Merge earned badges and next-badge progress into one list per category.
 * Earned badges are ordered lowest to highest so the row reads as a progression,
 * and a category appears if it has either earned badges or a next badge to work toward.
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
    badges: [...(earned.get(c) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    next: next.get(c)
  }));
}

export function progressPercent(p: BadgeProgress): number {
  if (p.next_threshold <= 0) return 0;
  return Math.min(Math.round((p.current_count / p.next_threshold) * 100), 100);
}
