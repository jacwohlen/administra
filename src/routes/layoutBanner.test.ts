import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readable } from 'svelte/store';
import Layout from './+layout.svelte';
import { DEMO_INFO_URL } from '$lib/demo';

/** The environment strip of the root layout per PUBLIC_MODE (read through a getter). */
const env = vi.hoisted(() => ({ mode: 'PROD' }));
vi.mock('$env/static/public', () => ({
  get PUBLIC_MODE() {
    return env.mode;
  },
  PUBLIC_SUPABASE_DATABASE_URL: 'http://localhost',
  PUBLIC_SUPABASE_ANON_KEY: 'anon'
}));
vi.mock('svelte-i18n', () => ({
  _: readable((key: string) => key),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));
vi.mock('$lib/supabase', () => ({
  supabaseClient: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) }
  }
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('@sentry/sveltekit', () => ({ setUser: vi.fn() }));

const children = createRawSnippet(() => ({ render: () => '<main>page content</main>' }));

function renderLayout(mode: string) {
  env.mode = mode;
  return render(Layout, { props: { data: { session: null }, children } as never });
}

afterEach(() => cleanup());

describe('root layout environment strip', () => {
  it('shows the demo notice with a link to the marketing site in DEMO', () => {
    renderLayout('DEMO');
    expect(screen.getByText('page content')).toBeInTheDocument();
    const notice = screen.getByText('demo.banner', { exact: false });
    expect(notice).toHaveClass('print:hidden');
    const link = screen.getByRole('link', { name: 'demo.learnMore' });
    expect(link).toHaveAttribute('href', DEMO_INFO_URL);
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link).not.toHaveAttribute('target');
    // Dynamic viewport height: 100vh would hide the page bottom behind phone browser bars
    expect(notice.parentElement).toHaveClass('h-dvh', 'w-full');
  });

  it('shows no strip in PROD', () => {
    const { container } = renderLayout('PROD');
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.queryByText('demo.banner', { exact: false })).not.toBeInTheDocument();
    expect(container.querySelector('.h-dvh')).toBeNull();
  });

  it('keeps the branch strip, without the demo notice, in DEV', () => {
    renderLayout('DEV');
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.queryByText('demo.banner', { exact: false })).not.toBeInTheDocument();
  });
});
