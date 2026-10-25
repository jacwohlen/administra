<script lang="ts">
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  import LogList from './LogList.svelte';
  import utils from '$lib/utils';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faClock,
    faUsers,
    faClipboardCheck,
    faArrowLeft,
    faEdit,
    faTrash,
    faUserTie
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { toaster } from '$lib/toast';

  let isDeleting = $state(false);
  let showDeleteConfirm = $state(false);

  function getDateString() {
    const weekday = utils.weekdayToNumber(data.weekday);
    return utils.getMostRecentDateByWeekday(weekday).format('YYYY-MM-DD');
  }

  function confirmDelete() {
    showDeleteConfirm = true;
  }

  async function handleDeleteResponse(confirmed: boolean) {
    showDeleteConfirm = false;
    if (!confirmed) return;

    isDeleting = true;
    try {
      // Delete related records first
      await supabaseClient.from('lesson_plans').delete().eq('trainingId', data.id);
      await supabaseClient.from('logs').delete().eq('trainingId', data.id);
      await supabaseClient.from('participants').delete().eq('trainingId', data.id);

      // Delete the training
      const { error } = await supabaseClient.from('trainings').delete().eq('id', data.id);

      if (error) {
        throw error;
      }

      toaster.success({ title: $_('page.trainings.deleteSuccess') });
      await goto('/dashboard/trainings');
    } catch (error) {
      console.error('Error deleting training:', error);
      toaster.error({ title: $_('page.trainings.deleteError') });
    } finally {
      isDeleting = false;
    }
  }
</script>

<!-- Header -->
<div class="page-header-back">
  <a
    href="/dashboard/trainings"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.trainings.backToList')}
    aria-label={$_('page.trainings.backToList')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.title}</h1>
  {#if data.canWrite}
    <div class="flex gap-2 flex-shrink-0">
      <a
        href="/dashboard/trainings/{data.id}/edit"
        class="btn preset-tonal-surface"
        title={$_('button.edit')}
        aria-label={$_('button.edit')}
      >
        <Fa icon={faEdit} />
      </a>
      <MoreMenu>
        {#snippet items(close)}
          <button
            class="btn w-full justify-start text-error-600-400"
            onclick={() => {
              close();
              confirmDelete();
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
<div class="flex items-center gap-2 mb-6 flex-wrap text-sm">
  <span class="chip preset-tonal-secondary">{data.section}</span>
  <span class="text-surface-600-400">{$_('weekday.' + data.weekday)}</span>
  <span class="text-surface-600-400">
    <Fa icon={faClock} size="xs" class="inline mr-1" />{data.dateFrom} – {data.dateTo}
  </span>
  <span class="text-surface-600-400">
    <Fa icon={faUsers} size="xs" class="inline mr-1" />{data.participants.length}
    {$_('page.trainings.participants')}
  </span>
  {#if data.mainTrainer}
    <span class="text-surface-600-400" title={$_('page.trainings.form.main_trainer')}>
      <Fa icon={faUserTie} size="xs" class="inline mr-1" />{data.mainTrainer.firstname}
      {data.mainTrainer.lastname}
    </span>
  {/if}
</div>

<!-- Track Attendance -->
{#if data.canWrite}
  <a
    class="btn preset-filled-primary-500 w-full mb-6"
    href="/dashboard/trainings/{data.id}/{getDateString()}"
  >
    <Fa icon={faClipboardCheck} />
    <span>{$_('button.trackAttendance')}</span>
  </a>
{/if}

{#if showDeleteConfirm}
  <ConfirmDialog
    title={$_('page.trainings.deleteConfirmTitle')}
    message={`${$_('page.trainings.deleteConfirmMessage')} "${data.title}"?`}
    confirmLabel={$_('button.delete')}
    oncancel={() => handleDeleteResponse(false)}
    onconfirm={() => handleDeleteResponse(true)}
  />
{/if}

<!-- Logs section -->
<h3>{$_('page.trainings.logs')}</h3>
<LogList trainingId={data.id} />
