import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { addDays } from '$lib/calendarFeed';
import {
  MAIL_DAYS_AHEAD,
  computeNotices,
  type MailPlanData,
  type MailScope
} from '$lib/trainingPlanMail';
import { loadMailPlan } from '$lib/trainingPlanMailData';
import NotifyBanner from './NotifyBanner.svelte';

// The real German texts, so a broken message (ICU syntax, missing key) shows here
beforeAll(() => {
  addMessages('de', de);
  init({ fallbackLocale: 'de', initialLocale: 'de' });
});

vi.mock('$lib/supabase', () => ({ supabaseClient: {} }));
vi.mock('$lib/trainingPlanMailData', () => ({ loadMailPlan: vi.fn(), loadMailScope: vi.fn() }));

const TK: MailScope = { all: true, trainingIds: [] };
// A Monday
const TODAY = '2026-11-02';

/** Training 1 on Mondays, led by Max; Anna takes the next one */
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
      {
        id: 1,
        training_id: 1,
        date: addDays(TODAY, 7),
        trainer_id: 20,
        topic: null,
        notes: null,
        cancelled: null,
        updated_at: ''
      }
    ],
    breaks: [],
    toldTrainings: [],
    toldDates: [],
    optOuts: [],
    ownMemberIds: [],
    members: [
      { id: 10, firstname: 'Max', lastname: 'Muster' },
      { id: 20, firstname: 'Anna', lastname: 'Aebi' }
    ],
    addresses: [
      { member_id: 10, email: 'max@test.ch', source: 'member' },
      { member_id: 20, email: 'anna@test.ch', source: 'member' }
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
    toldTrainings: states.flatMap((s) =>
      s.trainings.map((t) => ({ member_id: s.member_id, ...t, told_at: '2026-11-01T10:00:00Z' }))
    ),
    toldDates: states.flatMap((s) => s.dates.map((d) => ({ member_id: s.member_id, ...d })))
  };
}

const button = () => screen.queryByRole('button', { name: 'Trainer informieren' });
/** Lets pending answers land */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(loadMailPlan).mockReset();
});

function renderBanner(props: Record<string, unknown> = {}) {
  const onopen = vi.fn();
  const result = render(NotifyBanner, {
    props: { mode: 'smtp', scope: TK, reloadKey: 1, waiting: false, version: 0, onopen, ...props }
  });
  return { ...result, onopen };
}

describe('NotifyBanner', () => {
  it('counts the trainers not told yet and opens the dialog', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [10]));
    const { onopen } = renderBanner();
    expect(
      await screen.findByText('Änderungen für 1 Trainer noch nicht mitgeteilt.')
    ).toBeInTheDocument();
    expect(loadMailPlan).toHaveBeenCalledWith(expect.anything(), TK);
    expect(screen.queryByText(/Demo:/)).not.toBeInTheDocument();
    await fireEvent.click(button()!);
    expect(onopen).toHaveBeenCalledTimes(1);
  });

  it('explains the first message when nobody was told yet', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(plan());
    renderBanner({ mode: 'demo' });
    expect(
      await screen.findByText(/noch nie aus der App über den Plan informiert \(2 Trainer\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/das Senden wird nur simuliert/)).toBeInTheDocument();
  });

  it('says so outside production, where sending is simulated', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(plan());
    renderBanner({ mode: 'test' });
    expect(await screen.findByText(/^Testumgebung:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Demo:/)).not.toBeInTheDocument();
  });

  it('shows nothing when everybody is up to date', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [10, 20]));
    renderBanner();
    await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(1));
    await settle();
    expect(button()).not.toBeInTheDocument();
  });

  it('hides itself when loading fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadMailPlan).mockResolvedValue(plan());
    const { rerender } = renderBanner();
    expect(await screen.findByText(/noch nie aus der App/)).toBeInTheDocument();

    vi.mocked(loadMailPlan).mockRejectedValue(new Error('offline'));
    await rerender({ version: 1 });
    await waitFor(() => expect(button()).not.toBeInTheDocument());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('waits for the reload of the plan before it counts', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(plan());
    const { rerender } = renderBanner({ waiting: true });
    await Promise.resolve();
    expect(loadMailPlan).not.toHaveBeenCalled();

    await rerender({ waiting: false });
    expect(await screen.findByText(/noch nie aus der App/)).toBeInTheDocument();
    expect(loadMailPlan).toHaveBeenCalledTimes(1);
  });

  it('counts again when the plan was reloaded or the dialog closed', async () => {
    vi.mocked(loadMailPlan).mockResolvedValue(plan());
    const { rerender } = renderBanner();
    expect(await screen.findByText(/noch nie aus der App/)).toBeInTheDocument();

    // The dialog told Max
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [10]));
    await rerender({ version: 1 });
    expect(await screen.findByText(/Änderungen für 1 Trainer/)).toBeInTheDocument();
    expect(loadMailPlan).toHaveBeenCalledTimes(2);

    // The plan was saved and reloaded: Anna was told too
    vi.mocked(loadMailPlan).mockResolvedValue(informed(plan(), [10, 20]));
    await rerender({ reloadKey: 2 });
    await waitFor(() => expect(button()).not.toBeInTheDocument());
    expect(loadMailPlan).toHaveBeenCalledTimes(3);
  });

  it('keeps only the answer to the latest load', async () => {
    let first: (data: MailPlanData) => void = () => {};
    vi.mocked(loadMailPlan)
      .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce(informed(plan(), [10, 20]));
    const { rerender } = renderBanner();
    await rerender({ version: 1 });
    await waitFor(() => expect(loadMailPlan).toHaveBeenCalledTimes(2));
    // The first answer comes late, from before the change
    first(plan());
    await settle();
    expect(button()).not.toBeInTheDocument();
  });
});
