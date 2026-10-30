import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import de from '$lib/i18n/locales/de.json';
import { toaster } from '$lib/toast';
import CalendarFeedDialog from './CalendarFeedDialog.svelte';

// The real German texts, so a broken message (ICU syntax, missing key) shows here
beforeAll(() => {
  addMessages('de', de);
  init({ fallbackLocale: 'de', initialLocale: 'de' });
});

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('$lib/supabase', () => ({ supabaseClient: { rpc } }));
vi.mock('$lib/toast', () => ({ toaster: { error: vi.fn(), success: vi.fn() } }));

const TOKEN = 'a'.repeat(64);
const RENEWED = 'b'.repeat(64);

/** The two RPCs the dialog calls, as the database answers them */
function answer(memberIds: number[], token: string | null = TOKEN) {
  rpc.mockImplementation(async (name: string, args?: { p_renew?: boolean }) => {
    if (name === 'my_member_ids') return { data: memberIds, error: null };
    if (name === 'calendar_feed_token') {
      if (token == null) return { data: null, error: { code: '42501', message: 'not staff' } };
      return { data: args?.p_renew ? RENEWED : token, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
}

const feedUrl = (token: string, feed: string) =>
  `${window.location.origin}/api/calendar/${token}/${feed}.ics`;
const webcal = (url: string) => url.replace(/^https?:/, 'webcal:');

afterEach(() => cleanup());
beforeEach(() => {
  rpc.mockReset();
  vi.mocked(toaster.success).mockClear();
  vi.mocked(toaster.error).mockClear();
});

function renderDialog() {
  const onclose = vi.fn();
  render(CalendarFeedDialog, { props: { onclose } });
  return { onclose };
}

describe('CalendarFeedDialog', () => {
  it('shows both links in the app language, with calendar app and Google links', async () => {
    answer([12]);
    renderDialog();
    const mine = await screen.findByRole('textbox', { name: 'Link «Meine Trainings»' });
    const all = screen.getByRole('textbox', { name: 'Link «Alle Trainings»' });
    expect(mine).toHaveValue(feedUrl(TOKEN, 'meine'));
    expect(all).toHaveValue(feedUrl(TOKEN, 'alle'));
    expect(rpc).toHaveBeenCalledWith('calendar_feed_token');
    expect(rpc).toHaveBeenCalledWith('my_member_ids');

    const apps = screen.getAllByRole('link', { name: /^Kalender-App/ });
    expect(apps.map((a) => a.getAttribute('href'))).toEqual([
      webcal(feedUrl(TOKEN, 'meine')),
      webcal(feedUrl(TOKEN, 'alle'))
    ]);
    // Each control says its feed to screen readers
    expect(apps[1]).toHaveAccessibleName('Kalender-App: Alle Trainings');
    const google = screen.getAllByRole('link', { name: /^Google Kalender/ });
    expect(google.map((a) => a.getAttribute('href'))).toEqual([
      'https://calendar.google.com/calendar/render?cid=' +
        encodeURIComponent(webcal(feedUrl(TOKEN, 'meine'))),
      'https://calendar.google.com/calendar/render?cid=' +
        encodeURIComponent(webcal(feedUrl(TOKEN, 'alle')))
    ]);
    for (const a of google) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.queryByText(/mit keinem Mitglied verknüpft/)).not.toBeInTheDocument();
  });

  it('copies a link to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    answer([12]);
    renderDialog();
    await screen.findByRole('textbox', { name: 'Link «Alle Trainings»' });
    await fireEvent.click(screen.getByRole('button', { name: 'Kopieren: Alle Trainings' }));
    await waitFor(() => expect(toaster.success).toHaveBeenCalledWith({ title: 'Link kopiert' }));
    expect(writeText).toHaveBeenCalledWith(feedUrl(TOKEN, 'alle'));
  });

  it('offers no own trainings to an account without a member', async () => {
    answer([]);
    renderDialog();
    await screen.findByRole('textbox', { name: 'Link «Alle Trainings»' });
    expect(screen.getByText(/mit keinem Mitglied verknüpft/)).toHaveTextContent('«Benutzer»');
    expect(
      screen.queryByRole('textbox', { name: 'Link «Meine Trainings»' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Kalender-App/ })).toHaveLength(1);
  });

  it('renews the link only after confirming', async () => {
    answer([12]);
    renderDialog();
    await screen.findByRole('textbox', { name: 'Link «Meine Trainings»' });
    await fireEvent.click(screen.getByRole('button', { name: 'Link erneuern' }));
    const dialog = screen.getByText('Link erneuern?').closest('.modal-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('die alten funktionieren nicht mehr');
    expect(rpc).not.toHaveBeenCalledWith('calendar_feed_token', { p_renew: true });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Link erneuern' }));
    expect(rpc).toHaveBeenCalledWith('calendar_feed_token', { p_renew: true });
    await waitFor(() =>
      expect(toaster.success).toHaveBeenCalledWith({ title: 'Neue Links erstellt' })
    );
    expect(screen.getByRole('textbox', { name: 'Link «Meine Trainings»' })).toHaveValue(
      feedUrl(RENEWED, 'meine')
    );
    expect(screen.queryByText('Link erneuern?')).not.toBeInTheDocument();
  });

  it('keeps the link when the renewal is cancelled', async () => {
    answer([12]);
    renderDialog();
    await screen.findByRole('textbox', { name: 'Link «Meine Trainings»' });
    await fireEvent.click(screen.getByRole('button', { name: 'Link erneuern' }));
    const dialog = screen.getByText('Link erneuern?').closest('.modal-dialog') as HTMLElement;
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByText('Link erneuern?')).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'Link «Meine Trainings»' })).toHaveValue(
      feedUrl(TOKEN, 'meine')
    );
  });

  it('shows an error and no link when the token cannot be loaded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer([12], null);
    renderDialog();
    expect(
      await screen.findByText('Die Kalender-Links konnten nicht geladen werden.')
    ).toBeInTheDocument();
    expect(toaster.error).toHaveBeenCalledWith({
      title: 'Die Kalender-Links konnten nicht geladen werden.'
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link erneuern' })).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('closes with the close button and Escape', async () => {
    answer([12]);
    const { onclose } = renderDialog();
    await screen.findByRole('textbox', { name: 'Link «Meine Trainings»' });
    await fireEvent.click(screen.getByRole('button', { name: 'Schliessen' }));
    expect(onclose).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
