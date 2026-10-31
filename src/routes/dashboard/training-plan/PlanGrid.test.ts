import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { toaster } from '$lib/toast';
import type { TrainingPlanSession } from '$lib/models';
import { buildPlan, type PlanTraining } from '$lib/trainingPlanUtils';
import PlanGrid from './PlanGrid.svelte';

// The real German texts, so a broken message (ICU syntax, missing key) shows here
beforeAll(() => {
  addMessages('de', de);
  init({ fallbackLocale: 'de', initialLocale: 'de' });
});

// What the table writes to training_plan_sessions, answered as the database does
const { upsert, remove } = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn() }));
vi.mock('$lib/supabase', () => ({
  supabaseClient: {
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => upsert(table, values, options),
      delete: () => ({
        eq: (a: string, x: unknown) => ({
          eq: (b: string, y: unknown) => remove(table, { [a]: x, [b]: y })
        })
      })
    })
  }
}));
vi.mock('$lib/toast', () => ({ toaster: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => cleanup());
beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  vi.mocked(toaster.success).mockClear();
  vi.mocked(toaster.error).mockClear();
});

const monday: PlanTraining = {
  id: 27,
  title: 'Judo Kampftraining',
  weekday: 'Monday',
  dateFrom: '20:00',
  section: 'Judo',
  mainTrainerId: 7
};
// Two trainings on Friday: the kids first, by start time
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
const members = [
  { id: 7, firstname: 'Anna', lastname: 'Muster', trainer: true },
  { id: 8, firstname: 'Beni', lastname: 'Beispiel', trainer: true }
];

function session(p: Partial<TrainingPlanSession>): TrainingPlanSession {
  return {
    id: 1,
    training_id: friday.id,
    date: '2026-11-06',
    trainer_id: null,
    topic: null,
    notes: null,
    cancelled: null,
    updated_at: '2026-10-30T12:00:00Z',
    ...p
  };
}

const planned = [session({ trainer_id: 8, topic: 'Uchi-mata' })];

/** The rows the page passes for the trainings picked */
function plan(trainings: PlanTraining[], sessions = planned) {
  return buildPlan(trainings, sessions, [], [], '2026-11-02', '2026-11-13');
}

/** The TK plans every training */
const all = [monday.id, friday.id, kids.id];

function renderGrid(rows = plan([monday, friday, kids]), plannable = all) {
  const onchanged = vi.fn();
  const result = render(PlanGrid, {
    props: { rows, members, topics: [], plannable, onchanged }
  });
  return { ...result, onchanged };
}

/** A row of the table, named by weekday, date and training */
const row = (name: string) => screen.getByRole('group', { name });
const topicOf = (name: string) => within(row(name)).getByPlaceholderText('Thema');

const MO_02 = 'Mo 02.11.2026 · Judo Kampftraining';
const KIDS_06 = 'Fr 06.11.2026 · Judo Kinder';
const ADULTS_06 = 'Fr 06.11.2026 · Judo Techniktraining';
const ADULTS_13 = 'Fr 13.11.2026 · Judo Techniktraining';

/** Per row: its fields (trainer, topic, note, «Fällt aus») all editable, or all read-only */
function editableRows() {
  return Object.fromEntries(
    screen.getAllByRole('group', { name: / · Judo/ }).map((g) => {
      const fields = [...g.querySelectorAll<HTMLInputElement>('input, select')];
      const enabled = fields.filter((f) => !f.disabled).length;
      expect(fields).toHaveLength(5);
      expect([0, 5]).toContain(enabled);
      return [g.getAttribute('aria-label'), enabled === 5];
    })
  );
}
const READ_ONLY = 'Nur lesen: dieses Training plant die TK oder sein Haupttrainer';

describe('PlanGrid', () => {
  it('interleaves the dates of several trainings, each row naming its training', () => {
    renderGrid();
    expect(
      screen.getAllByRole('group', { name: / · Judo/ }).map((g) => g.getAttribute('aria-label'))
    ).toEqual([
      MO_02,
      KIDS_06,
      ADULTS_06,
      'Mo 09.11.2026 · Judo Kampftraining',
      'Fr 13.11.2026 · Judo Kinder',
      'Fr 13.11.2026 · Judo Techniktraining'
    ]);
    expect(screen.getAllByRole('heading', { name: 'November 2026' })).toHaveLength(1);
    // Next to the weekday, and on phones above the fields
    expect(within(row(KIDS_06)).getAllByTitle('Judo Kinder')).toHaveLength(2);
    expect(within(row(KIDS_06)).getByText(/· Judo Kinder/)).toBeInTheDocument();

    // Each row holds its own training's plan
    expect(topicOf(ADULTS_06)).toHaveValue('Uchi-mata');
    expect(within(row(ADULTS_06)).getByRole('combobox', { name: 'Trainer' })).toHaveDisplayValue(
      'Beni Beispiel'
    );
    expect(topicOf(KIDS_06)).toHaveValue('');
    // Without a trainer planned: the training's main trainer, else open
    expect(within(row(MO_02)).getByRole('combobox', { name: 'Trainer' })).toHaveDisplayValue(
      'Anna Muster (Haupttrainer)'
    );
    expect(within(row(KIDS_06)).getByRole('combobox', { name: 'Trainer' })).toHaveDisplayValue(
      'Trainer offen'
    );
  });

  it('shows one training as before, without naming it on every row', () => {
    renderGrid(plan([monday]));
    expect(screen.getAllByRole('group', { name: / · Judo/ })).toHaveLength(2);
    expect(screen.queryByTitle('Judo Kampftraining')).not.toBeInTheDocument();
    expect(screen.queryByText(/· Judo Kampftraining/)).not.toBeInTheDocument();
  });

  it('saves a topic for its own training and date only', async () => {
    renderGrid();
    const topic = topicOf(KIDS_06);
    await fireEvent.input(topic, { target: { value: 'Ukemi' } });
    await fireEvent.blur(topic);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert).toHaveBeenCalledWith(
      'training_plan_sessions',
      {
        training_id: kids.id,
        date: '2026-11-06',
        trainer_id: null,
        topic: 'Ukemi',
        notes: null,
        cancelled: null
      },
      { onConflict: 'training_id,date' }
    );
    expect(topicOf(ADULTS_06)).toHaveValue('Uchi-mata');
    expect(remove).not.toHaveBeenCalled();
  });

  it('drops one of two trainings on the same date, not the other', async () => {
    renderGrid();
    const off = (name: string) =>
      within(row(name)).getAllByRole('checkbox', { name: 'Fällt aus' }) as HTMLInputElement[];
    await fireEvent.click(off(KIDS_06)[1]);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][1]).toEqual({
      training_id: kids.id,
      date: '2026-11-06',
      trainer_id: null,
      topic: null,
      notes: null,
      cancelled: true
    });
    expect(off(KIDS_06).map((c) => c.checked)).toEqual([true, true]);
    expect(off(ADULTS_06).map((c) => c.checked)).toEqual([false, false]);

    // Taking it back empties the kids' session: it is deleted, the adults' stays
    await fireEvent.click(off(KIDS_06)[1]);
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith('training_plan_sessions', {
      training_id: kids.id,
      date: '2026-11-06'
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(off(ADULTS_06).map((c) => c.checked)).toEqual([false, false]);
  });

  it('fills the rows below across trainings when a column is pasted', async () => {
    renderGrid();
    await fireEvent.paste(topicOf(MO_02), {
      clipboardData: { getData: () => 'Ukemi\nO-goshi\nSeoi-nage\n' }
    });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(3));
    expect(
      upsert.mock.calls.map(([, v]) => [v.training_id, v.date, v.topic, v.trainer_id])
    ).toEqual([
      [monday.id, '2026-11-02', 'Ukemi', null],
      [kids.id, '2026-11-06', 'O-goshi', null],
      [friday.id, '2026-11-06', 'Seoi-nage', 8]
    ]);
    expect(topicOf('Mo 09.11.2026 · Judo Kampftraining')).toHaveValue('');
    expect(toaster.success).toHaveBeenCalledWith({ title: '3 Zeilen eingefügt' });
  });

  it('saves what is still typed when the table closes, and hands over the saves once', async () => {
    let land: (value: { error: null }) => void = () => {};
    upsert.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const { unmount, onchanged } = renderGrid();
    const notes = within(row('Mo 09.11.2026 · Judo Kampftraining')).getByPlaceholderText(
      'Bemerkung'
    );
    await fireEvent.input(notes, { target: { value: 'Gürtelprüfung' } });
    expect(upsert).not.toHaveBeenCalled();

    unmount();
    expect(upsert).toHaveBeenCalledWith(
      'training_plan_sessions',
      expect.objectContaining({
        training_id: monday.id,
        date: '2026-11-09',
        notes: 'Gürtelprüfung'
      }),
      { onConflict: 'training_id,date' }
    );
    // Right away, so the page knows a reload is coming; it reloads once the save has landed
    expect(onchanged).toHaveBeenCalledTimes(1);
    let landed = false;
    onchanged.mock.calls[0][0].then(() => (landed = true));
    await Promise.resolve();
    expect(landed).toBe(false);
    land({ error: null });
    await waitFor(() => expect(landed).toBe(true));
  });

  it('does not reload the plan when nothing was edited', async () => {
    const { unmount, onchanged } = renderGrid();
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onchanged).not.toHaveBeenCalled();
  });

  it('waits with the cells until the plan is reloaded', async () => {
    const { rerender } = render(PlanGrid, {
      props: {
        rows: plan([kids]),
        members,
        topics: [],
        plannable: all,
        waiting: true,
        onchanged() {}
      }
    });
    expect(topicOf(KIDS_06)).toBeDisabled();
    expect(within(row(KIDS_06)).getByRole('combobox', { name: 'Trainer' })).toBeDisabled();
    // The typing hint stays, so the table does not jump when the reload is in
    expect(screen.getByText(/Direkt eintippen/)).toBeInTheDocument();

    await rerender({
      rows: plan([kids], [session({ training_id: kids.id, topic: 'Ukemi' })]),
      waiting: false
    });
    expect(topicOf(KIDS_06)).toBeEnabled();
    expect(topicOf(KIDS_06)).toHaveValue('Ukemi');
  });

  it('takes the reloaded plan into rows not edited here', async () => {
    // The previous table saved Monday's topic, the reload comes after this one opened
    const { rerender } = renderGrid();
    const topic = topicOf(KIDS_06);
    await fireEvent.input(topic, { target: { value: 'Ukemi' } });
    await fireEvent.blur(topic);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    await rerender({
      rows: plan(
        [monday, friday, kids],
        [
          ...planned,
          session({ id: 2, training_id: monday.id, date: '2026-11-02', topic: 'Kata' }),
          session({ id: 3, training_id: kids.id, topic: 'Older' })
        ]
      )
    });
    expect(topicOf(MO_02)).toHaveValue('Kata');
    // What was typed here stays
    expect(topicOf(KIDS_06)).toHaveValue('Ukemi');
    expect(topicOf(ADULTS_06)).toHaveValue('Uchi-mata');
  });

  it('lets a main trainer edit only the rows of their own training', async () => {
    renderGrid(plan([monday, friday, kids]), [friday.id]);
    expect(editableRows()).toEqual({
      [MO_02]: false,
      [KIDS_06]: false,
      [ADULTS_06]: true,
      'Mo 09.11.2026 · Judo Kampftraining': false,
      'Fr 13.11.2026 · Judo Kinder': false,
      [ADULTS_13]: true
    });
    // Trainer and «Fällt aus» too, and the others' rows say why
    expect(within(row(MO_02)).getByRole('combobox', { name: 'Trainer' })).toBeDisabled();
    for (const box of within(row(KIDS_06)).getAllByRole('checkbox', { name: 'Fällt aus' })) {
      expect(box).toBeDisabled();
    }
    expect(within(row(ADULTS_06)).getByRole('combobox', { name: 'Trainer' })).toBeEnabled();
    expect(within(row(KIDS_06)).getAllByTitle(READ_ONLY)).not.toHaveLength(0);
    expect(within(row(ADULTS_06)).queryByTitle(READ_ONLY)).not.toBeInTheDocument();
    expect(screen.getByText(/Direkt eintippen/)).toBeInTheDocument();

    // Enter jumps over the others' rows to their next date
    topicOf(ADULTS_06).focus();
    await fireEvent.keyDown(topicOf(ADULTS_06), { key: 'Enter' });
    expect(topicOf(ADULTS_13)).toHaveFocus();
    await fireEvent.keyDown(topicOf(ADULTS_13), { key: 'ArrowUp' });
    expect(topicOf(ADULTS_06)).toHaveFocus();

    await fireEvent.input(topicOf(ADULTS_06), { target: { value: 'Ukemi' } });
    await fireEvent.blur(topicOf(ADULTS_06));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][1]).toMatchObject({ training_id: friday.id, topic: 'Ukemi' });
  });

  it("pastes a column into a main trainer's own rows only", async () => {
    renderGrid(plan([monday, friday, kids]), [friday.id]);
    await fireEvent.paste(topicOf(ADULTS_06), {
      clipboardData: { getData: () => 'Ukemi\nO-goshi\nSeoi-nage\n' }
    });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(upsert.mock.calls.map(([, v]) => [v.training_id, v.date, v.topic])).toEqual([
      [friday.id, '2026-11-06', 'Ukemi'],
      [friday.id, '2026-11-13', 'O-goshi']
    ]);
    expect(topicOf('Fr 13.11.2026 · Judo Kinder')).toHaveValue('');
    expect(toaster.success).toHaveBeenCalledWith({ title: '2 Zeilen eingefügt' });
  });

  it('shows the TK every row editable, without locks', () => {
    renderGrid();
    expect(Object.values(editableRows()).every(Boolean)).toBe(true);
    expect(screen.queryAllByTitle(READ_ONLY)).toHaveLength(0);
  });

  it('shows viewers the table read-only, without hint or locks', () => {
    renderGrid(plan([monday, friday, kids]), []);
    expect(Object.values(editableRows()).some(Boolean)).toBe(false);
    expect(screen.queryByText(/Direkt eintippen/)).not.toBeInTheDocument();
    expect(screen.queryAllByTitle(READ_ONLY)).toHaveLength(0);
  });

  it('keeps the hint off when only other trainings are picked', () => {
    renderGrid(plan([monday, kids]), [friday.id]);
    expect(Object.values(editableRows()).some(Boolean)).toBe(false);
    expect(screen.queryByText(/Direkt eintippen/)).not.toBeInTheDocument();
    expect(within(row(MO_02)).getAllByTitle(READ_ONLY)).not.toHaveLength(0);
  });
});
