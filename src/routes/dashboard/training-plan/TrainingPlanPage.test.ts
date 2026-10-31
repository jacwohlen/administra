import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { invalidate } from '$app/navigation';
import type { TrainingPlanSession } from '$lib/models';
import type { PlanTraining } from '$lib/trainingPlanUtils';
import Page from './+page.svelte';

// The real German texts, so a broken message (ICU syntax, missing key) shows here
beforeAll(() => {
  addMessages('de', de);
  init({ fallbackLocale: 'de', initialLocale: 'de' });
  // The view switch (Skeleton's segmented control) measures itself; jsdom cannot
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock('$lib/supabase', () => ({
  supabaseClient: {
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => upsert(table, values, options)
    })
  }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidate: vi.fn(async () => {}) }));
vi.mock('$lib/toast', () => ({ toaster: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  // A year ahead: the table starts on January 1, not today
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T12:00:00'));
  localStorage.clear();
  localStorage.setItem('trainingPlan.view', 'table');
  upsert.mockReset().mockResolvedValue({ error: null });
  vi.mocked(invalidate).mockClear();
});

const monday: PlanTraining = {
  id: 27,
  title: 'Judo Kampftraining',
  weekday: 'Monday',
  dateFrom: '20:00',
  section: 'Judo'
};
const friday: PlanTraining = {
  id: 23,
  title: 'Judo Techniktraining',
  weekday: 'Friday',
  dateFrom: '20:00',
  section: 'Judo'
};
const kids: PlanTraining = {
  id: 31,
  title: 'Judo Kinder',
  weekday: 'Friday',
  dateFrom: '17:30',
  section: 'Judo'
};

function pageData(sessions: TrainingPlanSession[] = []) {
  return {
    year: 2027,
    from: '2027-01-01',
    to: '2027-01-11',
    trainings: [monday, friday, kids],
    sessions,
    breaks: [],
    events: [],
    members: [{ id: 7, firstname: 'Anna', lastname: 'Muster', trainer: true }],
    canPlanTrainings: true
  };
}

function renderPage() {
  return render(Page, { props: { data: pageData() } as never });
}

/** Monday's topic as the database has it once the table has saved it */
const ukemi: TrainingPlanSession = {
  id: 1,
  training_id: monday.id,
  date: '2027-01-04',
  trainer_id: null,
  topic: 'Ukemi',
  notes: null,
  cancelled: null,
  updated_at: '2026-10-30T12:00:00Z'
};

/** The next reload of the plan, landing only when the test says so */
function slowReload() {
  let land: () => void = () => {};
  vi.mocked(invalidate).mockImplementationOnce(
    () => new Promise<void>((resolve) => (land = resolve))
  );
  return () => land();
}

const chip = (name: string) => screen.getByRole('button', { name });
const rows = () =>
  screen.getAllByRole('group', { name: / · Judo/ }).map((g) => g.getAttribute('aria-label'));
const MO_04 = 'Mo 04.01.2027 · Judo Kampftraining';
const topicOf = (name: string) =>
  within(screen.getByRole('group', { name })).getByPlaceholderText('Thema');

describe('training plan table', () => {
  it('opens on the training kept from before and adds another to the same table', async () => {
    localStorage.setItem('trainingPlan.training', '23');
    renderPage();
    expect(screen.getByText(/mehrere Trainings anwählen/)).toBeInTheDocument();
    expect(chip('Fr · Judo Techniktraining')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Mo · Judo Kampftraining')).toHaveAttribute('aria-pressed', 'false');
    expect(rows()).toEqual([
      'Fr 01.01.2027 · Judo Techniktraining',
      'Fr 08.01.2027 · Judo Techniktraining'
    ]);

    await fireEvent.click(chip('Mo · Judo Kampftraining'));
    expect(chip('Mo · Judo Kampftraining')).toHaveAttribute('aria-pressed', 'true');
    expect(rows()).toEqual([
      'Fr 01.01.2027 · Judo Techniktraining',
      'Mo 04.01.2027 · Judo Kampftraining',
      'Fr 08.01.2027 · Judo Techniktraining',
      'Mo 11.01.2027 · Judo Kampftraining'
    ]);
    expect(localStorage.getItem('trainingPlan.trainings')).toBe('23,27');

    await fireEvent.click(chip('Fr · Judo Kinder'));
    expect(rows()).toEqual([
      'Fr 01.01.2027 · Judo Kinder',
      'Fr 01.01.2027 · Judo Techniktraining',
      'Mo 04.01.2027 · Judo Kampftraining',
      'Fr 08.01.2027 · Judo Kinder',
      'Fr 08.01.2027 · Judo Techniktraining',
      'Mo 11.01.2027 · Judo Kampftraining'
    ]);
  });

  it('keeps the last training picked', async () => {
    localStorage.setItem('trainingPlan.trainings', '27,23');
    renderPage();
    await fireEvent.click(chip('Fr · Judo Techniktraining'));
    expect(chip('Fr · Judo Techniktraining')).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('trainingPlan.trainings')).toBe('27');

    await fireEvent.click(chip('Mo · Judo Kampftraining'));
    expect(chip('Mo · Judo Kampftraining')).toHaveAttribute('aria-pressed', 'true');
    expect(rows()).toEqual([
      'Mo 04.01.2027 · Judo Kampftraining',
      'Mo 11.01.2027 · Judo Kampftraining'
    ]);
    expect(localStorage.getItem('trainingPlan.trainings')).toBe('27');
  });

  it('leaves out trainings no longer planned, and falls back to the first', () => {
    localStorage.setItem('trainingPlan.trainings', '99,31');
    localStorage.setItem('trainingPlan.training', '23');
    const { unmount } = renderPage();
    const pressed = () =>
      screen
        .getAllByRole('button', { pressed: true })
        .map((b) => b.textContent?.trim())
        .filter((t) => t?.includes('Judo'));
    expect(pressed()).toEqual(['Fr · Judo Kinder']);
    unmount();

    localStorage.setItem('trainingPlan.trainings', '99');
    renderPage();
    expect(pressed()).toEqual(['Mo · Judo Kampftraining']);
  });

  it('keeps what is typed when other trainings are picked, without a reload', async () => {
    localStorage.setItem('trainingPlan.trainings', '23');
    renderPage();
    const topic = topicOf('Fr 01.01.2027 · Judo Techniktraining');
    await fireEvent.input(topic, { target: { value: 'Ukemi' } });
    expect(upsert).not.toHaveBeenCalled();

    // The same table, only with more rows: the field and what is typed stay
    await fireEvent.click(chip('Fr · Judo Kinder'));
    expect(topicOf('Fr 01.01.2027 · Judo Techniktraining')).toBe(topic);
    expect(topic).toHaveValue('Ukemi');
    // Saved after the pause in typing, as without the click
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][1]).toMatchObject({
      training_id: friday.id,
      date: '2027-01-01',
      topic: 'Ukemi'
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('keeps a saved topic when the same row is edited right after picking a training', async () => {
    localStorage.setItem('trainingPlan.trainings', '27');
    renderPage();
    await fireEvent.input(topicOf(MO_04), { target: { value: 'Ukemi' } });
    await fireEvent.blur(topicOf(MO_04));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    await fireEvent.click(chip('Fr · Judo Techniktraining'));
    expect(topicOf(MO_04)).toHaveValue('Ukemi');
    const trainer = within(screen.getByRole('group', { name: MO_04 })).getByRole('combobox', {
      name: 'Trainer'
    });
    await fireEvent.change(trainer, { target: { value: '7' } });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(upsert.mock.calls[1][1]).toEqual({
      training_id: monday.id,
      date: '2027-01-04',
      trainer_id: 7,
      topic: 'Ukemi',
      notes: null,
      cancelled: null
    });
  });

  it('lets the rotation apply only on the plan with what the table saved', async () => {
    localStorage.setItem('trainingPlan.trainings', '27');
    const { rerender } = renderPage();
    const reloaded = slowReload();
    await fireEvent.input(topicOf(MO_04), { target: { value: 'Ukemi' } });

    // Opening the rotation saves what is typed and reloads the plan
    await fireEvent.click(chip('Rotation'));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toMatchObject({ date: '2027-01-04', topic: 'Ukemi' });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    const apply = screen.getByRole('button', { name: '2 Termine einteilen' });
    expect(apply).toBeDisabled();

    await rerender({ data: pageData([ukemi]) } as never);
    reloaded();
    await waitFor(() => expect(apply).toBeEnabled());
    await fireEvent.click(apply);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(upsert.mock.calls[1][1]).toContainEqual(
      expect.objectContaining({ training_id: monday.id, date: '2027-01-04', topic: 'Ukemi' })
    );
  });

  it('keeps a table opened again before the reload read-only until it is in', async () => {
    localStorage.setItem('trainingPlan.trainings', '27');
    const { rerender } = renderPage();
    const reloaded = slowReload();
    await fireEvent.input(topicOf(MO_04), { target: { value: 'Ukemi' } });
    await fireEvent.click(chip('Rotation'));
    await fireEvent.click(chip('Abbrechen'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));

    // It has the plan from before the save, so it would write that back
    expect(topicOf(MO_04)).toBeDisabled();
    await rerender({ data: pageData([ukemi]) } as never);
    reloaded();
    await waitFor(() => expect(topicOf(MO_04)).toBeEnabled());
    expect(topicOf(MO_04)).toHaveValue('Ukemi');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
