import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { toaster } from '$lib/toast';
import { addDays } from '$lib/calendarFeed';
import type { TrainingPlanSession } from '$lib/models';
import {
  MAIL_DAYS_AHEAD,
  computeNotices,
  fingerprint,
  type MailPlanData,
  type MailScope
} from '$lib/trainingPlanMail';
import { loadMailPlan } from '$lib/trainingPlanMailData';
import { postNotify, type NotifyResponse } from '$lib/trainingPlanMailClient';
import NotifyDialog from './NotifyDialog.svelte';

// The real German texts, so a broken message (ICU syntax, missing key) shows here
beforeAll(() => {
  addMessages('de', de);
  init({ fallbackLocale: 'de', initialLocale: 'de' });
});

const { insert, remove, history } = vi.hoisted(() => ({
  insert: vi.fn(),
  remove: vi.fn(),
  history: vi.fn()
}));
vi.mock('$lib/supabase', () => ({
  supabaseClient: {
    from: (table: string) => ({
      insert: (values: unknown) => insert(table, values),
      delete: () => ({ eq: (column: string, value: unknown) => remove(table, column, value) }),
      select: (columns: string) => ({
        order: () => ({ limit: () => ({ returns: () => history(table, columns) }) })
      })
    })
  }
}));
vi.mock('$lib/trainingPlanMailData', () => ({ loadMailPlan: vi.fn(), loadMailScope: vi.fn() }));
vi.mock('$lib/trainingPlanMailClient', () => ({ postNotify: vi.fn(), loadNotifyMode: vi.fn() }));
vi.mock('$lib/toast', () => ({ toaster: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$lib/clubConfig', () => ({ clubConfig: { name: 'Testclub' } }));

const TK: MailScope = { all: true, trainingIds: [] };
const MAIN_TRAINER: MailScope = { all: false, trainingIds: [1] };
// A Monday
const TODAY = '2026-11-02';
const monday = (week: number) => addDays(TODAY, 7 * week);

function session(id: number, date: string, trainerId: number | null): TrainingPlanSession {
  return {
    id,
    training_id: 1,
    date,
    trainer_id: trainerId,
    topic: null,
    notes: null,
    cancelled: null,
    updated_at: ''
  };
}

/**
 * Max leads the Mondays; Anna and Ben (one family address), Lea (no
 * address), Tom (an anonymized test address) and Eva (no mails) take one
 * each. Nobody was told yet.
 */
function plan(): MailPlanData {
  return {
    today: TODAY,
    to: addDays(TODAY, MAIL_DAYS_AHEAD),
    trainings: [
      {
        id: 1,
        title: 'Judo Montag',
        weekday: 'Monday',
        dateFrom: '18:00',
        dateTo: '19:30',
        section: 'Judo',
        mainTrainerId: 10
      }
    ],
    sessions: [
      session(1, monday(1), 20),
      session(2, monday(2), 21),
      session(3, monday(3), 30),
      session(4, monday(4), 40),
      session(5, monday(5), 50)
    ],
    breaks: [],
    toldTrainings: [],
    toldDates: [],
    optOuts: [50],
    ownMemberIds: [],
    members: [
      { id: 10, firstname: 'Max', lastname: 'Muster' },
      { id: 20, firstname: 'Anna', lastname: 'Aebi' },
      { id: 21, firstname: 'Ben', lastname: 'Aebi' },
      { id: 30, firstname: 'Lea', lastname: 'Keller' },
      { id: 40, firstname: 'Tom', lastname: 'Brunner' },
      { id: 50, firstname: 'Eva', lastname: 'Zaugg' }
    ],
    addresses: [
      { member_id: 10, email: 'max@test.ch', source: 'account' },
      { member_id: 20, email: ' Familie.Aebi@test.ch ', source: 'member' },
      { member_id: 21, email: 'familie.aebi@test.ch', source: 'member' },
      { member_id: 30, email: null, source: null },
      { member_id: 40, email: 'member-40@example.invalid', source: 'member' },
      { member_id: 50, email: 'eva@test.ch', source: 'member' }
    ],
    pendingMails: []
  };
}

/** The plan once the given members were told everything (as training_plan_set_told() stores it) */
function informed(data: MailPlanData, ids: number[]): MailPlanData {
  const states = computeNotices(data, TK)
    .members.filter((n) => ids.includes(n.memberId))
    .map((n) => n.told);
  return {
    ...data,
    toldTrainings: [
      ...data.toldTrainings,
      ...states.flatMap((s) =>
        s.trainings.map((t) => ({ member_id: s.member_id, ...t, told_at: '2026-11-01T10:00:00Z' }))
      )
    ],
    toldDates: [
      ...data.toldDates,
      ...states.flatMap((s) => s.dates.map((d) => ({ member_id: s.member_id, ...d })))
    ]
  };
}

/** The mails as the preview has them: the family first, then Max */
const groups = () => computeNotices(plan(), TK).groups;

/** An answer that lands only when the test says so */
function deferred() {
  let land: (value: NotifyResponse) => void = () => {};
  const promise = new Promise<NotifyResponse>((resolve) => (land = resolve));
  return { promise, land };
}

const SENT: NotifyResponse = { ok: true, status: 'sent', simulated: false, toldSaved: true };

afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(loadMailPlan).mockReset().mockResolvedValue(plan());
  vi.mocked(postNotify).mockReset().mockResolvedValue(SENT);
  insert.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  history.mockReset().mockResolvedValue({ data: [], error: null });
  vi.mocked(toaster.success).mockClear();
  vi.mocked(toaster.error).mockClear();
});

function renderDialog(props: Record<string, unknown> = {}) {
  const onclose = vi.fn();
  const result = render(NotifyDialog, {
    props: {
      mode: 'smtp',
      scope: TK,
      senderName: 'Tina TK',
      senderEmail: 'tina@test.ch',
      waiting: false,
      onclose,
      ...props
    }
  });
  return { ...result, onclose };
}

const dialog = () => screen.getByRole('dialog', { name: 'Trainer informieren' });
/** The card of a mail or of a member, by the names on it */
const card = (names: string) =>
  screen.getByRole('checkbox', { name: `${names} auswählen` }).closest('li') as HTMLElement;
const sendButton = (name: RegExp = /Mails? senden$/) => screen.getByRole('button', { name });
const ready = () => screen.findByRole('heading', { name: /^Per Mail/ });

describe('NotifyDialog', () => {
  it('waits for the plan to be reloaded before it loads', async () => {
    const { rerender } = renderDialog({ waiting: true });
    expect(screen.getByText('Gespeicherte Änderungen werden geladen…')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loadMailPlan).not.toHaveBeenCalled();

    await rerender({ waiting: false });
    await ready();
    expect(loadMailPlan).toHaveBeenCalledTimes(1);
    expect(loadMailPlan).toHaveBeenCalledWith(expect.anything(), TK);
  });

  it('lists one card per address with its lines, and who gets no mail and why', async () => {
    renderDialog();
    expect(await ready()).toHaveTextContent('Per Mail (2)');
    expect(screen.getByText('Antworten gehen an tina@test.ch.')).toBeInTheDocument();
    expect(screen.queryByText(/das Senden wird nur simuliert/)).not.toBeInTheDocument();

    // The family shares one mail, each with their own dates
    const family = card('Anna Aebi, Ben Aebi');
    expect(within(family).getByText('Familie.Aebi@test.ch')).toBeInTheDocument();
    // Their first message: an overview, not news
    expect(within(family).getByText('Du leitest: Mo 9.11.2026')).toBeInTheDocument();
    expect(within(family).getByText('Du leitest: Mo 16.11.2026')).toBeInTheDocument();
    expect(within(family).queryByText('Anmeldeadresse')).not.toBeInTheDocument();

    const max = card('Max Muster');
    expect(within(max).getByText('Anmeldeadresse')).toBeInTheDocument();
    expect(within(max).getByText('Judo Montag (Montag 18:00–19:30)')).toBeInTheDocument();
    expect(
      within(max).getByText('Nicht bei dir: Mo 7.12.2026 – leitet Eva Zaugg')
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Nicht per Mail (3)' })).toBeInTheDocument();
    expect(card('Tom Brunner')).toHaveTextContent('Testadresse, nicht zustellbar');
    expect(card('Lea Keller')).toHaveTextContent('Keine E-Mail-Adresse');
    expect(card('Eva Zaugg')).toHaveTextContent('Möchte keine Mails · eva@test.ch');

    // Mails are checked for sending, the others not; nothing is marked by itself
    expect(screen.getByRole('checkbox', { name: 'Anna Aebi, Ben Aebi auswählen' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Max Muster auswählen' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Lea Keller auswählen' })).not.toBeChecked();
    expect(sendButton()).toHaveTextContent('2 Mails senden');
    expect(screen.getByRole('button', { name: '0 als mitgeteilt markieren' })).toBeDisabled();
  });

  it('sends one address after the other, each with its fingerprint', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(postNotify).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { onclose } = renderDialog();
    await ready();
    await fireEvent.click(sendButton());

    const [family, max] = groups();
    expect(postNotify).toHaveBeenCalledTimes(1);
    expect(postNotify).toHaveBeenLastCalledWith({
      action: 'send',
      memberIds: [20, 21],
      fingerprint: fingerprint(family.members, 'familie.aebi@test.ch'),
      locale: 'de'
    });
    expect(card('Anna Aebi, Ben Aebi')).toHaveTextContent('Wird gesendet…');
    // Busy: no second click, no closing by Escape or the Close button
    expect(sendButton()).toBeDisabled();
    await fireEvent.keyDown(dialog(), { key: 'Escape' });
    const closeButton = screen.getByRole('button', { name: 'Schliessen' });
    expect(closeButton).toBeDisabled();
    await fireEvent.click(closeButton);
    expect(onclose).not.toHaveBeenCalled();

    // The next mail only once the first is answered; then the plan is loaded
    // again (Max's told state could not be saved)
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [20, 21]));
    first.land(SENT);
    await waitFor(() => expect(postNotify).toHaveBeenCalledTimes(2));
    expect(postNotify).toHaveBeenLastCalledWith({
      action: 'send',
      memberIds: [10],
      fingerprint: fingerprint(max.members, 'max@test.ch'),
      locale: 'de'
    });
    second.land({ ok: true, status: 'sent', simulated: false, toldSaved: false });

    await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toaster.success).toHaveBeenCalledWith({ title: '2 Mails gesendet' })
    );
    // Both stay in the list with their status; Max is still pending, to be marked
    expect(await screen.findByRole('heading', { name: 'Per Mail (1)' })).toBeInTheDocument();
    const familyDone = screen.getByText('Anna Aebi, Ben Aebi').closest('li') as HTMLElement;
    expect(familyDone).toHaveTextContent('Gesendet');
    expect(within(familyDone).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(card('Max Muster')).toHaveTextContent('Gesendet');
    expect(card('Max Muster')).toHaveTextContent(/nicht als mitgeteilt gespeichert/);
    // Max's mail went out: not again, but they can be marked
    expect(sendButton(/^0 Mails senden$/)).toBeDisabled();
    expect(screen.getByRole('button', { name: '1 als mitgeteilt markieren' })).toBeEnabled();
  });

  it('stops and loads again when the plan changed meanwhile', async () => {
    vi.mocked(postNotify).mockResolvedValue({ ok: false, code: 'stale', httpStatus: 409 });
    renderDialog();
    await ready();
    await fireEvent.click(sendButton());

    await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(2));
    expect(postNotify).toHaveBeenCalledTimes(1);
    expect(toaster.error).toHaveBeenCalledWith({
      title: expect.stringContaining('Der Plan hat sich inzwischen geändert')
    });
    expect(card('Anna Aebi, Ben Aebi')).not.toHaveTextContent('Wird gesendet…');
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it('stops when it is unclear whether a mail left, and does not send it again by itself', async () => {
    vi.mocked(postNotify).mockResolvedValue({ ok: false, code: 'timeout', httpStatus: 504 });
    renderDialog();
    await ready();
    await fireEvent.click(sendButton());

    await waitFor(() =>
      expect(card('Anna Aebi, Ben Aebi')).toHaveTextContent(
        'Unklar, ob gesendet – bitte nachfragen'
      )
    );
    expect(postNotify).toHaveBeenCalledTimes(1);
    expect(toaster.error).toHaveBeenCalledWith({
      title: 'Unklar, ob gesendet – bitte nachfragen',
      description: 'Anna Aebi, Ben Aebi'
    });
    expect(
      screen.getByRole('checkbox', { name: 'Anna Aebi, Ben Aebi auswählen' })
    ).not.toBeChecked();
    await waitFor(() => expect(sendButton()).toHaveTextContent('1 Mail senden'));
    expect(sendButton()).toBeEnabled();
  });

  it('keeps a card whose outcome is unknown in view, also once it is no longer pending', async () => {
    vi.mocked(postNotify).mockResolvedValue({ ok: false, code: 'network' });
    renderDialog();
    await ready();
    // The mail did leave and was saved: the reload no longer has the family
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [20, 21]));
    await fireEvent.click(sendButton());

    await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Per Mail (1)' })).toBeInTheDocument();
    const family = screen.getByText('Anna Aebi, Ben Aebi').closest('li') as HTMLElement;
    expect(family).toHaveTextContent('Unklar, ob gesendet – bitte nachfragen');
  });

  it('leaves a card unchecked when a mail to it may have left already, also when opened again', async () => {
    const data = plan();
    // An earlier send that was cut off: its log row is still pending
    data.pendingMails = [{ member_id: 21, created_at: '2026-11-01T17:45:00+00:00' }];
    vi.mocked(loadMailPlan).mockResolvedValue(data);
    renderDialog();
    await ready();
    const family = card('Anna Aebi, Ben Aebi');
    expect(family).toHaveTextContent(/Eine Mail vom 01\.11\.2026 \d\d:45 blieb ohne Rückmeldung/);
    expect(
      screen.getByRole('checkbox', { name: 'Anna Aebi, Ben Aebi auswählen' })
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Max Muster auswählen' })).toBeChecked();
    expect(sendButton()).toHaveTextContent('1 Mail senden');

    // Sent again on purpose, with the preview's fingerprint
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Anna Aebi, Ben Aebi auswählen' }));
    expect(sendButton()).toHaveTextContent('2 Mails senden');
    await fireEvent.click(sendButton());
    await waitFor(() => expect(postNotify).toHaveBeenCalledTimes(2));
    const preview = computeNotices(data, TK).groups[0];
    expect(preview.members.map((m) => m.unclearSince)).toEqual([null, '2026-11-01T17:45:00+00:00']);
    expect(vi.mocked(postNotify).mock.calls[0][0].fingerprint).toBe(
      fingerprint(preview.members, 'familie.aebi@test.ch')
    );
  });

  it('treats an outdated address or opt-out like a changed plan: nothing failed', async () => {
    for (const code of ['unreachable', 'several_addresses', 'nothing_pending'] as const) {
      vi.mocked(postNotify).mockReset().mockResolvedValue({ ok: false, code, httpStatus: 400 });
      vi.mocked(loadMailPlan).mockClear();
      vi.mocked(toaster.error).mockClear();
      renderDialog();
      await ready();
      await fireEvent.click(sendButton());

      await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(2));
      expect(postNotify).toHaveBeenCalledTimes(1);
      expect(toaster.error).toHaveBeenCalledWith({
        title: expect.stringContaining('Der Plan hat sich inzwischen geändert')
      });
      expect(card('Anna Aebi, Ben Aebi')).not.toHaveTextContent('Fehlgeschlagen');
      cleanup();
    }
  });

  it('marks only the ticked cards without mail, never a mail card by its box', async () => {
    vi.mocked(postNotify).mockResolvedValue({
      ok: true,
      status: 'marked',
      simulated: false,
      toldSaved: true
    });
    renderDialog();
    await ready();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Lea Keller auswählen' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Tom Brunner auswählen' }));
    // Unchecking a mail only leaves it out of the sending
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Max Muster auswählen' }));
    expect(sendButton()).toHaveTextContent('1 Mail senden');
    await fireEvent.click(screen.getByRole('button', { name: '2 als mitgeteilt markieren' }));

    await waitFor(() => expect(postNotify).toHaveBeenCalledTimes(1));
    const set = computeNotices(plan(), TK);
    const members = set.members.filter((m) => [30, 40].includes(m.memberId));
    // In the order of the list (by name)
    expect(postNotify).toHaveBeenCalledWith({
      action: 'mark',
      memberIds: [40, 30],
      fingerprint: fingerprint(members, null),
      locale: 'de'
    });
    await waitFor(() =>
      expect(toaster.success).toHaveBeenCalledWith({ title: '2 Trainer als mitgeteilt markiert' })
    );
    await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(2));
  });

  it('marks a mail card without a mail only by its own button', async () => {
    vi.mocked(postNotify).mockResolvedValue({
      ok: true,
      status: 'marked',
      simulated: false,
      toldSaved: true
    });
    renderDialog();
    await ready();
    await fireEvent.click(
      within(card('Anna Aebi, Ben Aebi')).getByRole('button', {
        name: 'Ohne Mail als mitgeteilt markieren: Anna Aebi, Ben Aebi'
      })
    );

    await waitFor(() => expect(postNotify).toHaveBeenCalledTimes(1));
    const [family] = groups();
    expect(postNotify).toHaveBeenCalledWith({
      action: 'mark',
      memberIds: [20, 21],
      fingerprint: fingerprint(family.members, null),
      locale: 'de'
    });
    await waitFor(() =>
      expect(toaster.success).toHaveBeenCalledWith({ title: '2 Trainer als mitgeteilt markiert' })
    );
  });

  it('offers to mark everybody as told the first time', async () => {
    vi.mocked(postNotify).mockResolvedValue({
      ok: true,
      status: 'marked',
      simulated: false,
      toldSaved: true
    });
    renderDialog();
    await ready();
    expect(screen.getByRole('heading', { name: 'Erste Mitteilung' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Alle als mitgeteilt markieren' }));

    const confirm = screen.getByRole('dialog', { name: 'Alle als mitgeteilt markieren?' });
    expect(confirm).toHaveTextContent('6 Trainer gelten als informiert, ohne Mail.');
    await fireEvent.click(
      within(confirm).getByRole('button', { name: 'Alle als mitgeteilt markieren' })
    );

    await waitFor(() => expect(postNotify).toHaveBeenCalledTimes(1));
    const request = vi.mocked(postNotify).mock.calls[0][0];
    expect(request.action).toBe('mark');
    expect([...request.memberIds].sort((a, b) => a - b)).toEqual([10, 20, 21, 30, 40, 50]);
    expect(request.fingerprint).toBe(fingerprint(computeNotices(plan(), TK).members, null));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /\?$/ })).not.toBeInTheDocument()
    );
  });

  it('does not offer it once trainers were told', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [10]));
    renderDialog();
    await ready();
    expect(screen.queryByRole('heading', { name: 'Erste Mitteilung' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Max Muster auswählen' })
    ).not.toBeInTheDocument();
  });

  it('only simulates in the demo', async () => {
    vi.mocked(postNotify).mockResolvedValue({
      ok: true,
      status: 'skipped',
      simulated: true,
      toldSaved: true,
      error: 'Demo: no mail is sent'
    });
    renderDialog({ mode: 'demo' });
    await ready();
    expect(screen.getByText(/das Senden wird nur simuliert/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '2 Mails simulieren' }));

    await waitFor(() =>
      expect(toaster.success).toHaveBeenCalledWith({
        title: '2 Mails simuliert (nicht gesendet)'
      })
    );
    expect(card('Max Muster')).toHaveTextContent('Simuliert, nicht gesendet');
    // The server's English reason is not shown next to it
    expect(card('Max Muster')).not.toHaveTextContent('no mail is sent');
  });

  it('only simulates outside production, and says so', async () => {
    renderDialog({ mode: 'test' });
    await ready();
    expect(screen.getByText(/^Testumgebung: Mails an die Trainer gehen nur/)).toBeInTheDocument();
    expect(screen.queryByText(/^Demo:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 Mails simulieren' })).toBeEnabled();
  });

  it('shows a failed mail and goes on with the next', async () => {
    vi.mocked(postNotify)
      .mockResolvedValueOnce({
        ok: true,
        status: 'failed',
        simulated: false,
        toldSaved: false,
        error: '550 rejected'
      })
      .mockResolvedValueOnce(SENT);
    renderDialog();
    await ready();
    await fireEvent.click(sendButton());

    await waitFor(() => expect(postNotify).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card('Anna Aebi, Ben Aebi')).toHaveTextContent('Fehlgeschlagen'));
    expect(card('Anna Aebi, Ben Aebi')).toHaveTextContent('550 rejected');
    expect(toaster.error).toHaveBeenCalledWith({ title: '1 Mail nicht gesendet' });
    expect(toaster.success).toHaveBeenCalledWith({ title: '1 Mail gesendet' });
  });

  it('lets the TK switch mails off for a trainer, who then moves to "Nicht per Mail"', async () => {
    renderDialog();
    await ready();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Keine Mails: Max Muster' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Per Mail (1)' })).toBeInTheDocument()
    );
    expect(insert).toHaveBeenCalledWith('training_plan_mail_optouts', { member_id: 10 });
    expect(card('Max Muster')).toHaveTextContent('Möchte keine Mails · max@test.ch');
    expect(screen.getByRole('heading', { name: 'Nicht per Mail (4)' })).toBeInTheDocument();
    // Not loaded again for it
    expect(loadMailPlan).toHaveBeenCalledTimes(1);

    // And back
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Keine Mails: Eva Zaugg' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('training_plan_mail_optouts', 'member_id', 50)
    );
    await waitFor(() => expect(card('Eva Zaugg')).toHaveTextContent('eva@test.ch'));
    expect(screen.getByRole('checkbox', { name: 'Eva Zaugg auswählen' })).toBeChecked();
  });

  it('keeps the opt-out as stored when saving it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    renderDialog();
    await ready();
    const box = screen.getByRole('checkbox', { name: 'Keine Mails: Max Muster' });
    await fireEvent.click(box);

    await waitFor(() =>
      expect(toaster.error).toHaveBeenCalledWith({ title: 'Konnte nicht gespeichert werden' })
    );
    await waitFor(() => expect(box).not.toBeChecked());
    expect(screen.getByRole('heading', { name: 'Per Mail (2)' })).toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });

  it('gives a main trainer no opt-out toggles', async () => {
    renderDialog({ scope: MAIN_TRAINER });
    await ready();
    expect(loadMailPlan).toHaveBeenCalledWith(expect.anything(), MAIN_TRAINER);
    expect(screen.getByRole('checkbox', { name: 'Max Muster auswählen' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Keine Mails/ })).not.toBeInTheDocument();
  });

  it('closes with Escape or the Close button when nothing is under way', async () => {
    const { onclose } = renderDialog();
    await ready();
    await fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Schliessen' }));
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it('keeps the focus in the dialog when the focused button goes away', async () => {
    renderDialog();
    await ready();
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [10, 20, 21, 30, 40, 50]));
    const send = sendButton();
    send.focus();
    await fireEvent.click(send);

    expect(
      await screen.findByText('Alle Trainer sind auf dem neuesten Stand.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mails? senden$/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Schliessen' }))
    );
  });

  it('shows the mail as it goes out, signed by the sender', async () => {
    renderDialog();
    await ready();
    const max = card('Max Muster');
    const toggle = within(max).getByRole('button', { name: 'Mail ansehen' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(toggle);

    const text = max.querySelector('pre')?.textContent ?? '';
    expect(text).toMatch(/^Hallo Max\n\nHier ist deine Übersicht aus dem Trainingsplan:/);
    expect(text).toContain('- Nicht bei dir: Mo 9.11.2026 – leitet Anna Aebi');
    expect(text).toContain(`${window.location.origin}/dashboard/training-plan`);
    expect(text).toContain('Antworte auf diese Mail, sie geht an Tina TK.');
    expect(text.trim().endsWith('Testclub')).toBe(true);
    expect(text).not.toContain('Trainingsplan: Übersicht');
    expect(within(max).getByRole('button', { name: 'Mail ausblenden' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('shows the first lines of a long notice, the rest on request', async () => {
    const data = plan();
    // Eight single closing days more for Max
    data.breaks = Array.from({ length: 8 }, (_, i) => ({
      id: 100 + i,
      title: `Pause ${i + 1}`,
      date_from: monday(10 + i),
      date_to: monday(10 + i),
      cancels_training: true
    }));
    vi.mocked(loadMailPlan).mockResolvedValue(data);
    renderDialog();
    await ready();
    const max = card('Max Muster');
    expect(within(max).getAllByRole('listitem')).toHaveLength(8);
    const more = within(max).getByRole('button', { name: '6 weitere Zeilen anzeigen' });
    more.focus();
    await fireEvent.click(more);
    expect(within(max).getAllByRole('listitem')).toHaveLength(14);
    // The button is gone: its lines take the focus
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(max).getAllByRole('listitem')[0].closest('[tabindex]')
      )
    );
  });

  it('can load again after a failed load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadMailPlan).mockRejectedValueOnce(new Error('offline'));
    renderDialog();
    expect(
      await screen.findByText('Die Änderungen konnten nicht geladen werden.')
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Nochmals versuchen' }));
    await ready();
    vi.mocked(console.error).mockRestore();
  });

  it('shows the last mails on request', async () => {
    history.mockResolvedValue({
      data: [
        {
          id: 1,
          member_id: 10,
          to_email: 'max@test.ch',
          status: 'sent',
          error: null,
          created_at: '2026-11-01T09:30:00Z',
          member: { firstname: 'Max', lastname: 'Muster' }
        }
      ],
      error: null
    });
    renderDialog();
    await ready();
    const summary = screen.getByText('Letzte Mails');
    const details = summary.closest('details') as HTMLDetailsElement;
    details.open = true;
    await fireEvent(details, new Event('toggle'));

    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    expect(history.mock.calls[0][0]).toBe('training_plan_mails');
    expect(await within(details).findByText('Max Muster')).toBeInTheDocument();
    expect(details).toHaveTextContent('Gesendet · max@test.ch');
  });
});
