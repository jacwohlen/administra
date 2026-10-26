<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faMicrophone, faStop } from '@fortawesome/free-solid-svg-icons';
  import {
    dictationError,
    dictationLang,
    readResults,
    speechRecognition,
    type DictationError,
    type SpeechRecognitionLike
  } from '$lib/assistant/dictation';

  /**
   * «Diktieren»: speech to text with the browser's own recognition
   * ($lib/assistant/dictation.ts). Each finished phrase goes to `ontext`;
   * what is still being recognised shows below the button. Renders nothing
   * where the browser cannot recognise speech.
   */
  let { ontext, disabled = false }: { ontext: (text: string) => void; disabled?: boolean } =
    $props();

  const Recognition = speechRecognition();
  let recognition: SpeechRecognitionLike | null = null;
  let listening = $state(false);
  let interim = $state('');
  let error = $state<DictationError | null>(null);

  function start() {
    if (!Recognition || listening) return;
    error = null;
    interim = '';
    const r = new Recognition();
    r.lang = dictationLang($locale);
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      const { final, interim: pending } = readResults(event);
      if (final) ontext(final);
      interim = pending;
    };
    r.onerror = (event) => {
      error = dictationError(event.error);
    };
    r.onend = () => {
      listening = false;
      interim = '';
      recognition = null;
    };
    try {
      r.start();
      recognition = r;
      listening = true;
    } catch {
      error = 'failed';
    }
  }

  function stop() {
    recognition?.stop();
  }

  onDestroy(() => recognition?.abort());
</script>

{#if Recognition}
  <div class="space-y-1">
    <button
      type="button"
      class="btn btn-sm {listening ? 'preset-filled-error-500' : 'preset-tonal-primary'}"
      aria-pressed={listening}
      disabled={disabled && !listening}
      onclick={() => (listening ? stop() : start())}
    >
      <Fa icon={listening ? faStop : faMicrophone} class={listening ? 'animate-pulse' : ''} />
      <span>{listening ? $_('assistant.dictation.stop') : $_('assistant.dictation.start')}</span>
    </button>
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
