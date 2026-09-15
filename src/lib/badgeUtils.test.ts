import { describe, it, expect } from 'vitest';
import {
  badgeKey,
  badgeSuffix,
  buildBadgeTrails,
  groupBadgesWithProgress,
  progressPercent
} from './badgeUtils';
import type { Badge, BadgeDefinition, BadgeProgress } from './models';

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

const def = (
  id: string,
  category: string,
  threshold: number | null,
  sortOrder = 0
): BadgeDefinition => ({
  id,
  category,
  emoji: 'z',
  threshold,
  sortOrder,
  scope: threshold === null ? 'season' : 'lifetime'
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

describe('buildBadgeTrails', () => {
  const definitions = [
    def('attendance_50', 'attendance', 50),
    def('attendance_10', 'attendance', 10),
    def('attendance_25', 'attendance', 25),
    def('streak_5', 'streak', 5),
    def('streak_10', 'streak', 10),
    def('top_3', 'season', null)
  ];

  it('marks earned tiers done, the first unearned tier next with progress, the rest locked', () => {
    const trails = buildBadgeTrails(
      definitions,
      [badge('attendance_10', 'attendance', 10)],
      [next('attendance', 20, 25)]
    );
    const attendance = trails.find((t) => t.category === 'attendance')!;
    expect(attendance.steps.map((s) => s.def.id)).toEqual([
      'attendance_10',
      'attendance_25',
      'attendance_50'
    ]);
    expect(attendance.steps.map((s) => s.state)).toEqual(['done', 'next', 'lock']);
    expect(attendance.steps[1].current).toBe(20);
    expect(attendance.steps[1].pct).toBe(80);
  });

  it('shows a fully earned ladder as all done and skips categories without tiers', () => {
    const trails = buildBadgeTrails(
      definitions,
      [badge('streak_5', 'streak', 15), badge('streak_10', 'streak', 25)],
      []
    );
    expect(trails.map((t) => t.category)).toEqual(['attendance', 'streak']);
    expect(trails[1].steps.map((s) => s.state)).toEqual(['done', 'done']);
    expect(trails[0].steps.map((s) => s.state)).toEqual(['next', 'lock', 'lock']);
    expect(trails[0].steps[0].current).toBe(0);
  });

  it('ignores season badges when deciding which lifetime tiers are earned', () => {
    const trails = buildBadgeTrails(definitions, [badge('top_3', 'season', 55, 2026, 'Judo')], []);
    expect(trails.every((t) => t.steps[0].state === 'next')).toBe(true);
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
