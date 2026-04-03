import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Labels from './Labels.svelte';

afterEach(() => cleanup());

describe('Labels component', () => {
  it('renders no labels when array is empty', () => {
    const { container } = render(Labels, { props: { labels: [] } });
    expect(container.querySelectorAll('.chip')).toHaveLength(0);
  });

  it('renders a single label', () => {
    render(Labels, { props: { labels: ['Judo'] } });
    expect(screen.getByText('Judo')).toBeInTheDocument();
  });

  it('renders two labels', () => {
    render(Labels, { props: { labels: ['Judo', 'Karate'] } });
    expect(screen.getAllByText('Judo')).toHaveLength(1);
    expect(screen.getAllByText('Karate')).toHaveLength(1);
  });

  it('shows only first 2 labels and a +N badge when more than 2', () => {
    const { container } = render(Labels, {
      props: { labels: ['Judo', 'Karate', 'Aikido', 'Boxing'] }
    });
    expect(screen.getAllByText('Judo')).toHaveLength(1);
    expect(screen.getAllByText('Karate')).toHaveLength(1);
    expect(screen.queryByText('Aikido')).not.toBeInTheDocument();
    expect(screen.queryByText('Boxing')).not.toBeInTheDocument();
    // The overflow badge contains "+2" as text content
    const chips = container.querySelectorAll('.chip');
    expect(chips).toHaveLength(3); // 2 labels + 1 overflow badge
    expect(chips[2].textContent).toContain('+2');
  });

  it('shows +1 badge when exactly 3 labels', () => {
    const { container } = render(Labels, { props: { labels: ['A', 'B', 'C'] } });
    const chips = container.querySelectorAll('.chip');
    expect(chips).toHaveLength(3);
    expect(chips[2].textContent).toContain('+1');
  });

  it('does not show overflow badge with exactly 2 labels', () => {
    const { container } = render(Labels, { props: { labels: ['A', 'B'] } });
    const chips = container.querySelectorAll('.chip');
    expect(chips).toHaveLength(2);
  });
});
