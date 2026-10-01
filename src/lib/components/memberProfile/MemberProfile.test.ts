import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { MemberAchievements } from '$lib/models';
import MemberProfile from './MemberProfile.svelte';

vi.mock('svelte-i18n', () => ({
  _: readable((key: string) => key),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

// Attendance queries: an empty result is enough to render the sections
vi.mock('$lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'returns']) {
    query[m] = () => query;
  }
  query.then = (resolve: (r: unknown) => void) => resolve({ data: [], error: null });
  return { supabaseClient: { from: () => query } };
});

afterEach(() => cleanup());

const achievements: MemberAchievements = {
  badges: [],
  badgeProgress: [],
  badgeDefinitions: [],
  currentGrades: [],
  gradeHistory: [],
  medals: [],
  gradeDefinitions: []
};

const base = { id: 42, firstname: 'Anna', lastname: 'Muster', photo: null, achievements };

describe('MemberProfile', () => {
  it('shows another member read-only and without private data (club area)', () => {
    const { container, queryByText, getByText } = render(MemberProfile, {
      props: { ...base, tags: ['Judo'] }
    });
    expect(getByText('Anna Muster')).toBeTruthy();
    expect(getByText('Judo')).toBeTruthy();
    expect(queryByText('#42')).toBeNull();
    expect(queryByText('page.members.mobile')).toBeNull();
    expect(queryByText('page.members.attendance.title')).toBeNull();
    expect(queryByText('medals.addMedal')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('shows the own profile with contact data and attendance, still read-only', () => {
    const { getByText, queryByText } = render(MemberProfile, {
      props: {
        ...base,
        isMine: true,
        details: { email: 'anna@example.com' },
        detailsHint: true,
        showAttendance: true
      }
    });
    expect(getByText('page.club.thatsYou')).toBeTruthy();
    expect(getByText('anna@example.com')).toBeTruthy();
    expect(getByText('page.club.detailsHint')).toBeTruthy();
    expect(getByText('page.members.attendance.title')).toBeTruthy();
    expect(queryByText('medals.addMedal')).toBeNull();
  });

  it('adds member number, notes and edit controls for staff', () => {
    const { getByText, container } = render(MemberProfile, {
      props: {
        ...base,
        showId: true,
        details: { email: 'anna@example.com', mobile: '079 123 45 67' },
        notes: 'Knie schonen',
        showAttendance: true,
        editing: { events: [], onchanged: vi.fn() }
      }
    });
    expect(getByText('#42')).toBeTruthy();
    expect(getByText('Knie schonen')).toBeTruthy();
    expect(getByText('medals.addMedal')).toBeTruthy();
    expect(container.querySelector('a[href="tel:0791234567"]')).toBeTruthy();
    expect(container.querySelector('a[href="mailto:anna@example.com"]')).toBeTruthy();
  });
});
