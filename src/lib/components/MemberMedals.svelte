<script lang="ts">
  import type { Medal, MemberMedal, PastEvent } from '$lib/models';
  import { MEDALS, medalEmoji, medalTally, sortMedals } from '$lib/gradeUtils';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import MedalTally from './MedalTally.svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faSpinner, faTrash } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { _ } from 'svelte-i18n';

  let {
    memberId,
    medals,
    events = [],
    sections = [],
    onchanged
  }: {
    memberId: number;
    medals: MemberMedal[];
    events?: PastEvent[];
    sections?: string[];
    onchanged?: () => void;
  } = $props();

  let sorted = $derived(sortMedals(medals));
  let tally = $derived(medalTally(medals));

  let showAdd = $state(false);
  let saving = $state(false);
  let confirmDeleteId: number | null = $state(null);
  let form = $state({
    eventId: '' as string,
    competition: '',
    date: '',
    section: '',
    medal: 'gold' as Medal,
    category: ''
  });

  function formatDate(date: string): string {
    return dayjs(date).format('DD.MM.YYYY');
  }

  function openAdd() {
    form = {
      eventId: '',
      competition: '',
      date: dayjs().format('YYYY-MM-DD'),
      section: sections[0] ?? '',
      medal: 'gold',
      category: ''
    };
    showAdd = true;
  }

  /** Picking an event fills in what the event already knows. */
  function onEventChange() {
    const ev = events.find((e) => String(e.id) === form.eventId);
    if (!ev) return;
    form.competition = ev.title;
    form.date = ev.date;
    if (ev.section) form.section = ev.section;
  }

  async function save() {
    if (!form.competition.trim() || !form.date) return;
    saving = true;
    const { error } = await supabaseClient.from('member_medals').insert({
      memberId,
      eventId: form.eventId ? parseInt(form.eventId) : null,
      competition: form.competition.trim(),
      date: form.date,
      section: form.section.trim() || null,
      medal: form.medal,
      category: form.category.trim() || null
    });
    saving = false;
    if (error) {
      console.error('Error saving medal:', error);
      toaster.error({ title: $_('medals.saveError') });
      return;
    }
    toaster.success({ title: $_('medals.saveSuccess') });
    showAdd = false;
    onchanged?.();
  }

  async function remove(id: number) {
    confirmDeleteId = null;
    const { error } = await supabaseClient.from('member_medals').delete().eq('id', id);
    if (error) {
      console.error('Error removing medal:', error);
      toaster.error({ title: $_('medals.deleteError') });
      return;
    }
    toaster.success({ title: $_('medals.deleteSuccess') });
    onchanged?.();
  }
</script>

<div class="flex justify-between items-center mb-3">
  <h3>{$_('medals.title')}</h3>
  <button class="btn preset-tonal-primary text-sm" onclick={openAdd}>
    <Fa icon={faPlus} />
    <span>{$_('medals.addMedal')}</span>
  </button>
</div>

{#if sorted.length === 0}
  <p class="text-surface-600-400">{$_('medals.noMedals')}</p>
{:else}
  <div class="mb-2">
    <MedalTally {tally} />
  </div>
  <div class="divide-y divide-surface-300-700">
    {#each sorted as m (m.id)}
      <div class="flex items-center gap-3 py-2">
        <span class="text-2xl leading-none flex-none">{medalEmoji(m.medal)}</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold truncate">{m.competition}</div>
          <div class="text-xs text-surface-600-400 truncate">
            {[m.section, m.category].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span class="text-xs text-surface-600-400 flex-none">{formatDate(m.date)}</span>
        <button
          class="p-1 text-surface-600-400 hover:text-error-600-400 flex-none"
          title={$_('button.remove')}
          onclick={() => (confirmDeleteId = m.id)}
        >
          <Fa icon={faTrash} size="xs" />
        </button>
      </div>
    {/each}
  </div>
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
      <h3>{$_('medals.addMedal')}</h3>
      <form class="space-y-4" onsubmit={(e) => e.preventDefault()}>
        {#if events.length > 0}
          <label class="label">
            <span>{$_('medals.fromEvent')}</span>
            <select class="select" bind:value={form.eventId} onchange={onEventChange}>
              <option value="">{$_('medals.noEvent')}</option>
              {#each events as ev (ev.id)}
                <option value={String(ev.id)}>{formatDate(ev.date)} · {ev.title}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="label">
          <span>{$_('medals.competition')}</span>
          <input class="input" type="text" bind:value={form.competition} required />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="label">
            <span>{$_('medals.date')}</span>
            <input class="input" type="date" bind:value={form.date} required />
          </label>
          <label class="label">
            <span>{$_('medals.section')}</span>
            <input class="input" type="text" bind:value={form.section} list="medal-sections" />
            <datalist id="medal-sections">
              {#each sections as s (s)}
                <option value={s}></option>
              {/each}
            </datalist>
          </label>
        </div>
        <div class="label">
          <span>{$_('medals.medal')}</span>
          <div class="grid grid-cols-3 gap-2">
            {#each MEDALS as m (m)}
              <button
                type="button"
                class="btn {form.medal === m
                  ? 'preset-filled-primary-500'
                  : 'preset-tonal-surface'}"
                onclick={() => (form.medal = m)}
              >
                <span>{medalEmoji(m)}</span>
                <span>{$_('medals.' + m)}</span>
              </button>
            {/each}
          </div>
        </div>
        <label class="label">
          <span>{$_('medals.category')}</span>
          <input
            class="input"
            type="text"
            bind:value={form.category}
            placeholder={$_('medals.categoryPlaceholder')}
          />
        </label>
      </form>
      <footer class="flex justify-end gap-2 mt-4">
        <button class="btn preset-tonal-surface" onclick={() => (showAdd = false)}>
          {$_('button.cancel')}
        </button>
        <button
          class="btn preset-filled-primary-500"
          disabled={saving || !form.competition.trim() || !form.date}
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
      <p class="mb-4">{$_('medals.deleteConfirm')}</p>
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
