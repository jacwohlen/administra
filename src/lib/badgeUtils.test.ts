import { describe, it, expect } from 'vitest';
import { badgeKey, badgeSuffix, groupBadgesWithProgress, progressPercent } from './badgeUtils';
import type { Badge, BadgeProgress } from './models';

const badge = (
  badgeId: string,
  category: string,
  sortOrder: number,
  season = 0,
  context = ''
): Badge => ({
  badgeId,
  category,
  emoji: 'x',
  sortOrder,
  earnedAt: '2026-01-01T00:00:00Z',
  season,
  context
});

const next = (category: string, current: number, threshold: number): BadgeProgress => ({
  category,
  current_count: current,
  next_badge_id: `${category}_${threshold}`,
  next_badge_emoji: 'y',
  next_threshold: threshold
});

describe('groupBadgesWithProgress', () => {
  it('orders lifetime badges lowest to highest within a category', () => {
    const groups = groupBadgesWithProgress(
      [badge('attendance_25', 'attendance', 20), badge('attendance_10', 'attendance', 10)],
      []
    );
    expect(groups.map((g) => g.category)).toEqual(['attendance']);
    expect(groups[0].badges.map((b) => b.badgeId)).toEqual(['attendance_10', 'attendance_25']);
    expect(groups[0].next).toBeUndefined();
  });

  it('includes categories that only have a next badge', () => {
    const groups = groupBadgesWithProgress([], [next('event', 0, 3)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('event');
    expect(groups[0].badges).toEqual([]);
    expect(groups[0].next?.next_threshold).toBe(3);
  });

  it('puts the season group first and orders it newest year, then most prestigious', () => {
    const groups = groupBadgesWithProgress(
      [
        badge('streak_5', 'streak', 15),
        badge('season_regular', 'season', 38, 2026),
        badge('top_3', 'season', 55, 2025, 'Judo'),
        badge('top_3', 'season', 55, 2026, 'Judo')
      ],
      [next('attendance', 25, 50), next('season', 25, 40)]
    );
    expect(groups.map((g) => g.category)).toEqual(['season', 'attendance', 'streak']);
    expect(groups[0].badges.map(badgeKey)).toEqual([
      'top_3:2026:Judo',
      'season_regular:2026:',
      'top_3:2025:Judo'
    ]);
    expect(groups[0].next?.next_threshold).toBe(40);
  });
});

describe('badgeSuffix', () => {
  it('names the section and year for season badges only', () => {
    expect(badgeSuffix(badge('top_3', 'season', 55, 2026, 'Judo'))).toBe('Judo 2026');
    expect(badgeSuffix(badge('season_regular', 'season', 38, 2026))).toBe('2026');
    expect(badgeSuffix(badge('attendance_10', 'attendance', 10))).toBe('');
  });
});

describe('progressPercent', () => {
  it('rounds and caps at 100', () => {
    expect(progressPercent(next('attendance', 25, 50))).toBe(50);
    expect(progressPercent(next('attendance', 9, 10))).toBe(90);
    expect(progressPercent(next('attendance', 12, 10))).toBe(100);
    expect(progressPercent(next('attendance', 0, 0))).toBe(0);
  });
});
