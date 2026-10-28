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

function renderWith(eventLink: object | null, lockedFields: string[], stored: object = event) {
  return render(Page, {
    props: { data: { event: stored, eventLink, lockedFields, canWrite: true } } as never
  });
}

const webling = { connection: 'webling', url: null };
// lockedEventFields() for Webling's policy from phase 4: the description is the app's
const weblingLocked = PROVIDER_EVENT_FIELDS.filter((field) => field !== 'description');

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
      'dateTo',
      'allDay',
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
    expect(container.querySelector('#dateTo')).toBeEnabled();
    expect(container.querySelector('#allDay')).toBeEnabled();
    await fireEvent.input(container.querySelector('#dateTo') as HTMLInputElement, {
      target: { value: '2026-11-22' }
    });
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(update).toHaveBeenCalledWith({
      title: 'Kurs',
      description: 'https://club.webling.ch/portal#/calendar/event/61001',
      date: '2026-11-20',
      date_to: '2026-11-22',
      all_day: false,
      timeFrom: '18:30',
      timeTo: '20:00',
      location: 'Dojo',
      section: 'Judo',
      maxParticipants: 20,
      registrationDeadline: '2026-11-10'
    });
  });

  it("leaves a Webling event's description to the app from phase 4, dates and all day locked", async () => {
    const camp = {
      ...event,
      description: null,
      date_to: '2026-11-22',
      all_day: true,
      timeFrom: null,
      timeTo: null
    };
    const { container } = renderWith(webling, weblingLocked, camp);
    for (const id of ['title', 'date', 'dateTo', 'allDay', 'section', 'location']) {
      expect(container.querySelector(`#${id}`)).toBeDisabled();
    }
    expect((container.querySelector('#dateTo') as HTMLInputElement).value).toBe('2026-11-22');
    expect((container.querySelector('#allDay') as HTMLInputElement).checked).toBe(true);
    // all day: no times shown
    expect(container.querySelector('#timeFrom')).toBeNull();
    const description = container.querySelector('#description') as HTMLTextAreaElement;
    expect(description).toBeEnabled();

    await fireEvent.input(description, { target: { value: 'Mit Übernachtung' } });
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(update).toHaveBeenCalledWith({
      description: 'Mit Übernachtung',
      registrationDeadline: '2026-11-10'
    });
  });

  it('refuses a start moved onto a last day the provider keeps', async () => {
    const camp = { ...event, date_to: '2026-11-22' };
    const { container } = renderWith(webling, ['date_to'], camp);
    expect(container.querySelector('#date')).toBeEnabled();
    expect(container.querySelector('#dateTo')).toBeDisabled();
    await fireEvent.input(container.querySelector('#date') as HTMLInputElement, {
      target: { value: '2026-11-22' }
    });
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText('page.events.validation.date_to')).toBeInTheDocument();

    await fireEvent.input(container.querySelector('#date') as HTMLInputElement, {
      target: { value: '2026-11-21' }
    });
    await fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    // the last day is not sent: the database keeps it
    expect(update).toHaveBeenCalledWith(
      expect.not.objectContaining({ date_to: expect.anything() })
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-21' }));
  });
});
