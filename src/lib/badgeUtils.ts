import type { Badge } from '$lib/models';

const CATEGORY_ORDER = ['top_performer', 'attendance', 'streak', 'trainer', 'event'];

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
