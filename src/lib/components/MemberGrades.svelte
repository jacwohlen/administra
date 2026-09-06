<script lang="ts">
  import type { GradeDefinition, MemberCurrentGrade, MemberGrade } from '$lib/models';
  import { gradesBySection } from '$lib/gradeUtils';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import BeltStrip from './BeltStrip.svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faSpinner, faTrash } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { _ } from 'svelte-i18n';

  let {
    memberId,
    current,
    history,
    definitions,
    onchanged
  }: {
    memberId: number;
    current: MemberCurrentGrade[];
    history: MemberGrade[];
    definitions: GradeDefinition[];
    onchanged?: () => void;
  } = $props();

  let ladders = $derived(gradesBySection(definitions));
  let sections = $derived([...ladders.keys()]);
  let historySorted = $derived([...history].sort((a, b) => b.examDate.localeCompare(a.examDate)));

  let showAdd = $state(false);
  let saving = $state(false);
  let confirmDeleteId: number | null = $state(null);
  let form = $state({ section: '', grade: '', examDate: '', note: '' });

  let gradeOptions = $derived(ladders.get(form.section) ?? []);

  function definitionOf(section: string, grade: string): GradeDefinition | undefined {
    return definitions.find((d) => d.section === section && d.grade === grade);
  }

  function formatDate(date: string): string {
    return dayjs(date).format('DD.MM.YYYY');
  }

  /** Suggest the next grade on the ladder for the section the member trains most recently. */
  function openAdd() {
    const section = current[0]?.section ?? sections[0] ?? '';
    const known = current.find((g) => g.section === section);
    form = {
      section,
      grade: known?.nextGrade ?? ladders.get(section)?.[0]?.grade ?? '',
      examDate: dayjs().format('YYYY-MM-DD'),
      note: ''
    };
    showAdd = true;
  }

  function onSectionChange() {
    const known = current.find((g) => g.section === form.section);
    form.grade = known?.nextGrade ?? ladders.get(form.section)?.[0]?.grade ?? '';
  }

  async function save() {
    if (!form.section || !form.grade || !form.examDate) return;
    saving = true;
    const { error } = await supabaseClient.from('member_grades').insert({
      memberId,
      section: form.section,
      grade: form.grade,
      examDate: form.examDate,
      note: form.note.trim() || null
    });
    saving = false;
    if (error) {
      console.error('Error saving grading:', error);
      toaster.error({ title: $_('grades.saveError') });
      return;
    }
    toaster.success({ title: $_('grades.saveSuccess') });
    showAdd = false;
    onchanged?.();
  }

  async function remove(id: number) {
    confirmDeleteId = null;
    const { error } = await supabaseClient.from('member_grades').delete().eq('id', id);
    if (error) {
      console.error('Error removing grading:', error);
      toaster.error({ title: $_('grades.deleteError') });
      return;
    }
    toaster.success({ title: $_('grades.deleteSuccess') });
    onchanged?.();
  }
</script>

<div class="flex justify-between items-center mb-3">
  <h3>{$_('grades.title')}</h3>
  <button
    class="btn preset-tonal-primary text-sm"
    onclick={openAdd}
    disabled={sections.length === 0}
  >
    <Fa icon={faPlus} />
    <span>{$_('grades.addGrading')}</span>
  </button>
</div>

{#if current.length === 0}
  <p class="text-surface-600-400">{$_('grades.noGrades')}</p>
{:else}
  <div class="divide-y divide-surface-300-700">
    {#each current as g (g.section)}
      <div class="flex items-center gap-3 py-2">
        <BeltStrip color={g.beltColor} isDan={g.isDan} size="lg" title={g.grade} />
        <div class="flex-1 min-w-0">
          <p class="text-sm text-surface-600-400">{g.section}</p>
          <div class="font-semibold leading-tight">{g.grade}</div>
          <div class="text-xs text-surface-600-400">
            {$_('grades.examDate')}
            {formatDate(g.examDate)}
          </div>
        </div>
        {#if g.nextGrade}
          <div class="text-xs text-right font-semibold text-primary-500 flex-none leading-tight">
            {$_('grades.next')}<br />{g.nextGrade}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if historySorted.length > 0}
  <p class="text-sm font-medium text-surface-600-400 mt-4 mb-1.5">{$_('grades.history')}</p>
  <ul class="space-y-1.5 border-l-2 border-surface-300-700 pl-3">
    {#each historySorted as h (h.id)}
      {@const d = definitionOf(h.section, h.grade)}
      <li class="flex items-center gap-2 text-sm">
        <BeltStrip color={d?.beltColor ?? '#999'} isDan={d?.isDan ?? false} size="sm" />
        <span class="font-semibold">{h.grade}</span>
        <span class="text-surface-600-400 truncate">{h.section} · {formatDate(h.examDate)}</span>
        {#if h.note}
          <span class="text-surface-600-400 truncate hidden sm:inline">· {h.note}</span>
        {/if}
        <button
          class="ml-auto p-1 text-surface-600-400 hover:text-error-600-400"
          title={$_('button.remove')}
          onclick={() => (confirmDeleteId = h.id)}
        >
          <Fa icon={faTrash} size="xs" />
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if showAdd}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (showAdd = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showAdd = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('grades.addGrading')}</h3>
      <form class="space-y-4" onsubmit={(e) => e.preventDefault()}>
        <label class="label">
          <span>{$_('grades.section')}</span>
          <select class="select" bind:value={form.section} onchange={onSectionChange}>
            {#each sections as s (s)}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>
        <label class="label">
          <span>{$_('grades.grade')}</span>
          <select class="select" bind:value={form.grade}>
            {#each gradeOptions as g (g.grade)}
              <option value={g.grade}>{g.grade}</option>
            {/each}
          </select>
        </label>
        <label class="label">
          <span>{$_('grades.examDate')}</span>
          <input class="input" type="date" bind:value={form.examDate} required />
        </label>
        <label class="label">
          <span>{$_('grades.note')}</span>
          <input class="input" type="text" bind:value={form.note} />
        </label>
      </form>
      <footer class="flex justify-end gap-2 mt-4">
        <button class="btn preset-tonal-surface" onclick={() => (showAdd = false)}>
          {$_('button.cancel')}
        </button>
        <button
          class="btn preset-filled-primary-500"
          disabled={saving || !form.section || !form.grade || !form.examDate}
          onclick={save}
        >
          {#if saving}
            <Fa icon={faSpinner} spin />
          {:else}
            {$_('button.save')}
          {/if}
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if confirmDeleteId !== null}
  {@const id = confirmDeleteId}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (confirmDeleteId = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirmDeleteId = null;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>{$_('dialog.confirm.title')}</h3>
      <p class="mb-4">{$_('grades.deleteConfirm')}</p>
      <div class="flex justify-end gap-2">
        <button class="btn preset-tonal-surface" onclick={() => (confirmDeleteId = null)}>
          {$_('button.cancel')}
        </button>
        <button class="btn preset-filled-error-500" onclick={() => remove(id)}>
          {$_('button.delete')}
        </button>
      </div>
    </div>
  </div>
{/if}
