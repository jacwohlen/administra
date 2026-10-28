import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const status = vi.hoisted(() => ({ configured: false }));
vi.mock('$lib/assistant/client', () => ({
  loadAssistantStatus: () => Promise.resolve({ configured: status.configured, remaining: null })
}));

const CreateButton = (await import('./CreateButton.svelte')).default;

describe('CreateButton', () => {
  it('is only the create button while the assistant is not set up', async () => {
    status.configured = false;
    render(CreateButton, {
      label: 'Event erstellen',
      href: '/dashboard/events/new',
      assistantLabel: 'Termine einlesen',
      onassistant: vi.fn()
    });
    expect(screen.getByRole('link', { name: 'Event erstellen' })).toHaveAttribute(
      'href',
      '/dashboard/events/new'
    );
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Termine einlesen' })).toBeNull();
  });

  it('attaches the wand when the assistant is set up', async () => {
    status.configured = true;
    const onassistant = vi.fn();
    const onclick = vi.fn();
    render(CreateButton, {
      label: 'Prüfung erfassen',
      onclick,
      assistantLabel: 'Judo-Pass einlesen',
      onassistant
    });
    const wand = await screen.findByRole('button', { name: 'Judo-Pass einlesen' });
    await fireEvent.click(wand);
    expect(onassistant).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Prüfung erfassen' }));
    expect(onclick).toHaveBeenCalled();
  });

  it('leaves the wand out where the assistant cannot work', async () => {
    status.configured = true;
    render(CreateButton, {
      label: 'Prüfung erfassen',
      onclick: vi.fn(),
      assistant: false,
      assistantLabel: 'Judo-Pass einlesen',
      onassistant: vi.fn()
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Judo-Pass einlesen' })).toBeNull();
  });
});
