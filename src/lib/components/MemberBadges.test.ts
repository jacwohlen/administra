import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { Badge, BadgeDefinition, BadgeProgress } from '$lib/models';
import { dismissTip } from '$lib/badgeTip.svelte';
import MemberBadges from './MemberBadges.svelte';

vi.mock('svelte-i18n', () => ({
  _: readable((key: string) => key),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));

afterEach(() => {
  dismissTip();
  cleanup();
});

const definitions: BadgeDefinition[] = [10, 25, 50].map((threshold, i) => ({
  id: `attendance_${threshold}`,
  category: 'attendance',
  emoji: 'x',
  threshold,
  sortOrder: i,
  scope: 'lifetime'
}));

const badges: Badge[] = [
  {
    badgeId: 'attendance_10',
    category: 'attendance',
    emoji: 'x',
    sortOrder: 0,
    earnedAt: '2026-01-01T00:00:00Z',
    season: 0,
    context: ''
  }
];

const progress: BadgeProgress[] = [
  {
    category: 'attendance',
    current_count: 17,
    next_badge_id: 'attendance_25',
    next_badge_emoji: 'x',
    next_threshold: 25
  }
];

function stepLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.step .lbl')].map((el) => el.textContent?.trim() ?? '');
}

describe('MemberBadges', () => {
  it('shows the count towards the next tier on the own profile', async () => {
    const { container, getByRole } = render(MemberBadges, {
      props: { badges, progress, definitions }
    });
    expect(stepLabels(container)).toEqual(['10', '17 / 25', '50']);

    await fireEvent.click(container.querySelectorAll('.step')[1]);
    expect(getByRole('tooltip').textContent).toContain('17 badges.progress.of 25');
  });

  // Another member's profile in the club area: the counts are attendance,
  // which the club area does not show (get_member_badge_progress refuses)
  it('shows only the threshold of the next tier without progress', async () => {
    const { container, getByRole } = render(MemberBadges, {
      props: { badges, progress: null, definitions }
    });
    expect(stepLabels(container)).toEqual(['10', '25', '50']);
    expect(container.querySelector('.step.next')).toBeTruthy();

    await fireEvent.click(container.querySelectorAll('.step')[1]);
    expect(getByRole('tooltip').textContent).not.toContain('badges.progress.of');
  });
});
