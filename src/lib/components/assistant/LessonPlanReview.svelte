<script lang="ts">
  import { untrack } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircleExclamation,
    faDownload,
    faFile,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import {
    CONTENT_MAX,
    buildLessonPlanWrite,
    defaultTitle,
    initialInput,
    lessonPlanLines,
    reviewLessonPlan,
    type ExistingLessonPlan,
    type LessonPlanInput,
    type LessonPlanMode,
    type LessonPlanStatus
  } from '$lib/assistant/lessonPlan';
  import { isIsoDate, MAX_LENGTH } from '$lib/assistant/proposals';
  import type { LessonPlanProposal } from '$lib/assistant/types';

  /**
   * Review step of the Daten-Assistent for a lesson plan: the plan read
   * from the document in the editor's text format, editable, next to how
   * the card will show it. An existing text plan is replaced or kept with
   * the import added below it; an existing file is only replaced after an
   * explicit tick. Saved with the editor's columns, one row per training
   * and date.
   */
  let {
    proposal,
    trainingId,
    date,
    existing,
    loading = false,
    onback,
    oncancel,
    onreload,
    onapplied,
    ondownload
  }: {
    proposal: LessonPlanProposal;
    trainingId: number;
    date: string;
    /** The plan saved for this training and date, as the card loaded it */
    existing: ExistingLessonPlan | null;
    /** The card is loading the saved plan */
    loading?: boolean;
    onback: () => void;
    oncancel: () => void;
    /** Load the saved plan again after it changed meanwhile */
    onreload: () => Promise<void> | void;
    /** Saved: close the dialog and show the plan */
    onapplied: () => void;
    /** Download the saved plan's file */
    ondownload?: () => void;
  } = $props();

  let input = $state<LessonPlanInput>(untrack(() => initialInput(proposal, existing)));
  let context = $derived({ trainingId, date, existing });
  let review = $derived(reviewLessonPlan(proposal, input, context));
  let lines = $derived(review.content ? lessonPlanLines(review.content) : []);
  let count = $derived(review.status === 'new' || review.status === 'changed' ? 1 : 0);
  let saving = $state(false);
  let canApply = $derived(review.ready && !saving && !loading);

  const MODES: LessonPlanMode[] = ['replace', 'append'];

  const STATUS_CLASS: Record<LessonPlanStatus, string> = {
    new: 'preset-tonal-success',
    exists: 'preset-tonal-surface',
    changed: 'preset-tonal-warning',
    duplicate: 'preset-tonal-surface',
    invalid: 'preset-tonal-error'
  };

  function formatDate(value: string): string {
    return isIsoDate(value) ? dayjs(value).format('DD.MM.YYYY') : value;
  }

  function setMode(mode: LessonPlanMode) {
    // A title the user typed stays; the default follows the mode
    if (input.title === defaultTitle(input.mode, proposal, existing)) {
      input.title = defaultTitle(mode, proposal, existing);
    }
    input.mode = mode;
  }

  function errorText(code: string): string {
    return $_(`assistant.lessonPlan.errors.${code}`, { values: { max: CONTENT_MAX } });
  }

  /** The plan changed meanwhile: reload it and let the user check again */
  async function changedMeanwhile() {
    toaster.error({ title: $_('assistant.lessonPlan.changedMeanwhile') });
    await onreload();
  }

  async function apply() {
    if (!canApply) return;
    saving = true;
    try {
      const {
        data: { user }
      } = await supabaseClient.auth.getUser();
      const write = buildLessonPlanWrite(proposal, input, context, user?.id ?? null);
      if (!write) return;

      let fileKept = false;
      if (write.action === 'insert') {
        const { error } = await supabaseClient
          .from('lesson_plans')
          .insert(write.row)
          .select('id')
          .single();
        // Unique ("trainingId", date): someone saved a plan for this date meanwhile
        if (error?.code === '23505') return await changedMeanwhile();
        if (error) throw error;
      } else {
        const { match } = write;
        let query = supabaseClient
          .from('lesson_plans')
          .update(write.row)
          .eq('id', match.id)
          .eq('trainingId', match.trainingId)
          .eq('date', match.date);
        query = match.updatedAt
          ? query.eq('updated_at', match.updatedAt)
          : query.is('updated_at', null);
        query = match.filePath
          ? query.eq('file_path', match.filePath)
          : query.is('file_path', null);
        const { data, error } = await query.select('id');
        if (error) throw error;
        // No row back: changed or removed meanwhile (or RLS stopped it)
        if ((data?.length ?? 0) === 0) return await changedMeanwhile();
        // Only now that the row no longer points to it, like the editor's switch to text
        if (write.removeFile) {
          const { error: removeError } = await supabaseClient.storage
            .from('lesson-plans')
            .remove([write.removeFile]);
          if (removeError) {
            console.error('Error removing the replaced lesson plan file:', removeError);
            fileKept = true;
          }
        }
      }

      if (fileKept) {
        toaster.warning({ title: $_('assistant.lessonPlan.file.notRemoved') });
      } else {
        toaster.success({ title: $_('assistant.review.done', { values: { count: 1 } }) });
      }
      onapplied();
    } catch (err) {
      console.error('Error saving the lesson plan from the assistant:', err);
      toaster.error({ title: $_('assistant.review.error') });
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span class="badge text-xs {STATUS_CLASS[review.status]}">
      {$_(`assistant.review.status.${review.status}`)}
    </span>
    <span class="font-semibold">
      {$_('assistant.lessonPlan.forDate', { values: { date: formatDate(date) } })}
    </span>
  </div>

  {#if review.writtenDate}
    <div class="p-3 rounded-lg preset-tonal-warning text-sm space-y-2" role="alert">
      <div class="flex items-start gap-2">
        <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
        <div class="space-y-1">
          <p>
            {$_('assistant.lessonPlan.date.differs', {
              values: { written: formatDate(review.writtenDate), date: formatDate(date) }
            })}
          </p>
          <p class="text-xs">{$_('assistant.lessonPlan.date.otherPage')}</p>
        </div>
      </div>
      <label class="flex items-start gap-2">
        <input
          class="checkbox mt-0.5"
          type="checkbox"
          bind:checked={input.otherDate}
          disabled={saving}
        />
        <span>
          {$_('assistant.lessonPlan.date.confirm', { values: { date: formatDate(date) } })}
        </span>
      </label>
    </div>
  {/if}

  {#if existing?.filePath}
    {@const path = existing.filePath}
    {@const name = existing.fileName || $_('page.trainings.attachment')}
    <div class="p-3 rounded-lg preset-tonal-warning text-sm space-y-2" role="alert">
      <div class="flex items-start gap-2">
        <Fa icon={faFile} class="mt-0.5 flex-none" />
        <div class="min-w-0 space-y-1">
          <p class="font-semibold break-words">
            {$_('assistant.lessonPlan.file.exists', { values: { name } })}
          </p>
          <p>{$_('assistant.lessonPlan.file.replaced')}</p>
        </div>
      </div>
      {#if ondownload}
        <button type="button" class="btn btn-sm preset-tonal-surface" onclick={ondownload}>
          <Fa icon={faDownload} />
          <span>{$_('button.download')}</span>
        </button>
      {/if}
      <label class="flex items-start gap-2">
        <input
          class="checkbox mt-0.5"
          type="checkbox"
          checked={input.replaceFile === path}
          onchange={(e) => (input.replaceFile = e.currentTarget.checked ? path : null)}
          disabled={saving}
        />
        <span class="break-words">
          {$_('assistant.lessonPlan.file.confirm', { values: { name } })}
        </span>
      </label>
    </div>
  {:else if existing}
    <!-- Replacing is the default here, so it stands out like the file warning -->
    <div
      class="p-3 rounded-lg text-sm space-y-2 {review.mode === 'replace'
        ? 'preset-tonal-warning'
        : 'preset-tonal-surface'}"
    >
      <p>
        {$_('assistant.lessonPlan.existing.text')}
        {#if existing.title}<span class="font-semibold break-words">«{existing.title}»</span>{/if}
      </p>
      {#if existing.updatedAt}
        <p class="text-xs text-surface-600-400">
          {$_('page.trainings.lastEdited')}: {new Date(existing.updatedAt).toLocaleString(
            $locale ?? undefined
          )}
        </p>
      {/if}
      <fieldset class="space-y-1">
        <legend class="text-xs text-surface-600-400">
          {$_('assistant.lessonPlan.existing.mode')}
        </legend>
        {#each MODES as mode (mode)}
          <label class="flex items-center gap-2">
            <input
              class="radio"
              type="radio"
              name="lesson-plan-mode"
              value={mode}
              checked={input.mode === mode}
              onchange={() => setMode(mode)}
              disabled={saving}
            />
            <span>{$_(`assistant.lessonPlan.existing.${mode}`)}</span>
          </label>
        {/each}
      </fieldset>
      {#if review.mode === 'replace'}
        <details>
          <summary class="cursor-pointer text-xs">
            {$_('assistant.lessonPlan.existing.show')}
          </summary>
          <div class="mt-2 whitespace-pre-wrap break-words text-xs">{existing.content}</div>
        </details>
      {/if}
    </div>
  {/if}

  <label class="label">
    <span class="text-sm">{$_('page.trainings.titleTraining')}</span>
    <input
      class="input"
      type="text"
      maxlength={MAX_LENGTH.title}
      placeholder={$_('page.trainings.titlePlaceholder')}
      bind:value={input.title}
      disabled={saving}
    />
    {#if review.previousTitle !== null}
      <span class="text-xs text-surface-600-400 break-words">
        {$_('assistant.lessonPlan.previousTitle', { values: { title: review.previousTitle } })}
      </span>
    {/if}
  </label>

  <div class="grid gap-3 md:grid-cols-2">
    <label class="label">
      <span class="text-sm">
        {review.mode === 'append'
          ? $_('assistant.lessonPlan.contentAppend')
          : $_('assistant.lessonPlan.content')}
      </span>
      <textarea
        class="textarea text-sm"
        class:border-error-500={review.errors.includes('empty') ||
          review.errors.includes('tooLong')}
        rows="14"
        placeholder={$_('page.trainings.contentPlaceholder')}
        bind:value={input.content}
        disabled={saving}
      ></textarea>
      <span class="text-xs text-surface-600-400">{$_('assistant.lessonPlan.contentHelp')}</span>
    </label>
    <div class="space-y-1">
      <p class="text-sm">{$_('assistant.lessonPlan.preview')}</p>
      <div
        class="card border border-surface-200-800 p-3 max-h-96 overflow-y-auto prose max-w-none text-sm"
      >
        {#each lines as line, i (i)}
          {#if line.kind === 'h1'}
            <h1 class="mt-2">{line.text}</h1>
          {:else if line.kind === 'h2'}
            <h2 class="mt-2">{line.text}</h2>
          {:else if line.kind === 'h3'}
            <h3 class="mt-2">{line.text}</h3>
          {:else if line.kind === 'item'}
            <ul style="list-style: square;" class="px-8"><li>{line.text}</li></ul>
          {:else}
            <p>{line.text}</p>
          {/if}
        {:else}
          <p class="text-surface-600-400">{$_('assistant.lessonPlan.previewEmpty')}</p>
        {/each}
      </div>
    </div>
  </div>

  {#if review.status === 'exists' || review.status === 'duplicate'}
    <p class="text-sm text-surface-600-400">
      {$_(`assistant.lessonPlan.${review.status === 'exists' ? 'same' : 'contained'}`)}
    </p>
  {/if}

  {#if review.errors.length > 0}
    <ul class="space-y-0.5 text-xs">
      {#each review.errors as code (code)}
        <li class="flex items-start gap-1.5 text-error-600-400">
          <Fa icon={faCircleExclamation} class="mt-0.5 flex-none" />
          <span>{errorText(code)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <footer class="flex flex-wrap items-center justify-end gap-2 pt-2">
    <p class="mr-auto text-xs text-surface-600-400" aria-live="polite">
      {#if saving}
        {$_('assistant.review.applying')}
      {:else if count === 0}
        {$_('assistant.review.nothing')}
      {/if}
    </p>
    <button type="button" class="btn preset-tonal-surface" onclick={onback} disabled={saving}>
      {$_('assistant.review.back')}
    </button>
    <button type="button" class="btn preset-tonal-surface" onclick={oncancel} disabled={saving}>
      {$_('button.cancel')}
    </button>
    <button
      type="button"
      class="btn preset-filled-primary-500"
      disabled={!canApply}
      onclick={apply}
    >
      {#if saving}
        <Fa icon={faSpinner} spin />
        <span>{$_('assistant.review.applying')}</span>
      {:else}
        <Fa icon={faCheck} />
        <span>{$_('assistant.review.apply', { values: { count } })}</span>
      {/if}
    </button>
  </footer>
</div>
