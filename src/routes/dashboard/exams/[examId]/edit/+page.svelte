<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import ExamForm from '../../ExamForm.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let confirmDelete = $state(false);
  let deleting = $state(false);

  async function remove() {
    deleting = true;
    const { error } = await supabaseClient.from('exams').delete().eq('id', data.exam.id);
    deleting = false;
    confirmDelete = false;
    if (error) {
      console.error('Error deleting exam:', error);
      toaster.error({ title: $_('page.exams.deleteError') });
      return;
    }
    toaster.success({ title: $_('page.exams.deleteSuccess') });
    await goto('/dashboard/exams');
  }
</script>

<div class="page-header-back">
  <a href="/dashboard/exams/{data.exam.id}" class="btn preset-tonal-surface flex-shrink-0">
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{$_('page.exams.edit')}</h1>
  <button class="btn preset-tonal-error" onclick={() => (confirmDelete = true)} disabled={deleting}>
    <Fa icon={faTrash} />
  </button>
</div>

<ExamForm
  exam={data.exam}
  events={data.events}
  cancelHref="/dashboard/exams/{data.exam.id}"
  onsaved={async (id) => {
    await invalidate('app:exam');
    await goto(`/dashboard/exams/${id}`);
  }}
/>

{#if confirmDelete}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (confirmDelete = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirmDelete = false;
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('dialog.confirm.title')}</h3>
      <p class="mb-4">{$_('page.exams.deleteConfirm', { values: { title: data.exam.title } })}</p>
      <div class="flex justify-end gap-2">
        <button class="btn preset-tonal-surface" onclick={() => (confirmDelete = false)}>
          {$_('button.cancel')}
        </button>
        <button class="btn preset-filled-error-500" onclick={remove} disabled={deleting}>
          {$_('button.delete')}
        </button>
      </div>
    </div>
  </div>
{/if}
