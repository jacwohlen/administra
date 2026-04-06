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
    faTrash,
    faEllipsisVertical
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { toaster } from '$lib/toast';

  let isDeleting = $state(false);
  let showDeleteConfirm = $state(false);
  let menuOpen = $state(false);
  let menuStyle = $state('');
  let menuBtnEl: HTMLButtonElement;

  function toggleMenu() {
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    const rect = menuBtnEl.getBoundingClientRect();
    const top = rect.bottom + 4;
    const left = rect.right - 192;
    menuStyle = `position:fixed;top:${top}px;left:${left}px;z-index:9999;`;
    menuOpen = true;
  }

  function handleWindowClick(e: MouseEvent) {
    if (menuOpen && menuBtnEl && !menuBtnEl.contains(e.target as Node)) {
      menuOpen = false;
    }
  }

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

<svelte:window onclick={handleWindowClick} />

<!-- Header -->
<div class="page-header-back">
  <a href="/dashboard/trainings" class="btn preset-tonal-surface flex-shrink-0">
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{data.title}</h1>
  <div class="flex gap-2 flex-shrink-0">
    <a href="/dashboard/trainings/{data.id}/edit" class="btn preset-tonal-surface">
      <Fa icon={faEdit} />
    </a>
    <div class="relative">
      <button class="btn preset-tonal-surface" bind:this={menuBtnEl} onclick={toggleMenu}>
        <Fa icon={faEllipsisVertical} />
      </button>
      {#if menuOpen}
        <nav
          class="card min-w-48 p-1 shadow-xl bg-surface-50-950 border border-surface-300-700"
          style={menuStyle}
        >
          <button
            class="btn w-full justify-start text-error-600-400"
            onclick={() => {
              menuOpen = false;
              confirmDelete();
            }}
            disabled={isDeleting}
          >
            <Fa icon={faTrash} />
            <span>{$_('button.delete')}</span>
          </button>
        </nav>
      {/if}
    </div>
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

<!-- Track Attendance -->
<a
  class="btn preset-filled-primary-500 w-full mb-6"
  href="/dashboard/trainings/{data.id}/{getDateString()}"
>
  <Fa icon={faClipboardCheck} />
  <span>{$_('button.trackAttendance')}</span>
</a>

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
