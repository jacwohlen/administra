<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faUserPlus,
    faEnvelope,
    faPhone,
    faTriangleExclamation,
    faCalendarPlus,
    faChevronDown,
    faNoteSticky
  } from '@fortawesome/free-solid-svg-icons';
  import { calculateAge } from '$lib/utils';
  import { trialStatus, type TrialStatus } from '$lib/trialUtils';
  import AssignTrainingDialog from './AssignTrainingDialog.svelte';
  import type { TrialMember, Training } from '$lib/models';
  import dayjs from 'dayjs';

  type Filter = 'all' | 'unassigned' | 'convert';

  let { data }: { data: PageData } = $props();

  let selectedMember = $state<TrialMember | null>(null);
  let expandedId = $state<number | null>(null);
  let searchTerm = $state('');
  let filter = $state<Filter>('all');

  let trainingById = $derived.by(() => {
    const map = new Map<number, Training>();
    for (const t of data.trainings) map.set(Number(t.id), t);
    return map;
  });

  let assignmentsByMember = $derived.by(() => {
    const map = new Map<number, number[]>();
    for (const a of data.assignments) {
      const list = map.get(a.memberId) ?? [];
      list.push(a.trainingId);
      map.set(a.memberId, list);
    }
    return map;
  });

  let unassignedCount = $derived(
    data.trialMembers.filter((m) => (assignmentsByMember.get(m.id) ?? []).length === 0).length
  );
  let convertCount = $derived(
    data.trialMembers.filter((m) => trialStatus(m.attendedCount) === 'convert').length
  );

  let visibleMembers = $derived.by(() => {
    const q = searchTerm.toLowerCase().trim();
    return data.trialMembers.filter((m) => {
      if (q && !`${m.firstname} ${m.lastname}`.toLowerCase().includes(q)) return false;
      if (filter === 'unassigned') return (assignmentsByMember.get(m.id) ?? []).length === 0;
      if (filter === 'convert') return trialStatus(m.attendedCount) === 'convert';
      return true;
    });
  });

  function assignedTrainings(memberId: number): Training[] {
    return (assignmentsByMember.get(memberId) ?? [])
      .map((id) => trainingById.get(id))
      .filter((t): t is Training => t !== undefined);
  }

  function countChipClass(status: TrialStatus): string {
    return status === 'convert' ? 'preset-filled-warning-500' : 'preset-tonal-surface';
  }

  function toggle(id: number) {
    expandedId = expandedId === id ? null : id;
  }
</script>

<div class="page-header">
  <h1>{$_('page.probetraining.title')}</h1>
  <a
    href="/probetraining"
    target="_blank"
    rel="noopener"
    class="btn preset-tonal-primary"
    title={$_('page.probetraining.openPublicForm')}
  >
    <Fa icon={faUserPlus} />
    <span class="hidden sm:inline">{$_('page.probetraining.openPublicForm')}</span>
  </a>
</div>

{#if data.trialMembers.length === 0}
  <p class="empty-state">{$_('page.probetraining.empty')}</p>
{:else}
  <div class="flex flex-col sm:flex-row gap-2 mb-3">
    <input
      class="input flex-1"
      bind:value={searchTerm}
      type="search"
      placeholder={$_('page.probetraining.searchPlaceholder')}
    />
    <div class="flex gap-1 flex-wrap">
      <button
        class="btn btn-sm {filter === 'all' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
        onclick={() => (filter = 'all')}
      >
        {$_('page.probetraining.filterAll')} ({data.trialMembers.length})
      </button>
      <button
        class="btn btn-sm {filter === 'unassigned'
          ? 'preset-filled-primary-500'
          : 'preset-tonal-surface'}"
        onclick={() => (filter = 'unassigned')}
      >
        {$_('page.probetraining.filterUnassigned')} ({unassignedCount})
      </button>
      <button
        class="btn btn-sm {filter === 'convert'
          ? 'preset-filled-primary-500'
          : 'preset-tonal-surface'}"
        onclick={() => (filter = 'convert')}
      >
        {$_('page.probetraining.filterConvert')} ({convertCount})
      </button>
    </div>
  </div>

  {#if visibleMembers.length === 0}
    <p class="empty-state">{$_('page.probetraining.noResults')}</p>
  {:else}
    <ul class="card overflow-hidden">
      {#each visibleMembers as m (m.id)}
        {@const age = calculateAge(m.birthday)}
        {@const assigned = assignedTrainings(m.id)}
        {@const status = trialStatus(m.attendedCount)}
        {@const isOpen = expandedId === m.id}
        <li
          class="border-b border-surface-300-700 last:border-b-0 border-l-4 {status === 'convert'
            ? 'border-l-warning-500'
            : 'border-l-transparent'}"
        >
          <button
            type="button"
            class="w-full flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 text-left hover:bg-surface-100-900"
            aria-expanded={isOpen}
            onclick={() => toggle(m.id)}
          >
            <span
              class="size-8 rounded-full bg-surface-100-900 flex items-center justify-center text-xs font-bold flex-shrink-0"
            >
              {m.lastname.charAt(0)}{m.firstname.charAt(0)}
            </span>

            <span class="flex-1 min-w-0">
              <span class="font-semibold truncate block leading-tight">
                {m.lastname}
                {m.firstname}
                {#if age !== null}
                  <span class="font-normal text-surface-600-400 text-xs">· {age} J</span>
                {/if}
                {#if m.notes}
                  <Fa
                    icon={faNoteSticky}
                    size="xs"
                    class="inline text-surface-600-400 ml-1 align-baseline"
                  />
                {/if}
              </span>
            </span>

            <span class="hidden sm:flex items-center gap-1 min-w-0 max-w-[38%] flex-shrink-0">
              {#if assigned.length === 0}
                <span class="text-xs text-surface-600-400 italic">
                  {$_('page.probetraining.noAssignment')}
                </span>
              {:else}
                <span class="chip preset-tonal-secondary text-xs truncate">
                  {assigned[0].title} · {$_('weekdayShort.' + assigned[0].weekday)}
                </span>
                {#if assigned.length > 1}
                  <span class="text-xs text-surface-600-400">+{assigned.length - 1}</span>
                {/if}
              {/if}
            </span>

            <span
              class="chip gap-1 flex-shrink-0 text-xs {countChipClass(status)}"
              title={$_('page.probetraining.attended')}
            >
              {#if status === 'convert'}
                <Fa icon={faTriangleExclamation} size="xs" />
              {/if}
              {m.attendedCount}×
            </span>

            <Fa
              icon={faChevronDown}
              size="xs"
              class="text-surface-600-400 flex-shrink-0 transition-transform {isOpen
                ? 'rotate-180'
                : ''}"
            />
          </button>

          {#if isOpen}
            <div class="px-3 sm:pl-14 pb-3 space-y-2 text-sm">
              {#if status === 'convert'}
                <p class="text-xs text-warning-600-400">
                  {$_('page.probetraining.convertHint')}
                </p>
              {/if}

              <div class="text-xs text-surface-600-400 flex flex-wrap gap-x-3 gap-y-1">
                {#if m.trialSection}
                  <span>{m.trialSection}</span>
                {/if}
                {#if m.trialRegisteredAt}
                  <span>
                    {$_('page.probetraining.registeredOn')}
                    {dayjs(m.trialRegisteredAt).format('DD.MM.YYYY')}
                  </span>
                {/if}
                {#if m.email}
                  <a class="meta-item hover:underline" href="mailto:{m.email}">
                    <Fa icon={faEnvelope} size="xs" />
                    <span class="truncate">{m.email}</span>
                  </a>
                {/if}
                {#if m.mobile}
                  <a class="meta-item hover:underline" href="tel:{m.mobile}">
                    <Fa icon={faPhone} size="xs" />
                    <span>{m.mobile}</span>
                  </a>
                {/if}
              </div>

              {#if m.notes}
                <p
                  class="whitespace-pre-wrap text-surface-700-300 border-l-2 border-surface-300-700 pl-3"
                >
                  {m.notes}
                </p>
              {/if}

              <div class="flex flex-wrap items-center gap-2 pt-1">
                <div class="flex flex-wrap gap-1 sm:hidden">
                  {#if assigned.length === 0}
                    <span class="text-xs text-surface-600-400 italic">
                      {$_('page.probetraining.noAssignment')}
                    </span>
                  {:else}
                    {#each assigned as t (t.id)}
                      <span class="chip preset-tonal-secondary text-xs">
                        {t.title} · {$_('weekdayShort.' + t.weekday)}
                      </span>
                    {/each}
                  {/if}
                </div>
                <a href="/dashboard/members/{m.id}" class="btn btn-sm preset-tonal-surface">
                  {$_('button.view')}
                </a>
                <button
                  class="btn btn-sm preset-tonal-primary ml-auto"
                  onclick={() => (selectedMember = m)}
                >
                  <Fa icon={faCalendarPlus} size="xs" />
                  <span>
                    {assigned.length
                      ? $_('page.probetraining.manageTrainings')
                      : $_('page.probetraining.assignTraining')}
                  </span>
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

{#if selectedMember}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (selectedMember = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') selectedMember = null;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card modal-dialog modal-dialog-lg" onclick={(e) => e.stopPropagation()}>
      <AssignTrainingDialog
        member={selectedMember}
        trainings={data.trainings}
        assignedTrainingIds={new Set(assignmentsByMember.get(selectedMember.id) ?? [])}
        onclose={() => (selectedMember = null)}
      />
    </div>
  </div>
{/if}
