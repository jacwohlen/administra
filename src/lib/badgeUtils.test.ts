import { describe, it, expect } from 'vitest';
import { groupBadgesWithProgress, progressPercent } from './badgeUtils';
import type { Badge, BadgeProgress } from './models';

const badge = (badgeId: string, category: string, sortOrder: number): Badge => ({
  badgeId,
  category,
  emoji: 'x',
  sortOrder,
  earnedAt: '2026-01-01T00:00:00Z'
});

const next = (category: string, current: number, threshold: number): BadgeProgress => ({
  category,
  current_count: current,
  next_badge_id: `${category}_${threshold}`,
  next_badge_emoji: 'y',
  next_threshold: threshold
});

describe('groupBadgesWithProgress', () => {
  it('orders earned badges lowest to highest within a category', () => {
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

  it('keeps the fixed category order and attaches progress to earned groups', () => {
    const groups = groupBadgesWithProgress(
      [badge('streak_5', 'streak', 15), badge('top_3', 'top_performer', 55)],
      [next('attendance', 25, 50), next('streak', 9, 10)]
    );
    expect(groups.map((g) => g.category)).toEqual(['top_performer', 'attendance', 'streak']);
    expect(groups[2].badges.map((b) => b.badgeId)).toEqual(['streak_5']);
    expect(groups[2].next?.current_count).toBe(9);
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
