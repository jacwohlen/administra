import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { MMember } from './types';
import ParticipantCard from './ParticipantCard.svelte';

vi.mock('svelte-i18n', () => ({
  _: readable((key: string) => key),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

afterEach(() => cleanup());

const member: MMember = {
  id: '7',
  firstname: 'Anna',
  lastname: 'Muster',
  isPresent: true,
  trainerRole: 'attendee',
  streak: []
};

async function openMenu(container: HTMLElement) {
  const menuButton = container.querySelector('.justify-self-end > button');
  await fireEvent.click(menuButton!);
}

describe('ParticipantCard', () => {
  it('lets trainers change attendance, trainer role and remove the participant', async () => {
    const { container, getByText } = render(ParticipantCard, { props: { member } });
    expect(container.querySelector<HTMLInputElement>('input.checkbox')!.disabled).toBe(false);
    await openMenu(container);
    expect(getByText('components.ParticipantCard.SetAsMainTrainer')).toBeTruthy();
    expect(getByText('components.ParticipantCard.Remove')).toBeTruthy();
  });

  it('shows attendance read-only to viewers, keeping the profile link', async () => {
    const { container, getByText, queryByText } = render(ParticipantCard, {
      props: { member, readonly: true }
    });
    const checkbox = container.querySelector<HTMLInputElement>('input.checkbox')!;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    await openMenu(container);
    expect(getByText('components.ParticipantCard.View')).toBeTruthy();
    expect(queryByText('components.ParticipantCard.SetAsMainTrainer')).toBeNull();
    expect(queryByText('components.ParticipantCard.Remove')).toBeNull();
  });
});
