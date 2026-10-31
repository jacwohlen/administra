import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import Page from './+page.svelte';

const insert = vi.fn();
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
      insert: (fields: unknown) => {
        insert(fields);
        return { select: () => ({ single: async () => ({ data: { id: 9 }, error: null }) }) };
      }
    })
  }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

afterEach(() => {
  cleanup();
  insert.mockClear();
});

describe('new training page', () => {
  it('creates a training without main trainer, which only the TK sets afterwards', async () => {
    const { container } = render(Page);
    expect(container.querySelector('#mainTrainer')).toBeNull();

    const set = async (id: string, value: string, event: 'input' | 'change' = 'input') => {
      const el = container.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
      el.value = value;
      await fireEvent[event](el);
    };
    await set('title', 'Judo Jugend');
    await set('weekday', 'Tuesday', 'change');
    await set('section', 'Judo', 'change');
    await set('dateFrom', '18:30');
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    // the database refuses a main trainer on insert from anyone but the TK
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toEqual({
      title: 'Judo Jugend',
      weekday: 'Tuesday',
      dateFrom: '18:30',
      dateTo: null,
      section: 'Judo',
      ageFrom: null,
      ageTo: null
    });
    expect(insert.mock.calls[0][0]).not.toHaveProperty('mainTrainerId');
  });
});
