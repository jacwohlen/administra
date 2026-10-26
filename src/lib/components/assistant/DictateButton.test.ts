import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable, writable } from 'svelte/store';

vi.mock('svelte-i18n', () => ({ _: readable((key: string) => key), locale: writable('de') }));

const DictateButton = (await import('./DictateButton.svelte')).default;

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}

afterEach(() => {
  delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('DictateButton', () => {
  it('is hidden where the browser cannot recognise speech', () => {
    render(DictateButton, { text: '', ontext: vi.fn() });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes the field text with what was dictated on and stops on a second click', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    const ontext = vi.fn();
    const onlistening = vi.fn();
    render(DictateButton, { text: 'Liste:', ontext, onlistening });
    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.start' }));
    const recognition = FakeRecognition.last!;
    expect(recognition.start).toHaveBeenCalled();
    expect(recognition.lang).toBe('de-CH');
    expect(onlistening).toHaveBeenLastCalledWith(true);

    recognition.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'Lena Müller' } } }
    });
    expect(ontext).toHaveBeenLastCalledWith('Liste: Lena Müller');

    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.stop' }));
    expect(recognition.stop).toHaveBeenCalled();
    expect(onlistening).toHaveBeenLastCalledWith(false);
    expect(await screen.findByRole('button', { name: 'assistant.dictation.start' })).toBeTruthy();
  });

  it('replaces a guess of Chrome on Android instead of adding it again', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    const ontext = vi.fn();
    render(DictateButton, { text: '', ontext });
    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.start' }));
    const guess = (i: number, transcript: string) => ({
      resultIndex: i,
      results: {
        length: i + 1,
        [i]: { isFinal: true, length: 1, 0: { transcript, confidence: 0 } }
      }
    });
    FakeRecognition.last!.onresult?.(guess(0, 'unter'));
    FakeRecognition.last!.onresult?.(guess(1, 'unter alexander'));
    expect(ontext).toHaveBeenLastCalledWith('unter alexander');
  });

  it('says when the microphone is blocked', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    render(DictateButton, { text: '', ontext: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.start' }));
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(await screen.findByRole('alert')).toHaveTextContent('assistant.dictation.errors.denied');
  });
});

describe('DictateButton iconOnly', () => {
  it('names the icon button and shows the status on a row of its own', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    render(DictateButton, { text: '', ontext: vi.fn(), iconOnly: true });
    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.start' }));
    expect(screen.getByRole('button', { name: 'assistant.dictation.stop' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByText('assistant.dictation.privacy').parentElement).toHaveClass('basis-full');
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(await screen.findByRole('alert')).toHaveTextContent('assistant.dictation.errors.denied');
  });
});
