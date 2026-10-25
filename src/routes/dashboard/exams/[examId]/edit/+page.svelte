<script lang="ts">
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
  <a
    href="/dashboard/exams/{data.exam.id}"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.exams.backToDay')}
    aria-label={$_('page.exams.backToDay')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{$_('page.exams.edit')}</h1>
  <button
    class="btn preset-tonal-error flex-shrink-0"
    title={$_('button.delete')}
    aria-label={$_('button.delete')}
    onclick={() => (confirmDelete = true)}
    disabled={deleting}
  >
    <Fa icon={faTrash} />
  </button>
</div>

<ExamForm
  exam={data.exam}
  events={data.events}
  sectionLocked={data.sectionLocked}
  cancelHref="/dashboard/exams/{data.exam.id}"
  onsaved={async (id) => {
    await invalidate('app:exam');
    await goto(`/dashboard/exams/${id}`);
  }}
/>

{#if confirmDelete}
  <ConfirmDialog
    title={$_('dialog.confirm.title')}
    message={$_('page.exams.deleteConfirm', { values: { title: data.exam.title } })}
    confirmLabel={$_('button.delete')}
    busy={deleting}
    oncancel={() => (confirmDelete = false)}
    onconfirm={remove}
  />
{/if}
