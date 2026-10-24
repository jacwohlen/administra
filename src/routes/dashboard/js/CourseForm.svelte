<script lang="ts">
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSave, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import type { Training } from '$lib/models';
  import { DEFAULT_DURATIONS, parseDurations, type JsCourse } from '$lib/jsExport';

  let {
    course = null,
    trainings,
    cancelHref
  }: { course?: JsCourse | null; trainings: Training[]; cancelHref: string } = $props();

  // The form edits a copy; the course prop does not change while it is open
  const initial = untrack(() => course);
  let title = $state(initial?.title ?? '');
  let courseNumber = $state(initial?.course_number ?? '');
  let dateFrom = $state(initial?.date_from ?? '');
  let dateTo = $state(initial?.date_to ?? '');
  let location = $state(initial?.location ?? '');
  let durations = $state((initial?.durations ?? DEFAULT_DURATIONS).join(', '));
  let selected = $state<number[]>((initial?.js_course_trainings ?? []).map((t) => t.training_id));
  let loading = $state(false);
  let error = $state('');
  let showDeleteConfirm = $state(false);

  async function save() {
    const allowed = parseDurations(durations);
    if (!title.trim() || !dateFrom || !dateTo || !location.trim()) {
      error = $_('page.js.validation.required_fields');
      return;
    }
    if (dateFrom > dateTo) {
      error = $_('page.js.validation.date_range');
      return;
    }
    if (!allowed.length) {
      error = $_('page.js.validation.durations');
      return;
    }

    loading = true;
    error = '';
    try {
      const values = {
        title: title.trim(),
        course_number: courseNumber.trim(),
        date_from: dateFrom,
        date_to: dateTo,
        location: location.trim(),
        durations: allowed
      };
      const { data: saved, error: saveError } = initial
        ? await supabaseClient
            .from('js_courses')
            .update(values)
            .eq('id', initial.id)
            .select('id')
            .single()
        : await supabaseClient.from('js_courses').insert(values).select('id').single();
      if (saveError || !saved) throw saveError ?? new Error('Not saved');

      const before = new Set((initial?.js_course_trainings ?? []).map((t) => t.training_id));
      const removed = [...before].filter((id) => !selected.includes(id));
      const added = selected.filter((id) => !before.has(id));
      if (removed.length) {
        const { error: removeError } = await supabaseClient
          .from('js_course_trainings')
          .delete()
          .eq('course_id', saved.id)
          .in('training_id', removed);
        if (removeError) throw removeError;
      }
      if (added.length) {
        const { error: addError } = await supabaseClient
          .from('js_course_trainings')
          .insert(added.map((training_id) => ({ course_id: saved.id, training_id })));
        if (addError) throw addError;
      }

      await invalidateAll();
      await goto(`/dashboard/js/${saved.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    } finally {
      loading = false;
    }
  }

  async function handleDeleteResponse(confirmed: boolean) {
    showDeleteConfirm = false;
    if (!confirmed || !initial) return;
    loading = true;
    const { error: deleteError } = await supabaseClient
      .from('js_courses')
      .delete()
      .eq('id', initial.id);
    loading = false;
    if (deleteError) {
      toaster.error({ title: deleteError.message });
      return;
    }
    toaster.success({ title: $_('page.js.delete_success') });
    await goto('/dashboard/js', { invalidateAll: true });
  }
</script>

<form
  onsubmit={(e: SubmitEvent) => {
    e.preventDefault();
    save();
  }}
  class="space-y-6"
>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
    <div class="md:col-span-2">
      <label class="label" for="title">
        <span>{$_('page.js.form.title')} *</span>
      </label>
      <input
        id="title"
        type="text"
        class="input"
        bind:value={title}
        required
        placeholder={$_('page.js.form.title_placeholder')}
      />
    </div>

    <div>
      <label class="label" for="dateFrom">
        <span>{$_('page.js.form.date_from')} *</span>
      </label>
      <input id="dateFrom" type="date" class="input" bind:value={dateFrom} required />
    </div>

    <div>
      <label class="label" for="dateTo">
        <span>{$_('page.js.form.date_to')} *</span>
      </label>
      <input id="dateTo" type="date" class="input" bind:value={dateTo} required />
    </div>

    <div>
      <label class="label" for="courseNumber">
        <span>{$_('page.js.form.course_number')}</span>
      </label>
      <input id="courseNumber" type="text" class="input" bind:value={courseNumber} />
    </div>

    <div>
      <label class="label" for="location">
        <span>{$_('page.js.form.location')} *</span>
      </label>
      <input
        id="location"
        type="text"
        class="input"
        bind:value={location}
        required
        maxlength="100"
        placeholder={$_('page.js.form.location_placeholder')}
      />
    </div>

    <div class="md:col-span-2">
      <label class="label" for="durations">
        <span>{$_('page.js.form.durations')} *</span>
      </label>
      <input id="durations" type="text" class="input" bind:value={durations} required />
      <p class="text-xs text-surface-600-400 mt-1">{$_('page.js.form.durations_hint')}</p>
    </div>

    <fieldset class="md:col-span-2">
      <legend class="label mb-2">{$_('page.js.form.trainings')}</legend>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {#each trainings as training (training.id)}
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="checkbox"
              value={Number(training.id)}
              bind:group={selected}
            />
            <span>
              {training.title}
              <span class="text-sm text-surface-600-400">
                · {$_('weekdayShort.' + training.weekday)}
                {training.dateFrom}{training.dateTo ? `–${training.dateTo}` : ''}
              </span>
            </span>
          </label>
        {/each}
      </div>
      <p class="text-xs text-surface-600-400 mt-1">{$_('page.js.form.trainings_hint')}</p>
    </fieldset>
  </div>

  {#if error}
    <div class="flex items-center gap-4 p-4 rounded-lg preset-filled-error-500">
      <p class="flex-1">{error}</p>
    </div>
  {/if}

  <div class="flex justify-end gap-4">
    {#if initial}
      <button
        type="button"
        class="btn preset-tonal-error mr-auto"
        onclick={() => (showDeleteConfirm = true)}
        disabled={loading}
      >
        <Fa icon={faTrash} />
        <span>{$_('button.delete')}</span>
      </button>
    {/if}
    <a href={cancelHref} class="btn preset-tonal-surface">{$_('button.cancel')}</a>
    <button type="submit" class="btn preset-filled-primary-500" disabled={loading}>
      <Fa icon={faSave} />
      <span>{loading ? $_('button.saving') : $_('button.save')}</span>
    </button>
  </div>
</form>

{#if showDeleteConfirm && initial}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => handleDeleteResponse(false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') handleDeleteResponse(false);
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('page.js.delete_title')}</h3>
      <p class="mb-4">{$_('page.js.delete_message', { values: { title: initial.title } })}</p>
      <div class="flex justify-end gap-2">
        <button class="btn preset-tonal-surface" onclick={() => handleDeleteResponse(false)}>
          {$_('button.cancel')}
        </button>
        <button class="btn preset-filled-error-500" onclick={() => handleDeleteResponse(true)}>
          {$_('button.delete')}
        </button>
      </div>
    </div>
  </div>
{/if}
