<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faMicrophone, faStop } from '@fortawesome/free-solid-svg-icons';
  import {
    appendDictation,
    dictationError,
    dictationLang,
    dictationSession,
    speechRecognition,
    type DictationError,
    type SpeechRecognitionLike
  } from '$lib/assistant/dictation';

  /**
   * «Diktieren»: speech to text with the browser's own recognition
   * ($lib/assistant/dictation.ts). While listening, `ontext` gets the
   * field's text as it was at the start plus everything dictated since, so
   * a revised guess replaces the old one; the parent should keep the field
   * read-only meanwhile (`onlistening`). What is still being recognised
   * shows below the button. Renders nothing where the browser cannot
   * recognise speech.
   *
   * `iconOnly` shows just the microphone (its label as tooltip and name) and
   * leaves the layout to the parent: button and status lines become items of
   * the parent's flex-wrap row (`display: contents`), the status lines on a
   * row of their own (`basis-full`), e.g. the mic beside a text field and
   * what it hears below the field.
   */
  let {
    text,
    ontext,
    onlistening,
    disabled = false,
    iconOnly = false
  }: {
    /** The field's current text */
    text: string;
    ontext: (text: string) => void;
    onlistening?: (listening: boolean) => void;
    disabled?: boolean;
    iconOnly?: boolean;
  } = $props();

  const Recognition = speechRecognition();
  let recognition: SpeechRecognitionLike | null = null;
  let listening = $state(false);
  let interim = $state('');
  let error = $state<DictationError | null>(null);

  const label = $derived(
    listening ? $_('assistant.dictation.stop') : $_('assistant.dictation.start')
  );

  function start() {
    if (!Recognition || listening) return;
    error = null;
    interim = '';
    const r = new Recognition();
    r.lang = dictationLang($locale);
    r.continuous = true;
    r.interimResults = true;
    const base = text;
    const read = dictationSession();
    r.onresult = (event) => {
      const update = read(event);
      if (update.text) ontext(appendDictation(base, update.text));
      interim = update.interim;
    };
    r.onerror = (event) => {
      error = dictationError(event.error);
    };
    r.onend = () => {
      listening = false;
      interim = '';
      recognition = null;
      onlistening?.(false);
    };
    try {
      r.start();
      recognition = r;
      listening = true;
      onlistening?.(true);
    } catch {
      error = 'failed';
    }
  }

  function stop() {
    recognition?.stop();
  }

  onDestroy(() => {
    recognition?.abort();
    if (listening) onlistening?.(false);
  });
</script>

{#if Recognition}
  <div class={iconOnly ? 'contents' : 'space-y-1'}>
    <button
      type="button"
      class={[
        iconOnly ? 'btn-icon size-11 p-0 flex-none' : 'btn btn-sm',
        listening ? 'preset-filled-error-500' : 'preset-tonal-primary'
      ]}
      aria-pressed={listening}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      disabled={disabled && !listening}
      onclick={() => (listening ? stop() : start())}
    >
      <Fa icon={listening ? faStop : faMicrophone} class={listening ? 'animate-pulse' : ''} />
      {#if !iconOnly}<span>{label}</span>{/if}
    </button>
    {#if listening || error}
      <div class={['space-y-1', iconOnly && 'basis-full']}>
        {#if listening}
          <p class="text-xs text-surface-600-400">
            {interim || $_('assistant.dictation.listening')}
          </p>
          <p class="text-xs text-surface-600-400">{$_('assistant.dictation.privacy')}</p>
        {/if}
        {#if error}
          <p class="text-xs text-error-600-400" role="alert">
            {$_(`assistant.dictation.errors.${error}`)}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
