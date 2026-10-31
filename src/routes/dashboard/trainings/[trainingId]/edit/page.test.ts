import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import Page from './+page.svelte';

const update = vi.fn();
vi.mock('svelte-i18n', () => ({
  _: readable((key: string) => key),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));
vi.mock('$lib/clubConfig', () => ({ clubConfig: { sections: ['Judo', 'Aikido'] } }));
vi.mock('$lib/supabase', () => ({
  supabaseClient: {
    from: () => ({
      update: (fields: unknown) => {
        update(fields);
        return { eq: async () => ({ error: null }) };
      }
    })
  }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

afterEach(() => {
  cleanup();
  update.mockClear();
});

const training = {
  id: '2',
  title: 'Judo Jugend',
  weekday: 'Tuesday',
  dateFrom: '18:30',
  dateTo: '20:00',
  section: 'Judo',
  ageFrom: 11,
  ageTo: 15,
  mainTrainerId: 102,
  mainTrainer: { id: 102, firstname: 'Marco', lastname: 'Rossi' },
  participants: [],
  canWrite: true
};

const trainerOptions = [
  { id: 102, firstname: 'Marco', lastname: 'Rossi', participant: true },
  { id: 105, firstname: 'Lea', lastname: 'Meier', participant: false }
];

function renderAs(canPlanTrainings: boolean, stored: object = training) {
  return render(Page, {
    props: {
      data: { ...stored, canPlanTrainings, trainerOptions: canPlanTrainings ? trainerOptions : [] }
    } as never
  });
}

describe('edit training page: main trainer', () => {
  it('lets the TK pick the main trainer and saves it', async () => {
    const { container } = renderAs(true);
    const select = container.querySelector('#mainTrainer') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select).toBeEnabled();
    expect(screen.getByText('page.trainings.form.main_trainer_hint')).toBeInTheDocument();
    expect(screen.queryByText('page.trainings.form.main_trainer_tk_only')).not.toBeInTheDocument();

    const lea = [...select.options].find((o) =>
      o.textContent?.includes('Meier')
    ) as HTMLOptionElement;
    select.value = lea.value;
    await fireEvent.change(select);
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(update).toHaveBeenCalledWith({
      title: 'Judo Jugend',
      weekday: 'Tuesday',
      dateFrom: '18:30',
      dateTo: '20:00',
      section: 'Judo',
      ageFrom: 11,
      ageTo: 15,
      mainTrainerId: 105
    });
  });

  it('shows a trainer the main trainer read-only and leaves it out when saving', async () => {
    const { container } = renderAs(false);
    const field = container.querySelector('#mainTrainer') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(field).toBeDisabled();
    expect(field.value).toBe('Rossi Marco');
    expect(screen.getByText('page.trainings.form.main_trainer_tk_only')).toBeInTheDocument();
    expect(screen.queryByText('page.trainings.form.main_trainer_hint')).not.toBeInTheDocument();

    await fireEvent.input(container.querySelector('#title') as HTMLInputElement, {
      target: { value: 'Judo Jugend (ab 11)' }
    });
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    // the database refuses a main trainer from anyone but the TK; the rest saves
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({
      title: 'Judo Jugend (ab 11)',
      weekday: 'Tuesday',
      dateFrom: '18:30',
      dateTo: '20:00',
      section: 'Judo',
      ageFrom: 11,
      ageTo: 15
    });
    expect(update.mock.calls[0][0]).not.toHaveProperty('mainTrainerId');
  });

  it('shows a trainer a training without main trainer as such', () => {
    const { container } = renderAs(false, { ...training, mainTrainerId: null, mainTrainer: null });
    expect((container.querySelector('#mainTrainer') as HTMLInputElement).value).toBe(
      'page.trainings.form.no_main_trainer'
    );
  });
});
