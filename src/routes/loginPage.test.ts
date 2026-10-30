import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import Page from './+page.svelte';

/**
 * The login page per PUBLIC_MODE. The mocked module reads the mode through a
 * getter, so each test can pick its own without reloading the component
 * (a second copy of the Svelte runtime would break rendering).
 */
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
vi.mock('$lib/supabase', () => ({ supabaseClient: { auth: { signOut: vi.fn() } } }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));

async function renderPage(mode: string, form: unknown = null) {
  env.mode = mode;
  return render(Page, { props: { data: { session: null }, form } as never });
}

afterEach(() => cleanup());

describe('login page in DEMO mode', () => {
  it('offers one native submit button per demo role', async () => {
    const { container } = await renderPage('DEMO');
    const form = container.querySelector('form[method="POST"]') as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.getAttribute('action')).toBe('?/demo');

    const buttons = [...form.querySelectorAll('button')];
    expect(buttons.map((b) => [b.type, b.name, b.value])).toEqual([
      ['submit', 'role', 'admin'],
      ['submit', 'role', 'trainer'],
      ['submit', 'role', 'member']
    ]);
    expect(form.querySelectorAll('input')).toHaveLength(0);
    expect(screen.getByText('page.login.demo.title')).toBeInTheDocument();
    expect(screen.getByText('page.login.demo.member.title')).toBeInTheDocument();
  });

  it('hides the e-mail code, Google and password sign-in', async () => {
    const { container } = await renderPage('DEMO');
    expect(screen.queryByText('page.login.google')).not.toBeInTheDocument();
    expect(screen.queryByText('page.login.sendCode')).not.toBeInTheDocument();
    expect(screen.queryByText('page.routes.devLoginTitle')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="email"], input[type="password"]')).toBeNull();
  });

  it('shows a translated error when the sign-in failed', async () => {
    await renderPage('DEMO', { demoError: 'signInFailed' });
    expect(screen.getByRole('alert')).toHaveTextContent('page.login.demo.errorSignIn');
  });

  it('puts the error above the role buttons and focuses it', async () => {
    const { container } = await renderPage('DEMO', { demoError: 'signInFailed' });
    const alert = screen.getByRole('alert');
    const form = container.querySelector('form[action="?/demo"]') as HTMLFormElement;
    expect(alert.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(alert);
  });

  it('shows a translated error for an unknown role', async () => {
    await renderPage('DEMO', { demoError: 'unknownRole' });
    expect(screen.getByRole('alert')).toHaveTextContent('page.login.demo.errorUnknownRole');
  });

  it('shows the rate-limit message when the client was throttled', async () => {
    await renderPage('DEMO', { demoError: 'tooManyAttempts' });
    expect(screen.getByRole('alert')).toHaveTextContent('page.login.errorRateLimit');
  });
});

describe('login page in PROD mode', () => {
  it('has the e-mail code and Google sign-in but no demo or password form', async () => {
    const { container } = await renderPage('PROD');
    expect(screen.getByText('page.login.sendCode')).toBeInTheDocument();
    expect(screen.getByText('page.login.google')).toBeInTheDocument();
    expect(container.querySelector('form[action="?/demo"]')).toBeNull();
    expect(container.querySelector('button[name="role"]')).toBeNull();
    expect(screen.queryByText('page.login.demo.title')).not.toBeInTheDocument();
    expect(screen.queryByText('page.routes.devLoginTitle')).not.toBeInTheDocument();
  });
});

describe('login page in DEV mode', () => {
  it('keeps the password form and has no demo form', async () => {
    const { container } = await renderPage('DEV');
    expect(screen.getByText('page.routes.devLoginTitle')).toBeInTheDocument();
    expect(container.querySelector('form[action="?/demo"]')).toBeNull();
  });
});
