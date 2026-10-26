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
  /** 0 on Chrome for Android's guesses, see dictationSession() */
  confidence?: number;
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

/** Lower-case words without punctuation, for comparing guesses. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether `next` is a new guess for the same speech as `previous`: they
 * share one of their first words, or one first word contains the other
 * («unter» and «Hunter»). Speech after a new start shares neither.
 */
function sameSpeech(previous: string, next: string): boolean {
  const a = words(previous).slice(0, 3);
  const b = words(next).slice(0, 3);
  if (a.some((word) => b.includes(word))) return true;
  const [x = '', y = ''] = [a[0], b[0]];
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
}

/** Whether the words of `longer` begin with those of `shorter`. */
function startsWithWords(longer: string, shorter: string): boolean {
  const a = words(longer);
  const b = words(shorter);
  return b.length > 0 && b.length <= a.length && b.every((word, i) => a[i] === word);
}

export interface DictationUpdate {
  /** Everything dictated in this session, for the text field */
  text: string;
  /** What is still being recognised */
  interim: string;
}

/**
 * Reads the result events of one listening session into its whole text.
 * Final results are normally separate phrases and are joined as they come
 * (desktop Chrome, Edge, Safari). Chrome on Android, up to version 157,
 * instead sends every guess of the speech so far as a final result without
 * confidence («unter», «unter», «unter alexander», «Hunter Alexander ist»):
 * from the first such result on, each guess replaces the previous one, and
 * only a guess for unrelated speech starts a new phrase.
 */
export function dictationSession(): (event: SpeechResultEvent) => DictationUpdate {
  const phrases: string[] = [];
  let guess = '';
  let guessing = false;
  return (event) => {
    const pending: string[] = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = (result[0]?.transcript ?? '').trim();
      if (!transcript) continue;
      if (!result.isFinal) {
        pending.push(transcript);
        continue;
      }
      if (result[0].confidence === 0) guessing = true;
      if (!guessing) {
        phrases.push(transcript);
        continue;
      }
      // The guesses may go on from a phrase taken before the first of them
      if (!guess && phrases.length > 0 && sameSpeech(phrases[phrases.length - 1], transcript)) {
        guess = phrases.pop()!;
      }
      if (guess && !sameSpeech(guess, transcript)) phrases.push(guess);
      guess = transcript;
      // A guess of the whole session so far also holds the phrases before it
      const covered = phrases.findIndex((_, k) =>
        startsWithWords(transcript, phrases.slice(k).join(' '))
      );
      if (covered >= 0) phrases.splice(covered);
    }
    return { text: [...phrases, guess].filter(Boolean).join(' '), interim: pending.join(' ') };
  };
}

/** Appends dictated text to what is already in the field. */
export function appendDictation(text: string, addition: string): string {
  const add = addition.trim();
  if (!add) return text;
  if (!text.trim()) return add;
  if (/\n\s*$/.test(text)) return `${text}${add}`;
  // «Lena» + «, Tim»: punctuation goes right after the word
  return /^[,.;:!?]/.test(add) ? `${text.trimEnd()}${add}` : `${text.trimEnd()} ${add}`;
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
