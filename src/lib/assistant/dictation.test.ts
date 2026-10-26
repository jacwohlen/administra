import { describe, expect, it } from 'vitest';
import {
  appendDictation,
  dictationError,
  dictationLang,
  dictationSession,
  speechRecognition,
  type SpeechResult,
  type SpeechResultEvent
} from './dictation';

function result(transcript: string, isFinal: boolean, confidence?: number): SpeechResult {
  return { isFinal, length: 1, 0: { transcript, confidence } };
}

/** One event per final, at growing indexes, as Blink and WebKit send them. */
function session(...finals: [transcript: string, confidence?: number][]): string[] {
  const read = dictationSession();
  return finals.map(([transcript, confidence], i) => {
    const event: SpeechResultEvent = {
      resultIndex: i,
      results: { length: i + 1, [i]: result(transcript, true, confidence) }
    };
    return read(event).text;
  });
}

describe('dictation', () => {
  it('finds the browser recognition, also with the webkit prefix', () => {
    class Recognition {}
    expect(speechRecognition({})).toBeNull();
    expect(speechRecognition({ webkitSpeechRecognition: Recognition })).toBe(Recognition);
    expect(speechRecognition({ SpeechRecognition: Recognition })).toBe(Recognition);
  });

  it('recognises Swiss Standard German or English', () => {
    expect(dictationLang('de')).toBe('de-CH');
    expect(dictationLang('de-CH')).toBe('de-CH');
    expect(dictationLang('en-US')).toBe('en-GB');
    expect(dictationLang(null)).toBe('de-CH');
  });

  it('splits finished from pending text, from the event index on', () => {
    const read = dictationSession();
    const event = {
      resultIndex: 1,
      results: {
        length: 3,
        0: result('schon verarbeitet', true),
        1: result('Anwesend Lena Müller ', true, 0.9),
        2: result('Tim We', false)
      }
    };
    expect(read(event)).toEqual({ text: 'Anwesend Lena Müller', interim: 'Tim We' });
  });

  it('joins separate phrases as they come, also the same word twice (desktop, Safari)', () => {
    expect(session(['Anwesend Lena Müller', 0.9], [' Tim Weber', 0.8]).at(-1)).toBe(
      'Anwesend Lena Müller Tim Weber'
    );
    expect(session(['Lena', 0.9], [' Lena', 0.9]).at(-1)).toBe('Lena Lena');
    expect(session(['Ja.'], [' Ja.']).at(-1)).toBe('Ja. Ja.');
  });

  it('replaces the guesses Chrome on Android sends as final results', () => {
    const guesses = [
      'unter',
      'unter',
      'unter alexander',
      'unter alexander',
      'unter alexander ist',
      'unter alexander ist Trainer'
    ];
    const texts = session(...guesses.map((t): [string, number] => [t, 0]));
    expect(texts.at(-1)).toBe('unter alexander ist Trainer');
    expect(texts[2]).toBe('unter alexander');
  });

  it('takes a guess that revises earlier words', () => {
    expect(
      session(
        ['unter', 0],
        ['unter alexander', 0],
        ['Hunter Alexander ist', 0],
        ['Hunter Alexander ist Trainer', 0]
      ).at(-1)
    ).toBe('Hunter Alexander ist Trainer');
    expect(session(['Hunter', 0], ['Hunter Alex', 0], ['Hunter Alexander', 0]).at(-1)).toBe(
      'Hunter Alexander'
    );
    expect(session(['lena müller tim weber', 0], ['Lena Müller, Tim Weber.', 0.9]).at(-1)).toBe(
      'Lena Müller, Tim Weber.'
    );
  });

  it('keeps an earlier guess when unrelated speech starts', () => {
    expect(
      session(
        ['Lena Müller', 0],
        ['Lena Müller ist da', 0],
        ['Tim Weber', 0],
        ['Tim Weber fehlt', 0]
      ).at(-1)
    ).toBe('Lena Müller ist da Tim Weber fehlt');
  });

  it('does not repeat earlier phrases that a later guess of the whole session holds', () => {
    expect(
      session(['Lena Müller', 0], ['Tim', 0], ['Tim Weber', 0], ['Lena Müller Tim Weber', 0]).at(-1)
    ).toBe('Lena Müller Tim Weber');
  });

  it('lets the guesses go on from a phrase taken before them', () => {
    expect(session(['Lena Müller', 0.9], ['Lena Müller ist da', 0]).at(-1)).toBe(
      'Lena Müller ist da'
    );
  });

  it('appends dictated phrases to the text', () => {
    expect(appendDictation('', 'Lena Müller')).toBe('Lena Müller');
    expect(appendDictation('Lena Müller', 'Tim Weber')).toBe('Lena Müller Tim Weber');
    expect(appendDictation('Liste:\n', 'Tim Weber')).toBe('Liste:\nTim Weber');
    expect(appendDictation('Lena', '  ')).toBe('Lena');
    expect(appendDictation('unter alexander', ', ist Trainer')).toBe(
      'unter alexander, ist Trainer'
    );
  });

  it('tells the user what went wrong, but not about their own stop', () => {
    expect(dictationError('not-allowed')).toBe('denied');
    expect(dictationError('audio-capture')).toBe('denied');
    expect(dictationError('no-speech')).toBe('noSpeech');
    expect(dictationError('network')).toBe('failed');
    expect(dictationError('aborted')).toBeNull();
  });
});
