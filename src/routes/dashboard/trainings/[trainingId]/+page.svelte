<script lang="ts">
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
    faTrash
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
  <a href="/dashboard/trainings" class="btn preset-tonal-surface flex-shrink-0">
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.title}</h1>
  <div class="flex gap-2 flex-shrink-0">
    <a class="btn preset-tonal-primary" href="/dashboard/trainings/{data.id}/{getDateString()}">
      <Fa icon={faClipboardCheck} />
      <span class="hidden sm:inline">{$_('button.trackAttendance')}</span>
    </a>
    <a href="/dashboard/trainings/{data.id}/edit" class="btn preset-tonal-surface">
      <Fa icon={faEdit} />
    </a>
    <button class="btn preset-tonal-error" onclick={confirmDelete} disabled={isDeleting}>
      <Fa icon={faTrash} />
    </button>
  </div>
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
</div>

{#if showDeleteConfirm}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => handleDeleteResponse(false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') handleDeleteResponse(false);
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('page.trainings.deleteConfirmTitle')}</h3>
      <p class="mb-4">{$_('page.trainings.deleteConfirmMessage')} "{data.title}"?</p>
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

<!-- Logs section -->
<h3>{$_('page.trainings.logs')}</h3>
<LogList trainingId={data.id} />
