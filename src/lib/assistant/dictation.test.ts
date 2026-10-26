import { describe, expect, it } from 'vitest';
import {
  appendDictation,
  dictationError,
  dictationLang,
  readResults,
  speechRecognition,
  type SpeechResult
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
    const event = {
      resultIndex: 1,
      results: {
        length: 3,
        0: result('schon verarbeitet', true),
        1: result('Anwesend Lena Müller ', true),
        2: result('Tim We', false)
      }
    };
    expect(readResults(event)).toEqual({ final: 'Anwesend Lena Müller', interim: 'Tim We' });
  });

  it('appends dictated phrases to the text', () => {
    expect(appendDictation('', 'Lena Müller')).toBe('Lena Müller');
    expect(appendDictation('Lena Müller', 'Tim Weber')).toBe('Lena Müller Tim Weber');
    expect(appendDictation('Liste:\n', 'Tim Weber')).toBe('Liste:\nTim Weber');
    expect(appendDictation('Lena', '  ')).toBe('Lena');
  });

  it('tells the user what went wrong, but not about their own stop', () => {
    expect(dictationError('not-allowed')).toBe('denied');
    expect(dictationError('audio-capture')).toBe('denied');
    expect(dictationError('no-speech')).toBe('noSpeech');
    expect(dictationError('network')).toBe('failed');
    expect(dictationError('aborted')).toBeNull();
  });
});
