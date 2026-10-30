<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faDownload,
    faPenToSquare,
    faTrash,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import { toaster } from '$lib/toast';
  import {
    ACTIVITY_HEADER,
    ATTENDANCE_HEADER,
    PERSON_HEADER,
    activityRows,
    attendanceRows,
    personRows,
    fileSlug,
    formatDate,
    toCsv,
    type CourseMember
  } from '$lib/jsExport';

  let { data }: { data: PageData } = $props();

  let course = $derived(data.course);
  let result = $derived(data.result);
  let warnings = $derived(result.warnings);
  let hasWarnings = $derived(Object.values(warnings).some((list) => list.length > 0));

  function download(name: string, csv: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}_${fileSlug(course)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPersons(name: string, members: CourseMember[]) {
    download(name, toCsv(PERSON_HEADER, personRows(members)));
  }

  let showDeleteConfirm = $state(false);
  let isDeleting = $state(false);

  async function deleteCourse() {
    showDeleteConfirm = false;
    isDeleting = true;
    const { error } = await supabaseClient.from('js_courses').delete().eq('id', course.id);
    isDeleting = false;
    if (error) {
      console.error('Error deleting J+S course:', error);
      toaster.error({ title: $_('page.js.deleteError') });
      return;
    }
    toaster.success({ title: $_('page.js.delete_success') });
    await goto('/dashboard/js', { invalidateAll: true });
  }

  const names = (members: CourseMember[]) =>
    members.map((m) => `${m.lastname} ${m.firstname}`).join(', ');
</script>

<div class="page-header-back">
  <a
    href="/dashboard/js"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.js.backToList')}
    aria-label={$_('page.js.backToList')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{course.title}</h1>
  {#if data.canWrite}
    <div class="flex gap-2 flex-shrink-0">
      <a
        href="/dashboard/js/{course.id}/edit"
        class="btn preset-tonal-surface"
        title={$_('button.edit')}
        aria-label={$_('button.edit')}
      >
        <Fa icon={faPenToSquare} />
      </a>
      <MoreMenu>
        {#snippet items(close)}
          <button
            class="btn w-full justify-start text-error-600-400"
            onclick={() => {
              close();
              showDeleteConfirm = true;
            }}
            disabled={isDeleting}
          >
            <Fa icon={faTrash} />
            <span>{$_('button.delete')}</span>
          </button>
        {/snippet}
      </MoreMenu>
    </div>
  {/if}
</div>

{#if showDeleteConfirm}
  <ConfirmDialog
    title={$_('page.js.delete_title')}
    message={$_('page.js.delete_message', { values: { title: course.title } })}
    confirmLabel={$_('button.delete')}
    busy={isDeleting}
    oncancel={() => (showDeleteConfirm = false)}
    onconfirm={deleteCourse}
  />
{/if}

<dl class="card p-4 mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
  <dt class="text-surface-600-400">{$_('page.js.form.course_number')}</dt>
  <dd>{course.course_number || '–'}</dd>
  <dt class="text-surface-600-400">{$_('page.js.period')}</dt>
  <dd>{formatDate(course.date_from)} – {formatDate(course.date_to)}</dd>
  <dt class="text-surface-600-400">{$_('page.js.form.location')}</dt>
  <dd>{course.location || '–'}</dd>
  <dt class="text-surface-600-400">{$_('page.js.form.durations')}</dt>
  <dd>{course.durations.join(', ')}</dd>
  <dt class="text-surface-600-400">{$_('page.js.form.trainings')}</dt>
  <dd>{data.trainings.map((t) => t.title).join(', ') || '–'}</dd>
</dl>

<p class="p-3 mb-4 rounded-lg preset-tonal-warning text-sm">{$_('page.js.replace_hint')}</p>

<ol class="space-y-4 mb-6">
  <li class="card p-4">
    <h3>1. {$_('page.js.step_persons')}</h3>
    <p class="text-sm text-surface-600-400 mb-3">
      {$_('page.js.step_persons_hint', {
        values: { participants: result.participants.length, leaders: result.leaders.length }
      })}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        class="btn preset-tonal-primary"
        onclick={() => downloadPersons('personen', result.participants)}
        disabled={result.participants.length === 0}
      >
        <Fa icon={faDownload} />
        <span>{$_('page.js.download_participants')}</span>
      </button>
      <button
        class="btn preset-tonal-primary"
        onclick={() => downloadPersons('personen_leitende', result.leaders)}
        disabled={result.leaders.length === 0}
      >
        <Fa icon={faDownload} />
        <span>{$_('page.js.download_leaders')}</span>
      </button>
    </div>
  </li>

  <li class="card p-4">
    <h3>2. {$_('page.js.step_activities')}</h3>
    <p class="text-sm text-surface-600-400 mb-3">
      {$_('page.js.step_activities_hint', { values: { count: result.activities.length } })}
    </p>
    <button
      class="btn preset-tonal-primary"
      disabled={result.activities.length === 0}
      onclick={() =>
        download(
          'aktivitaeten',
          toCsv(ACTIVITY_HEADER, activityRows(result.activities, course.location))
        )}
    >
      <Fa icon={faDownload} />
      <span>{$_('page.js.download_activities')}</span>
    </button>
  </li>

  <li class="card p-4">
    <h3>3. {$_('page.js.step_attendance')}</h3>
    <p class="text-sm text-surface-600-400 mb-3">
      {$_('page.js.step_attendance_hint', { values: { count: result.attendance.length } })}
    </p>
    <button
      class="btn preset-tonal-primary"
      disabled={result.attendance.length === 0}
      onclick={() =>
        download(
          'anwesenheitskontrolle',
          toCsv(ATTENDANCE_HEADER, attendanceRows(result.attendance, course.location))
        )}
    >
      <Fa icon={faDownload} />
      <span>{$_('page.js.download_attendance')}</span>
    </button>
  </li>
</ol>

{#if hasWarnings}
  <section class="mb-6">
    <h3 class="flex items-center gap-2">
      <Fa icon={faTriangleExclamation} class="text-warning-500" />
      {$_('page.js.warnings')}
    </h3>
    <ul class="list-disc pl-5 space-y-1 text-sm">
      {#if warnings.membersWithoutNumber.length}
        <li>
          {$_('page.js.warning_without_number')}
          {names(warnings.membersWithoutNumber)}
        </li>
      {/if}
      {#if warnings.membersInBothRoles.length}
        <li>{$_('page.js.warning_both_roles')} {names(warnings.membersInBothRoles)}</li>
      {/if}
      {#each warnings.trainingsWithoutTime as training (training.id)}
        <li>{$_('page.js.warning_without_time', { values: { title: training.title } })}</li>
      {/each}
      {#each warnings.trainingsTooShort as { training, minutes } (training.id)}
        <li>
          {$_('page.js.warning_too_short', { values: { title: training.title, minutes } })}
        </li>
      {/each}
      {#each warnings.trainingsShortened as { training, minutes, exported } (training.id)}
        <li>
          {$_('page.js.warning_shortened', {
            values: { title: training.title, minutes, exported }
          })}
        </li>
      {/each}
    </ul>
  </section>
{/if}
