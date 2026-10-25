<script lang="ts" generics="K extends AssistantKind">
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCamera,
    faFileImport,
    faShieldHalved,
    faSpinner,
    faTrash,
    faTriangleExclamation,
    faWandMagicSparkles
  } from '@fortawesome/free-solid-svg-icons';
  import { modalDialog } from '$lib/modalDialog';
  import {
    AssistantRequestError,
    loadAssistantStatus,
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

  loadAssistantStatus().then((s) => (remaining = s.remaining));

  const pastedText = $derived(
    [text, ...uploads.map((u) => u.text ?? '')].filter((t) => t.trim()).join('\n\n')
  );
  const fileCount = $derived(uploads.filter((u) => u.file).length);
  const canAnalyze = $derived(
    preparing === 0 && (fileCount > 0 || pastedText.trim().length > 0) && remaining !== 0
  );

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
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function analyze() {
    if (!canAnalyze) return;
    error = null;
    step = 'working';
    seconds = 0;
    timer = setInterval(() => seconds++, 1000);
    controller = new AbortController();
    try {
      const response = await requestProposal(
        {
          kind,
          files: uploads.flatMap((u) => (u.file ? [u.file] : [])),
          text: pastedText.slice(0, ASSISTANT_LIMITS.maxTextLength),
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
      if (controller?.signal.aborted) {
        step = 'input';
      } else {
        error = err instanceof AssistantRequestError ? err.code : 'failed';
        step = 'input';
      }
    } finally {
      stopTimer();
      controller = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  function back() {
    proposal = null;
    step = 'input';
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
    use:modalDialog
    class="card modal-dialog modal-dialog-xl max-h-[90vh] overflow-y-auto space-y-4"
    onclick={(e) => e.stopPropagation()}
  >
    <h3 class="flex items-center gap-2">
      <Fa icon={faWandMagicSparkles} class="text-primary-500" />
      <span>{title ?? $_(`assistant.kinds.${kind}.title`)}</span>
    </h3>

    {#if step === 'input'}
      <p class="text-sm text-surface-600-400">{$_(`assistant.kinds.${kind}.hint`)}</p>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn preset-tonal-primary" onclick={() => fileInput?.click()}>
          <Fa icon={faFileImport} />
          <span>{$_('assistant.chooseFiles')}</span>
        </button>
        <button type="button" class="btn preset-tonal-primary" onclick={() => cameraInput?.click()}>
          <Fa icon={faCamera} />
          <span>{$_('assistant.takePhoto')}</span>
        </button>
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
      </div>

      {#if uploads.length > 0 || preparing > 0}
        <ul class="space-y-1 text-sm">
          {#each uploads as upload, i (i)}
            <li class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate">{upload.name}</span>
              <span class="text-surface-600-400">{formatSize(upload.size)}</span>
              <button
                type="button"
                class="btn-icon btn-icon-sm preset-tonal-surface"
                aria-label={$_('button.remove')}
                onclick={() => removeUpload(i)}
              >
                <Fa icon={faTrash} />
              </button>
            </li>
          {/each}
          {#if preparing > 0}
            <li class="flex items-center gap-2 text-surface-600-400">
              <Fa icon={faSpinner} spin />
              <span>{$_('assistant.preparing')}</span>
            </li>
          {/if}
        </ul>
      {/if}

      <label class="label">
        <span>{$_('assistant.pasteText')}</span>
        <textarea
          class="textarea text-sm"
          rows="4"
          maxlength={ASSISTANT_LIMITS.maxTextLength}
          placeholder={$_('assistant.pasteTextPlaceholder')}
          bind:value={text}
        ></textarea>
      </label>

      <label class="label">
        <span>{$_('assistant.hint')}</span>
        <input
          class="input text-sm"
          type="text"
          maxlength={ASSISTANT_LIMITS.maxHintLength}
          placeholder={$_('assistant.hintPlaceholder')}
          bind:value={hint}
        />
      </label>

      <p class="flex items-start gap-2 text-xs text-surface-600-400">
        <Fa icon={faShieldHalved} class="mt-0.5 flex-none" />
        <span>{$_('assistant.privacy')}</span>
      </p>

      {#if error}
        <div class="flex items-start gap-2 p-3 rounded-lg preset-tonal-error text-sm" role="alert">
          <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
          <span>{$_(`assistant.errors.${error}`)}</span>
        </div>
      {/if}

      <footer class="flex flex-wrap items-center justify-end gap-2 pt-2">
        {#if remaining !== null}
          <span class="mr-auto text-xs text-surface-600-400">
            {$_('assistant.remaining', { values: { count: remaining } })}
          </span>
        {/if}
        <button type="button" class="btn preset-tonal-surface" onclick={close}>
          {$_('button.cancel')}
        </button>
        <button
          type="button"
          class="btn preset-filled-primary-500"
          disabled={!canAnalyze}
          onclick={analyze}
        >
          <Fa icon={faWandMagicSparkles} />
          <span>{$_('assistant.analyze')}</span>
        </button>
      </footer>
    {:else if step === 'working'}
      <div class="flex flex-col items-center gap-3 py-8 text-center" aria-live="polite">
        <Fa icon={faSpinner} spin size="2x" class="text-primary-500" />
        <p>{$_('assistant.working')}</p>
        <p class="text-sm text-surface-600-400">
          {$_('assistant.workingSeconds', { values: { seconds } })}
        </p>
        <button type="button" class="btn preset-tonal-surface" onclick={cancel}>
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
