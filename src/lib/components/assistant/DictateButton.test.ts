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
    render(DictateButton, { ontext: vi.fn() });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes finished phrases on and stops on a second click', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    const ontext = vi.fn();
    render(DictateButton, { ontext });
    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.start' }));
    const recognition = FakeRecognition.last!;
    expect(recognition.start).toHaveBeenCalled();
    expect(recognition.lang).toBe('de-CH');

    recognition.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'Lena Müller' } } }
    });
    expect(ontext).toHaveBeenCalledWith('Lena Müller');

    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.stop' }));
    expect(recognition.stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'assistant.dictation.start' })).toBeTruthy();
  });

  it('says when the microphone is blocked', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    render(DictateButton, { ontext: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'assistant.dictation.start' }));
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(await screen.findByRole('alert')).toHaveTextContent('assistant.dictation.errors.denied');
  });
});
