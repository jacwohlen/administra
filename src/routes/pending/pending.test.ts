import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import Page from './+page.svelte';

vi.mock('svelte-i18n', () => ({
  _: readable((key: string) => key),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_CLUB_CONTACT_EMAIL: 'info@example.com' } }));
vi.mock('$lib/supabase', () => ({ supabaseClient: { auth: { signOut: vi.fn() } } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

afterEach(() => cleanup());

function renderWith(status: string, statuses: string[] | null) {
  const data = {
    session: { user: { email: 'a@example.com' } },
    userProfile: { status, role: 'member' },
    access: statuses && { has_access: false, member_statuses: statuses }
  };
  return render(Page, { props: { data } as never });
}

describe('pending page', () => {
  it('says the e-mail is not on file when no member record matches', () => {
    renderWith('pending', []);
    expect(screen.getByText('page.pending.title')).toBeInTheDocument();
    expect(screen.getByText('page.pending.noMemberMatch')).toBeInTheDocument();
    expect(screen.getByText('page.pending.message')).toBeInTheDocument();
  });

  it('names the status when the records do not count', () => {
    renderWith('pending', ['left', 'non_member']);
    expect(screen.getByText('page.pending.inactiveTitle')).toBeInTheDocument();
    expect(screen.getByText('page.pending.inactiveMessage')).toBeInTheDocument();
    expect(screen.getByText('page.members.status.left')).toBeInTheDocument();
    expect(screen.getByText('page.members.status.non_member')).toBeInTheDocument();
    expect(screen.getByText('info@example.com')).toBeInTheDocument();
    expect(screen.queryByText('page.pending.noMemberMatch')).not.toBeInTheDocument();
  });

  it('tells an approved account its access is paused, without the staff hint', () => {
    renderWith('approved', ['archived']);
    expect(screen.getByText('page.pending.noAccessTitle')).toBeInTheDocument();
    expect(screen.getByText('page.pending.endedMessage')).toBeInTheDocument();
    expect(screen.getByText('page.members.status.archived')).toBeInTheDocument();
    expect(screen.queryByText('page.pending.message')).not.toBeInTheDocument();
  });

  it('sends an approved account whose e-mail is no longer on file to the right address', () => {
    renderWith('approved', []);
    expect(screen.getByText('page.pending.noAccessTitle')).toBeInTheDocument();
    expect(screen.getByText('page.pending.noMemberMatch')).toBeInTheDocument();
  });

  it('has its own text for trial candidates', () => {
    renderWith('pending', ['trial']);
    expect(screen.getByText('page.pending.trialMessage')).toBeInTheDocument();
    expect(screen.queryByText('page.pending.inactiveHelp')).not.toBeInTheDocument();
  });

  it('gives no reason when the access is unknown, rather than a wrong one', () => {
    renderWith('pending', null);
    expect(screen.getByText('page.pending.title')).toBeInTheDocument();
    expect(screen.queryByText('page.pending.noMemberMatch')).not.toBeInTheDocument();
  });

  it('shows the disabled message for disabled accounts', () => {
    renderWith('disabled', null);
    expect(screen.getByText('page.pending.disabledTitle')).toBeInTheDocument();
  });
});
