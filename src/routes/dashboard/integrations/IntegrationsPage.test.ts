import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { parseConnectionStatuses } from '$lib/integrations';
import type { MergeMember } from '$lib/memberMerge';
import Page from './+page.svelte';

// The real German texts, so a broken message (ICU syntax, missing key) shows here
beforeAll(() => {
  addMessages('de', de);
  init({ fallbackLocale: 'de', initialLocale: 'de' });
});

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('$lib/supabase', () => ({ supabaseClient: { rpc } }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}) }));
vi.mock('$lib/clubConfig', () => ({
  clubConfig: { sections: ['Judo', 'Aikido', 'Club', 'General'] }
}));
vi.mock('$lib/toast', () => ({ toaster: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => cleanup());
beforeEach(() => rpc.mockReset());

const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

// Shapes as the layer wrote them on a test database (populated like the sync would)
const STATUS = {
  id: 'webling',
  provider: 'webling',
  display_name: 'Webling',
  enabled: true,
  runs_in: 'sync',
  members: { gone: 0, linked: 517, last_seen_at: hourAgo },
  events: { gone: 0, linked: 40, last_seen_at: hourAgo },
  breaks: 0,
  to_review: { groups: 1, calendars: 0 },
  last_run: {
    config: null,
    events: {
      id: 5,
      error: null,
      status: 'ok',
      dry_run: false,
      refused: null,
      started_at: hourAgo,
      finished_at: hourAgo
    },
    members: {
      id: 3,
      error: null,
      status: 'refused',
      dry_run: false,
      refused: 'members_gone',
      started_at: hourAgo,
      finished_at: hourAgo
    }
  },
  last_success: { events: hourAgo, members: hourAgo },
  issues: { info: 0, error: 0, warning: 1 }
};

const RUNS = [
  {
    id: 5,
    connection: 'webling',
    kind: 'events',
    scope: {},
    trigger: 'schedule',
    runner: 'github:1',
    dry_run: false,
    status: 'ok',
    started_at: hourAgo,
    applied_at: hourAgo,
    finished_at: hourAgo,
    result: { adopted: 40, received: 40, registrations_adopted: 6, unchanged: 0 },
    guard: {},
    accepted: {},
    adapter: { errors: 0 },
    error: null
  },
  {
    id: 3,
    connection: 'webling',
    kind: 'members',
    scope: { complete: true },
    trigger: 'schedule',
    runner: 'github:1',
    dry_run: false,
    status: 'refused',
    started_at: hourAgo,
    applied_at: hourAgo,
    finished_at: hourAgo,
    result: {},
    guard: {
      members: {
        limit: 51,
        former: 0,
        staged: 456,
        to_gone: 60,
        complete: true,
        active_links: 516
      },
      refused: 'members_gone'
    },
    accepted: {},
    adapter: { errors: 0 },
    error: null
  },
  {
    id: 2,
    connection: 'webling',
    kind: 'members',
    scope: { complete: true },
    trigger: 'manual',
    runner: 'github:1',
    dry_run: false,
    status: 'warning',
    started_at: hourAgo,
    applied_at: hourAgo,
    finished_at: hourAgo,
    result: { received: 517, inserted: 1, unchanged: 516 },
    guard: {},
    accepted: { gone: 7 },
    adapter: { errors: 2 },
    error: 'fetch_failed'
  }
];

const member = (id: number, firstname: string, lastname: string): MergeMember =>
  ({
    id,
    firstname,
    lastname,
    birthday: '2001-02-03',
    email: null,
    labels: [],
    membership_status: 'active',
    archivedAt: null,
    trialRegisteredAt: null
  }) as MergeMember;

const ISSUES = [
  {
    id: 2,
    connection: 'webling',
    kind: 'members',
    code: 'possible_duplicate',
    severity: 'warning',
    external_id: '3240',
    member_id: 3240,
    other_member_id: 10000001,
    event_id: null,
    detail: 'name_birthday',
    first_seen_at: hourAgo,
    last_seen_at: hourAgo,
    dismissed_at: null
  },
  {
    id: 7,
    connection: 'webling',
    kind: 'events',
    code: 'event_gone_kept',
    severity: 'warning',
    external_id: '61001',
    member_id: null,
    other_member_id: null,
    event_id: 61001,
    detail: null,
    first_seen_at: hourAgo,
    last_seen_at: hourAgo,
    dismissed_at: hourAgo
  }
];

const GROUPS = [
  {
    id: 2,
    connection: 'webling',
    external_id: 'g1',
    name: 'Aktiv',
    label: null,
    status: 'active',
    rank: 20,
    hidden: true,
    role: null,
    reviewed: true,
    last_seen_at: null
  },
  {
    id: 17,
    connection: 'webling',
    external_id: 'g9',
    name: 'Mitglieder',
    label: null,
    status: null,
    rank: 100,
    hidden: false,
    role: null,
    reviewed: false,
    last_seen_at: null
  }
];

const CALENDARS = [
  {
    id: 1,
    connection: 'webling',
    external_id: 'c1',
    name: 'Judo Agenda',
    target: 'event',
    section: 'Judo',
    closed_max_days: null,
    reviewed: true,
    last_seen_at: null
  }
];

function data(status: object = STATUS) {
  return {
    available: true,
    connections: parseConnectionStatuses([status]),
    runs: RUNS,
    issues: ISSUES,
    members: [member(3240, 'Mira', 'Dupont'), member(10000001, 'Mira', 'Dupont-Muster')],
    events: [{ id: 61001, title: 'Kurs 1', date: '2026-11-02' }],
    groups: GROUPS,
    calendars: CALENDARS
  };
}

function renderPage(d: object = data()) {
  return render(Page, { props: { data: d } as never });
}

describe('integrations page', () => {
  it('says so on a database without the layer', () => {
    renderPage({ ...data(), available: false, connections: [] });
    expect(screen.getByText(/noch nicht eingerichtet/)).toBeInTheDocument();
  });

  it('shows the numbers and a refusal with its exact override', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Webling' })).toBeInTheDocument();
    expect(screen.getByText('517')).toBeInTheDocument();
    expect(screen.getByText('Mitglieder verknüpft')).toBeInTheDocument();
    const alert = screen.getAllByRole('alert').find((a) => a.textContent?.includes('gestoppt'));
    expect(alert?.textContent).toContain('60 Mitglieder wären auf einmal weg');
    expect(alert?.textContent).toContain(
      'Actions → Webling Sync → Run workflow mit accept_gone = 60'
    );
  });

  it('lists runs with their counts, overrides and codes', () => {
    renderPage();
    expect(
      screen.getByText('40 gelesen · 40 übernommen · 6 Anmeldungen übernommen')
    ).toBeInTheDocument();
    expect(screen.getByText(/517 gelesen · 1 neu · 2 Abruffehler/)).toBeInTheDocument();
    expect(screen.getByText('accept_gone=7')).toBeInTheDocument();
    expect(screen.getByText('members_gone (accept_gone=60)')).toBeInTheDocument();
    expect(screen.getByText('fetch_failed')).toBeInTheDocument();
  });

  it('links both members of a possible duplicate and dismisses it as no duplicate', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    renderPage();
    expect(screen.getByText('Mögliche Duplikate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dupont Mira' })).toHaveAttribute(
      'href',
      '/dashboard/members/3240'
    );
    expect(screen.getByRole('link', { name: 'Dupont-Muster Mira' })).toHaveAttribute(
      'href',
      '/dashboard/members/10000001'
    );
    expect(screen.getByRole('button', { name: /Zusammenführen/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Kein Duplikat/ }));
    expect(rpc).toHaveBeenCalledWith('integration_dismiss_issue', { p_issue: 2, p_dismiss: true });
  });

  it('reopens a dismissed issue', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    renderPage();
    expect(screen.getByRole('link', { name: 'Kurs 1' })).toHaveAttribute(
      'href',
      '/dashboard/events/61001'
    );
    await fireEvent.click(screen.getByRole('button', { name: /Wieder öffnen/ }));
    expect(rpc).toHaveBeenCalledWith('integration_dismiss_issue', { p_issue: 7, p_dismiss: false });
  });

  it('warns about mapping changes before the switch to the layer', () => {
    renderPage(data({ ...STATUS, last_run: { members: null, events: null } }));
    expect(
      screen.getByText(/läuft noch nicht über die neue Integrationsschicht/)
    ).toBeInTheDocument();
  });

  it('previews a mapping change, then saves it with the accepted number after confirming', async () => {
    const preview = {
      run: 7,
      status: 'refused',
      groups: 1,
      calendars: 0,
      statuses_changed: 157,
      hint: 'accept_status_drop=153',
      guard: {
        limit: 19,
        became: { non_member: 153 },
        gaining: 0,
        counting: 191,
        dropping: 153,
        over_drop: true,
        over_gain: false
      }
    };
    rpc.mockResolvedValueOnce({ data: preview, error: null }).mockResolvedValueOnce({
      data: { ...preview, run: 8, status: 'ok', accepted: { status_drop: 153 } },
      error: null
    });
    renderPage();
    expect(screen.queryByText(/läuft noch nicht über/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Speichern' });
    expect(save).toBeDisabled();

    const aktiv = screen.getByText('Aktiv', { selector: 'span.font-medium' }).closest('tr')!;
    await fireEvent.change(within(aktiv).getByLabelText('Mitgliedschaft'), {
      target: { value: '' }
    });
    await fireEvent.click(screen.getByRole('button', { name: /Vorschau/ }));
    expect(rpc).toHaveBeenLastCalledWith('integration_set_mapping', {
      p_connection: 'webling',
      p_changes: { groups: [{ id: 2, status: null }], calendars: [] },
      p_options: { dry_run: true }
    });
    await waitFor(() =>
      expect(screen.getByText(/153 Mitglieder verlieren ihre Mitgliedschaft/)).toBeInTheDocument()
    );
    expect(screen.getByText(/mehr, als die Sperre erlaubt/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const dialog = screen.getByText('Zuordnung speichern?').closest('.modal-dialog') as HTMLElement;
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith('integration_set_mapping', {
        p_connection: 'webling',
        p_changes: { groups: [{ id: 2, status: null }], calendars: [] },
        p_options: { accept_status_drop: 153 }
      })
    );
  });

  it('needs a new preview once the inputs change', async () => {
    rpc.mockResolvedValue({
      data: { run: 9, status: 'dry_run', groups: 1, calendars: 0, statuses_changed: 0, guard: {} },
      error: null
    });
    renderPage();
    const neu = screen.getByText('Mitglieder', { selector: 'span.font-medium' }).closest('tr')!;
    await fireEvent.click(within(neu).getByLabelText('Geprüft'));
    await fireEvent.click(screen.getByRole('button', { name: /Vorschau/ }));
    expect(rpc).toHaveBeenLastCalledWith('integration_set_mapping', {
      p_connection: 'webling',
      p_changes: { groups: [{ id: 17 }], calendars: [] },
      p_options: { dry_run: true }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled());
    await fireEvent.click(within(neu).getByLabelText('Ausblenden'));
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByText(/zeig die Vorschau noch einmal/)).toBeInTheDocument();
  });
});
