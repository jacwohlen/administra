<script lang="ts" module>
  /** An event an exam day can be linked to */
  export interface EventOption {
    id: number;
    title: string;
    date: string;
    section: string | null;
    location: string | null;
    registrationDeadline: string | null;
  }
</script>

<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { clubConfig } from '$lib/clubConfig';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSave, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import type { Exam } from '$lib/models';

  let {
    exam = null,
    events,
    sectionLocked = false,
    cancelHref,
    onsaved
  }: {
    /** The exam day to edit; null creates a new one */
    exam?: Exam | null;
    /** Events to link, newest relevant first */
    events: EventOption[];
    /** Candidates are registered for grades of the section */
    sectionLocked?: boolean;
    cancelHref: string;
    onsaved: (id: number) => void;
  } = $props();

  // Starts from the exam being edited, then belongs to the user
  // svelte-ignore state_referenced_locally
  let form = $state({
    event_id: exam?.event_id ? String(exam.event_id) : '',
    title: exam?.title ?? '',
    section: exam?.section ?? clubConfig.sections[0] ?? '',
    date: exam?.date ?? '',
    registration_deadline: exam?.registration_deadline ?? '',
    location: exam?.location ?? '',
    notes: exam?.notes ?? ''
  });
  let saving = $state(false);
  let error = $state('');

  /** Taking over an event fills in what the event already knows. */
  function onEventChange() {
    const ev = events.find((e) => String(e.id) === form.event_id);
    if (!ev) return;
    form.title = ev.title;
    form.date = ev.date;
    if (!sectionLocked && ev.section && clubConfig.sections.includes(ev.section)) {
      form.section = ev.section;
    }
    if (ev.location) form.location = ev.location;
    if (ev.registrationDeadline) form.registration_deadline = ev.registrationDeadline;
  }

  async function save() {
    if (!form.title.trim() || !form.date || !form.section) {
      error = $_('page.exams.form.required');
      return;
    }
    if (form.registration_deadline && form.registration_deadline > form.date) {
      error = $_('page.exams.form.deadlineAfterDate');
      return;
    }
    saving = true;
    error = '';
    const row = {
      event_id: form.event_id ? Number(form.event_id) : null,
      title: form.title.trim(),
      section: form.section,
      date: form.date,
      registration_deadline: form.registration_deadline || null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null
    };
    const query = exam
      ? supabaseClient.from('exams').update(row).eq('id', exam.id).select('id').single()
      : supabaseClient.from('exams').insert(row).select('id').single();
    const { data, error: saveError } = await query;
    saving = false;
    if (saveError || !data) {
      console.error('Error saving exam:', saveError);
      error = $_('page.exams.form.saveError');
      return;
    }
    onsaved(data.id);
  }
</script>

<form
  class="space-y-6"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
    {#if events.length > 0}
      <label class="label md:col-span-2">
        <span>{$_('page.exams.form.event')}</span>
        <select class="select" bind:value={form.event_id} onchange={onEventChange}>
          <option value="">{$_('page.exams.form.noEvent')}</option>
          {#each events as ev (ev.id)}
            <option value={String(ev.id)}>
              {dayjs(ev.date).format('DD.MM.YYYY')} · {ev.title}
            </option>
          {/each}
        </select>
        <span class="text-xs text-surface-600-400">{$_('page.exams.form.eventHint')}</span>
      </label>
    {/if}

    <label class="label md:col-span-2">
      <span>{$_('page.exams.form.title')} *</span>
      <input
        class="input"
        type="text"
        bind:value={form.title}
        required
        placeholder={$_('page.exams.form.titlePlaceholder')}
      />
    </label>

    <label class="label">
      <span>{$_('page.exams.form.date')} *</span>
      <input class="input" type="date" bind:value={form.date} required />
    </label>

    <label class="label">
      <span>{$_('page.exams.form.section')} *</span>
      <select class="select" bind:value={form.section} required disabled={sectionLocked}>
        {#each clubConfig.sections as s (s)}
          <option value={s}>{s}</option>
        {/each}
      </select>
      {#if sectionLocked}
        <span class="text-xs text-surface-600-400">{$_('page.exams.form.sectionLocked')}</span>
      {/if}
    </label>

    <label class="label">
      <span>{$_('page.exams.form.deadline')}</span>
      <input class="input" type="date" bind:value={form.registration_deadline} />
      <span class="text-xs text-surface-600-400">{$_('page.exams.form.deadlineHint')}</span>
    </label>

    <label class="label">
      <span>{$_('page.exams.form.location')}</span>
      <input class="input" type="text" bind:value={form.location} />
    </label>

    <label class="label md:col-span-2">
      <span>{$_('page.exams.form.notes')}</span>
      <textarea
        class="textarea"
        rows="3"
        bind:value={form.notes}
        placeholder={$_('page.exams.form.notesPlaceholder')}
      ></textarea>
      <span class="text-xs text-surface-600-400">{$_('page.exams.form.notesHint')}</span>
    </label>
  </div>

  {#if error}
    <p class="p-3 rounded-lg preset-filled-error-500">{error}</p>
  {/if}

  <div class="flex justify-end gap-2">
    <a href={cancelHref} class="btn preset-tonal-surface">{$_('button.cancel')}</a>
    <button type="submit" class="btn preset-filled-primary-500" disabled={saving}>
      <Fa icon={saving ? faSpinner : faSave} spin={saving} />
      <span>{$_('button.save')}</span>
    </button>
  </div>
</form>
