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

/** Whether `longer` begins with the whole words of `shorter`, ignoring case. */
function extendsPhrase(longer: string, shorter: string): boolean {
  if (!shorter || !longer.toLowerCase().startsWith(shorter.toLowerCase())) return false;
  return longer.length === shorter.length || /[\s,.;:!?]/.test(longer[shorter.length]);
}

export interface DictationUpdate {
  /** New text to append to the field, '' if none */
  text: string;
  /** What is still being recognised */
  interim: string;
}

/**
 * Reads the result events of one listening session. Chrome on Android
 * sends a phrase again each time it grows, every time as final («unter»,
 * «unter», «unter alexander», «unter alexander ist»), and some browsers
 * hand earlier results over again. So a final result seen before adds
 * nothing, and one that repeats or extends the previous phrase adds only
 * its new words.
 */
export function dictationSession(): (event: SpeechResultEvent) => DictationUpdate {
  const seen = new Map<number, string>();
  let previous = '';
  return (event) => {
    const added: string[] = [];
    const pending: string[] = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = (result[0]?.transcript ?? '').trim();
      if (!transcript) continue;
      if (!result.isFinal) {
        pending.push(transcript);
        continue;
      }
      if (seen.get(i) === transcript) continue;
      seen.set(i, transcript);
      if (extendsPhrase(transcript, previous)) {
        const rest = transcript.slice(previous.length).trim();
        if (rest) added.push(rest);
        previous = transcript;
      } else if (!extendsPhrase(previous, transcript)) {
        added.push(transcript);
        previous = transcript;
      }
    }
    return { text: added.join(' '), interim: pending.join(' ') };
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
