import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import Page from './+page.svelte';
import { PROVIDER_EVENT_FIELDS } from '$lib/eventLinks';

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

const event = {
  id: 61001,
  title: 'Kurs',
  description: 'https://club.webling.ch/portal#/calendar/event/61001',
  date: '2026-11-20',
  timeFrom: '18:30',
  timeTo: '20:00',
  location: 'Dojo',
  section: 'Judo',
  maxParticipants: 20,
  registrationDeadline: '2026-11-10'
};

function renderWith(eventLink: object | null, lockedFields: string[]) {
  return render(Page, {
    props: { data: { event, eventLink, lockedFields, canWrite: true } } as never
  });
}

describe('edit event page', () => {
  it('locks the fields of a linked event its provider owns, not the registration deadline', async () => {
    const { container } = renderWith({ connection: 'webling', url: null }, [
      ...PROVIDER_EVENT_FIELDS
    ]);
    expect(screen.getByText('page.events.lockedByProvider')).toBeInTheDocument();
    for (const id of [
      'title',
      'description',
      'date',
      'section',
      'timeFrom',
      'timeTo',
      'location'
    ]) {
      expect(container.querySelector(`#${id}`)).toBeDisabled();
    }
    expect(container.querySelector('#maxParticipants')).toBeDisabled();
    const deadline = container.querySelector('#registrationDeadline') as HTMLInputElement;
    expect(deadline).toBeEnabled();

    await fireEvent.input(deadline, { target: { value: '2026-11-18' } });
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    // only what the app owns is sent: the database would refuse the rest
    expect(update).toHaveBeenCalledWith({ registrationDeadline: '2026-11-18' });
  });

  it('sends every field of an event of the app', async () => {
    const { container } = renderWith(null, []);
    expect(screen.queryByText('page.events.lockedByProvider')).not.toBeInTheDocument();
    expect(container.querySelector('#title')).toBeEnabled();
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Kurs',
        location: 'Dojo',
        registrationDeadline: '2026-11-10'
      })
    );
  });
});
