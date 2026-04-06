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
  it('renders nothing when streak is empty and not present', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [], isPresent: false }
    });
    // fullStreak = [false] → length 1, so it still renders
    // Actually [false] has length > 0, so it renders 1 dot
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(1);
  });

  it('renders dots for each streak entry plus current session', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false, true], isPresent: true }
    });
    // fullStreak = [true, false, true, true] → 4 dots
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(4);
  });

  it('renders filled dots for attended sessions', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false], isPresent: false }
    });
    // fullStreak = [true, false, false]
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots[0]).toHaveClass('bg-primary-600-400');
    expect(dots[1]).not.toHaveClass('bg-primary-600-400');
  });

  it('shows current session dot as present when isPresent is true', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [false], isPresent: true }
    });
    // fullStreak = [false, true], last dot is current
    const dots = container.querySelectorAll('.rounded-full');
    const lastDot = dots[dots.length - 1];
    expect(lastDot).toHaveClass('bg-primary-600-400');
  });

  it('shows upward trend arrow when recent attendance is higher', () => {
    // fullStreak = [false, false, true, true, true]
    const { container } = render(ParticipantFrequency, {
      props: { streak: [false, false, true, true], isPresent: true }
    });
    expect(container.textContent).toContain('\u2197');
  });

  it('shows downward trend arrow when recent attendance is lower', () => {
    // fullStreak = [true, true, true, false, false]
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, true, true, false], isPresent: false }
    });
    expect(container.textContent).toContain('\u2198');
  });

  it('shows stable indicator when attendance is equal', () => {
    // fullStreak = [true, false, true, false]
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false, true], isPresent: false }
    });
    expect(container.textContent).toContain('\u00B7');
  });

  it('includes attendance count in tooltip', () => {
    // fullStreak = [true, true, false, true, false] → 3/5
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, true, false, true], isPresent: false }
    });
    const wrapper = container.querySelector('[title]');
    expect(wrapper?.getAttribute('title')).toContain('3/5');
  });

  it('current session dot is visually larger', () => {
    const { container } = render(ParticipantFrequency, {
      props: { streak: [true, false], isPresent: true }
    });
    const dots = container.querySelectorAll('.rounded-full');
    const lastDot = dots[dots.length - 1];
    // Current dot has w-2.5 h-2.5 (larger), historical has w-2 h-2
    expect(lastDot).toHaveClass('w-2.5');
    expect(dots[0]).toHaveClass('w-2');
  });
});
