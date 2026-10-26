<script lang="ts" generics="K extends AssistantKind">
  import type { Snippet } from 'svelte';
  import { onDestroy, tick } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCamera,
    faChevronRight,
    faFileImport,
    faFileLines,
    faFilePdf,
    faImage,
    faShieldHalved,
    faSpinner,
    faTriangleExclamation,
    faWandMagicSparkles,
    faXmark
  } from '@fortawesome/free-solid-svg-icons';
  import { modalDialog } from '$lib/modalDialog';
  import { appendDictation } from '$lib/assistant/dictation';
  import DictateButton from './DictateButton.svelte';
  import {
    AssistantRequestError,
    refreshAssistantStatus,
    requestProposal,
    type ClientErrorCode
  } from '$lib/assistant/client';
  import {
    formatSize,
    prepareUpload,
    totalSize,
    UploadError,
    type PreparedUpload,
    type UploadErrorCode
  } from '$lib/assistant/files';
  import {
    ASSISTANT_LIMITS,
    type AssistantContext,
    type AssistantKind,
    type ProposalMap
  } from '$lib/assistant/types';

  /**
   * The Daten-Assistent dialog (docs/AI_ASSISTANT.md): photos, a PDF or
   * pasted text in, a proposal out. What happens with the proposal is up to
   * the `review` snippet of the page that opened it — it shows every value
   * for checking and repair and saves only what the user confirms. `back`
   * returns to the upload step with the files kept.
   */
  let {
    kind,
    context = {},
    title,
    onclose,
    review
  }: {
    kind: K;
    context?: AssistantContext;
    /** Defaults to assistant.kinds.<kind>.title */
    title?: string;
    onclose: () => void;
    review: Snippet<[proposal: ProposalMap[K], back: () => void]>;
  } = $props();

  type Step = 'input' | 'working' | 'review';
  let step = $state<Step>('input');
  let uploads = $state<PreparedUpload[]>([]);
  let preparing = $state(0);
  let text = $state('');
  let hint = $state('');
  let error = $state<ClientErrorCode | UploadErrorCode | 'too_many_files' | null>(null);
  let proposal = $state<ProposalMap[K] | null>(null);
  let remaining = $state<number | null>(null);
  let seconds = $state(0);
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  let fileInput = $state<HTMLInputElement>();
  let cameraInput = $state<HTMLInputElement>();
  let dialogEl = $state<HTMLElement>();
  let analyzeButton = $state<HTMLButtonElement>();
  let cancelButton = $state<HTMLButtonElement>();
  let errorBox = $state<HTMLElement>();
  let fileButton = $state<HTMLButtonElement>();
  let hintInput = $state<HTMLInputElement>();
  // The hint is rarely needed: folded away, but still open after «Zurück»
  let hintOpen = $state(false);
  const uid = $props.id();

  // Fresh on every opening: the limit is a rolling 24 hours
  refreshAssistantStatus().then((s) => (remaining = s.remaining));

  const pastedText = $derived(
    [text, ...uploads.map((u) => u.text ?? '')].filter((t) => t.trim()).join('\n\n')
  );
  // Never cut: a partial text would give a partial proposal that looks complete
  const textTooLong = $derived(pastedText.length > ASSISTANT_LIMITS.maxTextLength);
  const fileCount = $derived(uploads.filter((u) => u.file).length);
  const canAnalyze = $derived(
    preparing === 0 &&
      !textTooLong &&
      (fileCount > 0 || pastedText.trim().length > 0) &&
      remaining !== 0
  );
  const shownError = $derived(textTooLong ? 'text_too_long' : error);
  const showLength = $derived(pastedText.length > ASSISTANT_LIMITS.maxTextLength * 0.8);

  function uploadIcon(upload: PreparedUpload) {
    if (!upload.file) return faFileLines;
    return upload.file.mediaType === 'application/pdf' ? faFilePdf : faImage;
  }

  async function toggleHint() {
    hintOpen = !hintOpen;
    if (!hintOpen) return;
    await tick();
    hintInput?.focus();
  }

  /** Keeps keyboard focus inside the dialog when a step replaces the focused control. */
  async function focusStep() {
    await tick();
    if (step === 'working') cancelButton?.focus();
    else if (step === 'review') dialogEl?.focus();
    else (errorBox ?? analyzeButton)?.focus();
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    error = null;
    for (const file of Array.from(list)) {
      if (
        fileCount + preparing >= ASSISTANT_LIMITS.maxFiles &&
        !/\.(txt|csv|tsv)$/i.test(file.name)
      ) {
        error = 'too_many_files';
        break;
      }
      preparing++;
      try {
        const upload = await prepareUpload(file);
        if (totalSize([...uploads, upload]) > ASSISTANT_LIMITS.maxTotalBytes) {
          error = 'too_large';
        } else {
          uploads = [...uploads, upload];
        }
      } catch (err) {
        error = err instanceof UploadError ? err.code : 'unreadable';
      } finally {
        preparing--;
      }
    }
  }

  function removeUpload(index: number) {
    uploads = uploads.filter((_, i) => i !== index);
    error = null;
    // Its button goes with it; keep the focus (and Escape) inside the dialog
    fileButton?.focus();
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function analyze() {
    if (!canAnalyze) return;
    error = null;
    step = 'working';
    focusStep();
    seconds = 0;
    timer = setInterval(() => seconds++, 1000);
    controller = new AbortController();
    try {
      const response = await requestProposal(
        {
          kind,
          files: uploads.flatMap((u) => (u.file ? [u.file] : [])),
          text: pastedText,
          hint: hint.trim(),
          locale: $locale?.startsWith('de') ? 'de' : 'en',
          context
        },
        controller.signal
      );
      proposal = response.proposal;
      remaining = response.remaining;
      step = 'review';
    } catch (err) {
      if (!controller?.signal.aborted) {
        error = err instanceof AssistantRequestError ? err.code : 'failed';
      }
      step = 'input';
      // A failed extraction still counts against the limit
      if (error === 'quota') remaining = 0;
      else refreshAssistantStatus().then((s) => (remaining = s.remaining));
    } finally {
      stopTimer();
      controller = null;
      focusStep();
    }
  }

  function cancel() {
    controller?.abort();
  }

  function back() {
    proposal = null;
    step = 'input';
    focusStep();
  }

  function close() {
    controller?.abort();
    onclose();
  }

  onDestroy(() => {
    controller?.abort();
    stopTimer();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={() => {
    // A click beside the dialog must not throw away a review
    if (step === 'input') close();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape' && step !== 'review') close();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    bind:this={dialogEl}
    use:modalDialog
    class={[
      'card modal-dialog max-h-[90vh] overflow-y-auto space-y-4',
      // The form needs no more; the review tables do
      step === 'review' ? 'modal-dialog-xl' : 'modal-dialog-lg'
    ]}
    aria-describedby={step === 'input' ? `${uid}-about` : undefined}
    onclick={(e) => e.stopPropagation()}
  >
    <header class="flex items-center gap-2">
      <h3 class="mb-0! flex min-w-0 flex-1 items-center gap-2">
        <Fa icon={faWandMagicSparkles} class="flex-none text-primary-500" />
        <span class="truncate">{title ?? $_(`assistant.kinds.${kind}.title`)}</span>
      </h3>
      {#if step === 'input' && remaining !== null}
        <!-- Outside the h3, so it is not part of the dialog's name -->
        <span
          class={[
            'flex-none text-xs',
            remaining === 0 ? 'text-error-600-400' : 'text-surface-600-400'
          ]}
          title={$_('assistant.remaining', { values: { count: remaining } })}
        >
          <span aria-hidden="true">
            {$_('assistant.remainingShort', { values: { count: remaining } })}
          </span>
          <span class="sr-only">
            {$_('assistant.remaining', { values: { count: remaining } })}
          </span>
        </span>
      {/if}
    </header>

    {#if step === 'input'}
      <div class="space-y-3">
        <p id="{uid}-about" class="text-sm text-surface-600-400">
          {$_(`assistant.kinds.${kind}.hint`)}
        </p>

        <!-- Phones and tablets: camera and gallery/files as two tiles. Mouse
             devices ignore `capture`, so they get the file picker only. -->
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn preset-tonal-primary flex-1 pointer-fine:hidden pointer-coarse:flex-col pointer-coarse:gap-1 pointer-coarse:py-2"
            onclick={() => cameraInput?.click()}
          >
            <Fa icon={faCamera} class="pointer-coarse:text-xl" />
            <span class="pointer-coarse:text-sm">{$_('assistant.takePhoto')}</span>
          </button>
          <button
            bind:this={fileButton}
            type="button"
            class="btn preset-tonal-primary flex-1 pointer-fine:flex-none pointer-coarse:flex-col pointer-coarse:gap-1 pointer-coarse:py-2"
            onclick={() => fileInput?.click()}
          >
            <Fa icon={faFileImport} class="pointer-coarse:text-xl" />
            <span class="pointer-coarse:text-sm">{$_('assistant.chooseFiles')}</span>
          </button>
          <!-- Beside the button where there is room; on a phone the tiles say enough -->
          <p class="hidden min-w-0 flex-1 text-xs text-surface-600-400 pointer-fine:block">
            {$_('assistant.fileTypes', { values: { max: ASSISTANT_LIMITS.maxFiles } })}
          </p>
        </div>
        <input
          bind:this={fileInput}
          type="file"
          class="hidden"
          multiple
          accept="image/*,application/pdf,.pdf,.txt,.csv,.tsv,text/plain,text/csv"
          onchange={(e) => {
            addFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
        <input
          bind:this={cameraInput}
          type="file"
          class="hidden"
          accept="image/*"
          capture="environment"
          onchange={(e) => {
            addFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />

        {#if uploads.length > 0 || preparing > 0}
          <ul
            class="divide-y divide-surface-200-800 rounded-base border border-surface-200-800 text-sm"
            aria-label={$_('assistant.attachments')}
          >
            {#each uploads as upload, i (i)}
              <li class="flex items-center gap-2 pl-3">
                <Fa icon={uploadIcon(upload)} class="flex-none text-surface-600-400" />
                <span class="min-w-0 flex-1 truncate" title={upload.name}>{upload.name}</span>
                <span class="flex-none text-xs text-surface-600-400">
                  {formatSize(upload.size)}
                </span>
                <button
                  type="button"
                  class="btn-icon size-11 p-0 flex-none hover:bg-surface-200-800"
                  aria-label="{$_('button.remove')}: {upload.name}"
                  title={$_('button.remove')}
                  onclick={() => removeUpload(i)}
                >
                  <Fa icon={faXmark} />
                </button>
              </li>
            {/each}
            {#if preparing > 0}
              <li class="flex min-h-11 items-center gap-2 px-3 text-surface-600-400">
                <Fa icon={faSpinner} spin />
                <span>{$_('assistant.preparing')}</span>
              </li>
            {/if}
          </ul>
        {/if}

        <!-- Speech goes into the text field, where it can be read and corrected first -->
        <div class="flex flex-wrap items-start gap-2">
          <textarea
            class="textarea min-w-0 flex-1 text-sm"
            rows="3"
            aria-label={$_('assistant.pasteText')}
            aria-describedby={showLength ? `${uid}-length` : undefined}
            placeholder={$_('assistant.pasteTextPlaceholder', {
              values: { example: $_(`assistant.kinds.${kind}.example`) }
            })}
            aria-invalid={textTooLong}
            bind:value={text}
          ></textarea>
          <DictateButton iconOnly ontext={(spoken) => (text = appendDictation(text, spoken))} />
          {#if showLength}
            <p
              id="{uid}-length"
              class={[
                'basis-full text-xs',
                textTooLong ? 'text-error-600-400' : 'text-surface-600-400'
              ]}
            >
              {$_('assistant.textLength', {
                values: { count: pastedText.length, max: ASSISTANT_LIMITS.maxTextLength }
              })}
            </p>
          {/if}
        </div>

        <!-- Optional note to the model, sent apart from the material -->
        <div>
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2 py-1.5 text-left text-sm text-surface-600-400 hover:text-surface-950-50 pointer-coarse:min-h-11"
            aria-expanded={hintOpen}
            aria-controls={hintOpen ? `${uid}-hint` : undefined}
            onclick={toggleHint}
          >
            <Fa
              icon={faChevronRight}
              size="xs"
              class="flex-none transition-transform {hintOpen ? 'rotate-90' : ''}"
            />
            <span class="flex-none">{$_('assistant.hint')}</span>
            {#if !hintOpen && hint.trim()}
              <span class="min-w-0 truncate text-surface-950-50">– {hint.trim()}</span>
            {/if}
          </button>
          {#if hintOpen}
            <input
              bind:this={hintInput}
              id="{uid}-hint"
              class="input mt-1 text-sm"
              type="text"
              aria-label={$_('assistant.hint')}
              maxlength={ASSISTANT_LIMITS.maxHintLength}
              placeholder={$_('assistant.hintPlaceholder')}
              bind:value={hint}
            />
          {/if}
        </div>

        <p class="flex items-start gap-2 text-xs text-surface-600-400">
          <Fa icon={faShieldHalved} class="mt-0.5 flex-none" />
          <span>{$_('assistant.privacy')}</span>
        </p>

        {#if shownError}
          <div
            bind:this={errorBox}
            class="flex items-start gap-2 p-3 rounded-lg preset-tonal-error text-sm"
            role="alert"
            tabindex="-1"
          >
            <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
            <span>{$_(`assistant.errors.${shownError}`)}</span>
          </div>
        {/if}

        <footer class="flex justify-end gap-2 pt-1">
          <button type="button" class="btn preset-tonal-surface" onclick={close}>
            {$_('button.cancel')}
          </button>
          <button
            bind:this={analyzeButton}
            type="button"
            class="btn preset-filled-primary-500"
            disabled={!canAnalyze}
            onclick={analyze}
          >
            <Fa icon={faWandMagicSparkles} />
            <span>{$_('assistant.analyze')}</span>
          </button>
        </footer>
      </div>
    {:else if step === 'working'}
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <Fa icon={faSpinner} spin size="2x" class="text-primary-500" />
        <p aria-live="polite">{$_('assistant.working')}</p>
        <p class="text-sm text-surface-600-400" aria-hidden="true">
          {$_('assistant.workingSeconds', { values: { seconds } })}
        </p>
        <button
          bind:this={cancelButton}
          type="button"
          class="btn preset-tonal-surface"
          onclick={cancel}
        >
          {$_('button.cancel')}
        </button>
      </div>
    {:else if proposal}
      {#if proposal.warnings.length > 0}
        <div class="flex items-start gap-2 p-3 rounded-lg preset-tonal-warning text-sm">
          <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
          <div>
            <p class="font-semibold">{$_('assistant.modelWarnings')}</p>
            <ul class="list-disc pl-4">
              {#each proposal.warnings as warning, i (i)}
                <li>{warning}</li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}
      {@render review(proposal, back)}
    {/if}
  </div>
</div>
