import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { parseConnectionStatuses } from '$lib/integrations';
import type { MergeMember } from '$lib/memberMerge';
import { invalidate } from '$app/navigation';
import { toaster } from '$lib/toast';
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
beforeEach(() => {
  rpc.mockReset();
  vi.mocked(invalidate).mockClear();
  vi.mocked(toaster.success).mockClear();
  vi.mocked(toaster.error).mockClear();
});

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
    last_seen_at: null,
    gone_at: null
  }
];

function data(status: object = STATUS) {
  return {
    connections: parseConnectionStatuses([status]),
    runs: RUNS,
    issues: ISSUES,
    members: [member(3240, 'Mira', 'Dupont'), member(10000001, 'Mira', 'Dupont-Muster')],
    events: [{ id: 61001, title: 'Kurs 1', date: '2026-11-02' }],
    groups: GROUPS,
    calendars: CALENDARS,
    eventUrls: {} as Record<string, string>
  };
}

function renderPage(d: object = data()) {
  return render(Page, { props: { data: d } as never });
}

describe('integrations page', () => {
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

  it('shows errors about records that do not exist by their number, never as an empty link', () => {
    const error = {
      ...ISSUES[0],
      code: 'write_failed',
      severity: 'error',
      other_member_id: null,
      detail: '23514',
      dismissed_at: null
    };
    renderPage({
      ...data(),
      issues: [
        ...ISSUES,
        // The insert of a new record failed: no member, only the record number
        { ...error, id: 11, external_id: '4711', member_id: null },
        // An older row named the id the insert would have used
        { ...error, id: 12, external_id: '4712', member_id: 4712 },
        // About a member merged away since
        { ...error, id: 13, code: 'id_conflict', external_id: '3300', member_id: 3300 }
      ]
    });
    expect(screen.getByText('Nicht geschrieben')).toBeInTheDocument();
    expect(screen.getByText('Webling-Nr. 4711')).toBeInTheDocument();
    expect(screen.getByText('Webling-Nr. 4712')).toBeInTheDocument();
    expect(screen.getByText('Konflikte')).toBeInTheDocument();
    expect(screen.getByText('Webling-Nr. 3300')).toBeInTheDocument();
    for (const id of [4712, 3300]) {
      expect(document.querySelector(`a[href="/dashboard/members/${id}"]`)).toBeNull();
    }
    expect(screen.queryByText('Keine offenen Probleme.')).not.toBeInTheDocument();
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

  // An event Webling refused, and three participants Webling has but no linked member
  const eventIssue = (values: object) => ({
    ...ISSUES[1],
    code: 'write_failed',
    severity: 'error',
    external_id: '4711',
    event_id: null,
    detail: '23514',
    dismissed_at: null,
    ...values
  });
  const participants = ['5001', '5002', '5003'].map((externalId, i) =>
    eventIssue({
      id: 30 + i,
      code: 'unknown_participant',
      severity: 'warning',
      external_id: externalId,
      event_id: 61001,
      detail: null
    })
  );
  const template = 'https://club.webling.ch/portal#/calendar/event/{id}';

  it('opens an issue about an event in the provider', () => {
    renderPage({
      ...data(),
      issues: [...ISSUES, eventIssue({ id: 20 }), ...participants],
      eventUrls: { webling: template }
    });
    const links = screen.getAllByRole('link', { name: 'In Webling öffnen' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://club.webling.ch/portal#/calendar/event/4711',
      // the dismissed event, gone from Webling but kept
      'https://club.webling.ch/portal#/calendar/event/61001'
    ]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('links nothing without a safe template', () => {
    for (const eventUrls of [{}, { webling: 'javascript:alert({id})' }, { csv: template }]) {
      renderPage({ ...data(), issues: [...ISSUES, eventIssue({ id: 20 })], eventUrls });
      expect(screen.getByText('Webling-Nr. 4711')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'In Webling öffnen' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('dismisses all open issues of a group one after the other, after confirming', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    renderPage({ ...data(), issues: [...ISSUES, ...participants] });
    // one button: the duplicates are checked one by one, the other groups have one issue
    await fireEvent.click(screen.getByRole('button', { name: 'Alle ausblenden' }));
    const dialog = screen.getByText('Alle ausblenden?').closest('.modal-dialog') as HTMLElement;
    expect(dialog.textContent).toContain(
      'Alle 3 offenen Probleme «Unbekannte Teilnehmende» ausblenden?'
    );
    expect(rpc).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Alle ausblenden' }));
    await waitFor(() => expect(toaster.success).toHaveBeenCalledWith({ title: '3 ausgeblendet' }));
    // in the order shown (newest first)
    expect(rpc.mock.calls).toEqual(
      [32, 31, 30].map((id) => ['integration_dismiss_issue', { p_issue: id, p_dismiss: true }])
    );
    expect(invalidate).toHaveBeenCalledWith('integrations:page');
  });

  it('stops dismissing all at the first error and says how many went through', async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'NOT_ALLOWED' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage({ ...data(), issues: [...ISSUES, ...participants] });
    await fireEvent.click(screen.getByRole('button', { name: 'Alle ausblenden' }));
    const dialog = screen.getByText('Alle ausblenden?').closest('.modal-dialog') as HTMLElement;
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Alle ausblenden' }));
    await waitFor(() =>
      expect(toaster.error).toHaveBeenCalledWith({
        title: '1 von 3 ausgeblendet, dann hat es nicht geklappt. Versuch es noch einmal.'
      })
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(toaster.success).not.toHaveBeenCalled();
    // the one dismissed shows as such
    expect(invalidate).toHaveBeenCalledWith('integrations:page');
    log.mockRestore();
  });

  it('offers no dismiss all for possible duplicates', () => {
    const duplicates = [3, 4].map((id) => ({
      ...ISSUES[0],
      id,
      external_id: String(3238 + id),
      member_id: 3238 + id
    }));
    renderPage({
      ...data(),
      issues: [...ISSUES, ...duplicates],
      members: [...data().members, member(3241, 'Lea', 'Muster'), member(3242, 'Lea', 'Muster')]
    });
    expect(screen.getAllByRole('button', { name: /Kein Duplikat/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Alle ausblenden' })).not.toBeInTheDocument();
  });

  it('marks a calendar the provider no longer has instead of asking to review it', () => {
    const gone = {
      ...CALENDARS[0],
      id: 2,
      external_id: 'c2',
      name: 'Judo Erwachsene Trainings',
      reviewed: false,
      gone_at: hourAgo
    };
    renderPage({ ...data(), calendars: [gone, ...CALENDARS] });
    const row = screen
      .getByText('Judo Erwachsene Trainings', { selector: 'span.font-medium' })
      .closest('tr')!;
    expect(within(row).getByText('Nicht mehr in Webling')).toBeInTheDocument();
    expect(within(row).queryByText('Neu')).not.toBeInTheDocument();
    // listed after the calendars the provider still has
    const names = screen
      .getAllByText(/Agenda|Trainings/, { selector: 'span.font-medium' })
      .map((n) => n.textContent);
    expect(names).toEqual(['Judo Agenda', 'Judo Erwachsene Trainings']);
  });

  it('asks to review new groups and calendars, and why', () => {
    renderPage(data({ ...STATUS, to_review: { groups: 2, calendars: 1 } }));
    const alert = screen.getAllByRole('alert').find((a) => a.textContent?.includes('geprüft'));
    // Only a membership ends the lockout; "Geprüft" alone just clears the dot
    expect(alert?.textContent).toContain(
      '2 neue Gruppen aus Webling sind noch nicht geprüft. Solange eine Gruppe keine ' +
        'Mitgliedschaft hat, zählen Mitglieder ohne andere Statusgruppe als Nicht-Mitglieder'
    );
    expect(alert?.textContent).toContain('«Geprüft» allein ändert daran nichts.');
    expect(alert?.textContent).toContain(
      '1 neuer Kalender aus Webling ist noch nicht geprüft, seine Events stehen in einer ' +
        'vermuteten Sparte.'
    );
    expect(alert?.className).toContain('preset-tonal-warning');
  });

  it('shows no warning for a connection that never ran', () => {
    // The seeded catalog rows are reviewed; new ones only come with a run
    renderPage(
      data({
        ...STATUS,
        last_run: { config: null, members: null, events: null },
        last_success: {},
        to_review: { groups: 0, calendars: 0 }
      })
    );
    expect(screen.getByRole('heading', { name: 'Webling' })).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toEqual([]);
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

  it('names the status when more than half of it would lose the membership', async () => {
    // As on prod: 269 active and 30 passive counting, so the limit for all is 29
    rpc.mockResolvedValue({
      data: {
        run: 9,
        status: 'refused',
        groups: 1,
        calendars: 0,
        statuses_changed: 20,
        hint: 'accept_status_drop=20',
        guard: {
          limit: 29,
          counting: 299,
          dropping: 20,
          gaining: 0,
          by_status: { passive: 20 },
          became: { non_member: 20 },
          over_drop: true,
          over_gain: false
        }
      },
      error: null
    });
    renderPage();
    const aktiv = screen.getByText('Aktiv', { selector: 'span.font-medium' }).closest('tr')!;
    await fireEvent.change(within(aktiv).getByLabelText('Mitgliedschaft'), {
      target: { value: '' }
    });
    await fireEvent.click(screen.getByRole('button', { name: /Vorschau/ }));
    await waitFor(() =>
      expect(
        screen.getByText(
          '20 Mitglieder mit Status «Passiv» verlieren ihre Mitgliedschaft: mehr als die Hälfte dieses Status.'
        )
      ).toBeInTheDocument()
    );
    // Not the limit for all next to a smaller number
    expect(screen.queryByText(/Sperre ab mehr als 29/)).not.toBeInTheDocument();
    expect(screen.getByText(/mehr, als die Sperre erlaubt/)).toBeInTheDocument();
  });

  it('does not save while an input is invalid', async () => {
    rpc.mockResolvedValue({
      data: { run: 9, status: 'dry_run', groups: 1, calendars: 0, statuses_changed: 0, guard: {} },
      error: null
    });
    renderPage();
    const neu = screen.getByText('Mitglieder', { selector: 'span.font-medium' }).closest('tr')!;
    await fireEvent.click(within(neu).getByLabelText('Geprüft'));
    await fireEvent.click(screen.getByRole('button', { name: /Vorschau/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled());
    // Another row's rank the database would refuse: left out of the changes,
    // so the preview still fits them, but saving would drop it without a word
    const aktiv = screen.getByText('Aktiv', { selector: 'span.font-medium' }).closest('tr')!;
    await fireEvent.input(within(aktiv).getByLabelText('Rang'), { target: { value: '1000' } });
    expect(screen.getByText('Rang und Tage sind Zahlen von 0 bis 999.')).toBeInTheDocument();
    expect(screen.queryByText(/zeig die Vorschau noch einmal/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Vorschau/ })).toBeDisabled();
  });

  it('takes another admin’s save into untouched rows when the page reloads', async () => {
    rpc.mockResolvedValue({
      data: { run: 9, status: 'dry_run', groups: 1, calendars: 0, statuses_changed: 0, guard: {} },
      error: null
    });
    const { rerender } = renderPage();
    const neu = () =>
      screen.getByText('Mitglieder', { selector: 'span.font-medium' }).closest('tr')!;
    const aktiv = () => screen.getByText('Aktiv', { selector: 'span.font-medium' }).closest('tr')!;
    await fireEvent.click(within(neu()).getByLabelText('Ausblenden'));
    await fireEvent.click(screen.getByRole('button', { name: /Vorschau/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled());

    // Meanwhile another admin moved Aktiv to rank 25 and confirmed Mitglieder;
    // a dismiss reloads the page in place
    const groups = GROUPS.map((g) =>
      g.id === 2 ? { ...g, rank: 25 } : { ...g, reviewed: true, status: 'passive' }
    );
    await rerender({ data: { ...data(), groups } } as never);

    expect(within(aktiv()).getByLabelText('Rang')).toHaveValue('25');
    expect(within(neu()).getByLabelText('Mitgliedschaft')).toHaveValue('passive');
    expect(within(neu()).getByLabelText('Ausblenden')).toBeChecked();
    // The preview was made on other rows
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByText(/zeig die Vorschau noch einmal/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Vorschau/ }));
    // Only what this admin changed: nothing sets Aktiv back to rank 20
    expect(rpc).toHaveBeenLastCalledWith('integration_set_mapping', {
      p_connection: 'webling',
      p_changes: { groups: [{ id: 17, hidden: true }], calendars: [] },
      p_options: { dry_run: true }
    });
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
