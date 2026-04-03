import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import ParticipantFrequency from './ParticipantFrequency.svelte';

// Mock svelte-i18n
vi.mock('svelte-i18n', () => {
  const mockT = readable((key: string) => key);
  return {
    _: mockT,
    locale: readable('en'),
    init: vi.fn(),
    register: vi.fn(),
    getLocaleFromNavigator: vi.fn()
  };
});

afterEach(() => cleanup());

describe('ParticipantFrequency component', () => {
  it('renders nothing when streak is empty', () => {
    const { container } = render(ParticipantFrequency, { props: { streak: [] } });
    expect(container.querySelector('.flex')).not.toBeInTheDocument();
  });

  it('renders dots for each streak entry', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false, true, true] }
    });
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(4);
  });

  it('renders filled dots for attended sessions', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false] }
    });
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots[0]).toHaveClass('bg-primary-500');
    expect(dots[1]).not.toHaveClass('bg-primary-500');
  });

  it('shows upward trend arrow when recent attendance is higher', () => {
    // First half: [false, false], second half: [true, true]
    const { container } = render(ParticipantFrequency, {
      props: { streak: [false, false, true, true] }
    });
    expect(container.textContent).toContain('\u2197');
  });

  it('shows downward trend arrow when recent attendance is lower', () => {
    // First half: [true, true], second half: [false, false]
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, true, false, false] }
    });
    expect(container.textContent).toContain('\u2198');
  });

  it('shows stable indicator when attendance is equal', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false, true, false] }
    });
    expect(container.textContent).toContain('\u00B7');
  });

  it('includes attendance count in tooltip', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, true, false, true] }
    });
    const wrapper = container.querySelector('[title]');
    expect(wrapper?.getAttribute('title')).toContain('3/4');
  });
});
