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

function result(transcript: string, isFinal: boolean): SpeechResult {
  return { isFinal, length: 1, 0: { transcript } };
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
        1: result('Anwesend Lena Müller ', true),
        2: result('Tim We', false)
      }
    };
    expect(read(event)).toEqual({ text: 'Anwesend Lena Müller', interim: 'Tim We' });
  });

  /** Events with one result each, at growing indexes, as Chrome sends them. */
  function events(...finals: string[]): SpeechResultEvent[] {
    return finals.map((transcript, i) => ({
      resultIndex: i,
      results: { length: i + 1, [i]: result(transcript, true) } as SpeechResultEvent['results']
    }));
  }

  it('adds separate phrases one after the other (desktop Chrome, Safari)', () => {
    const read = dictationSession();
    const added = events('Anwesend Lena Müller', ' Tim Weber', ' Leitung Beni Keller').map(
      (e) => read(e).text
    );
    expect(added).toEqual(['Anwesend Lena Müller', 'Tim Weber', 'Leitung Beni Keller']);
  });

  it('adds only the new words of a phrase that is sent again as it grows (Chrome on Android)', () => {
    const read = dictationSession();
    const added = events(
      'unter',
      'unter',
      'unter alexander',
      'unter alexander',
      'Unter Alexander ist',
      'unter alexander ist Trainer'
    ).map((e) => read(e).text);
    expect(added.filter(Boolean).join(' ')).toBe('unter alexander ist Trainer');
  });

  it('also when every event hands over all growing phrases again from the start', () => {
    const read = dictationSession();
    const phrases = ['unter', 'unter alexander', 'unter alexander ist Trainer'];
    const added = phrases.map((_, n) => {
      const results: Record<number, SpeechResult> = {};
      phrases.slice(0, n + 1).forEach((t, i) => (results[i] = result(t, true)));
      return read({ resultIndex: 0, results: { length: n + 1, ...results } }).text;
    });
    expect(added).toEqual(['unter', 'alexander', 'ist Trainer']);
  });

  it('ignores a shorter repeat and final results handed over again', () => {
    const read = dictationSession();
    expect(read(events('Lena Müller')[0]).text).toBe('Lena Müller');
    expect(read(events('', 'Lena')[1]).text).toBe('');
    const again = {
      resultIndex: 0,
      results: { length: 2, 0: result('Lena Müller', true), 1: result('Tim Weber', true) }
    };
    expect(read(again).text).toBe('Tim Weber');
    expect(read(again).text).toBe('');
  });

  it('does not take a longer word for a repeat', () => {
    const read = dictationSession();
    expect(read(events('Tim')[0]).text).toBe('Tim');
    expect(read(events('', 'Timo Weber')[1]).text).toBe('Timo Weber');
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
