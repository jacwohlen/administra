/**
 * Dictation for the Daten-Assistent: the browser's speech recognition
 * (Web Speech API) turns speech into text in the dialog's text field, which
 * the user can read and correct before the normal reading. The Claude API
 * takes no audio, and the browser's recognition needs no key: Chrome and
 * Edge send the audio to their maker's speech service, Safari recognises on
 * the device or with Apple. Firefox has none; the button is then hidden.
 *
 * TypeScript's DOM library has no types for it, hence the minimal ones here.
 */

export interface SpeechAlternative {
  transcript: string;
}

export interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}

export interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResult };
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** The browser's speech recognition, null where there is none (Firefox, tests). */
export function speechRecognition(scope: object = globalThis): SpeechRecognitionConstructor | null {
  const w = scope as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Recognition language for the UI language: Swiss Standard German or English. */
export function dictationLang(locale: string | null | undefined): string {
  return locale?.startsWith('en') ? 'en-GB' : 'de-CH';
}

/** The final and the interim text of a result event, from `resultIndex` on. */
export function readResults(event: SpeechResultEvent): { final: string; interim: string } {
  let final = '';
  let interim = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    const transcript = result[0]?.transcript ?? '';
    if (result.isFinal) final += transcript;
    else interim += transcript;
  }
  return { final: final.trim(), interim: interim.trim() };
}

/** Appends dictated text to what is already in the field. */
export function appendDictation(text: string, addition: string): string {
  const add = addition.trim();
  if (!add) return text;
  if (!text.trim()) return add;
  return /\n\s*$/.test(text) ? `${text}${add}` : `${text.trimEnd()} ${add}`;
}

export type DictationError = 'denied' | 'noSpeech' | 'failed';

/** What the user is told for a recognition error; 'aborted' is our own stop. */
export function dictationError(code: string): DictationError | null {
  if (code === 'aborted') return null;
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
    return 'denied';
  }
  if (code === 'no-speech') return 'noSpeech';
  return 'failed';
}
