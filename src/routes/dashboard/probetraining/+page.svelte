<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faUserPlus,
    faEnvelope,
    faPhone,
    faTriangleExclamation,
    faCalendarPlus
  } from '@fortawesome/free-solid-svg-icons';
  import { calculateAge } from '$lib/utils';
  import { trialStatus, type TrialStatus } from '$lib/trialUtils';
  import AssignTrainingDialog from './AssignTrainingDialog.svelte';
  import type { TrialMember, Training } from '$lib/models';
  import dayjs from 'dayjs';

  type Filter = 'all' | 'unassigned' | 'convert';

  let { data }: { data: PageData } = $props();

  let selectedMember = $state<TrialMember | null>(null);
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

  function assignedTrainingIds(memberId: number): Set<number> {
    return new Set(assignmentsByMember.get(memberId) ?? []);
  }

  function countChipClass(status: TrialStatus): string {
    return status === 'convert' ? 'preset-filled-warning-500' : 'preset-tonal-surface';
  }

  function openAssign(m: TrialMember) {
    selectedMember = m;
  }

  function closeAssign() {
    selectedMember = null;
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

<p class="text-sm text-surface-600-400 mb-4">{$_('page.probetraining.description')}</p>

{#if data.trialMembers.length === 0}
  <p class="empty-state">{$_('page.probetraining.empty')}</p>
{:else}
  <div class="flex flex-col sm:flex-row gap-2 mb-4">
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
    <ul class="flex flex-col gap-3">
      {#each visibleMembers as m (m.id)}
        {@const age = calculateAge(m.birthday)}
        {@const assigned = assignmentsByMember.get(m.id) ?? []}
        {@const status = trialStatus(m.attendedCount)}
        <li
          class="card p-4 flex flex-col gap-3 {status === 'convert'
            ? 'border-l-4 border-warning-500'
            : ''}"
        >
          <div class="flex items-start gap-3">
            <div class="avatar-initials">
              {m.lastname.charAt(0)}{m.firstname.charAt(0)}
            </div>

            <div class="flex-1 min-w-0">
              <a href="/dashboard/members/{m.id}" class="font-bold truncate block hover:underline">
                {m.lastname}
                {m.firstname}
              </a>
              <div
                class="text-xs text-surface-600-400 flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5"
              >
                {#if age !== null}
                  <span>{age} {$_('page.probetraining.yearsOld')}</span>
                {/if}
                {#if m.trialSection}
                  <span aria-hidden="true">·</span>
                  <span>{m.trialSection}</span>
                {/if}
                {#if m.trialRegisteredAt}
                  <span aria-hidden="true">·</span>
                  <span>
                    {$_('page.probetraining.registeredOn')}
                    {dayjs(m.trialRegisteredAt).format('DD.MM.YYYY')}
                  </span>
                {/if}
              </div>
              <div class="text-xs flex flex-wrap gap-x-3 gap-y-1 mt-1">
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
            </div>

            <span
              class="chip flex-shrink-0 gap-1 whitespace-nowrap {countChipClass(status)}"
              title={$_('page.probetraining.attended')}
            >
              {#if status === 'convert'}
                <Fa icon={faTriangleExclamation} size="xs" />
              {/if}
              {m.attendedCount}
              {$_('page.probetraining.sessionsShort')}
            </span>
          </div>

          {#if status === 'convert'}
            <p class="text-xs text-warning-600-400">{$_('page.probetraining.convertHint')}</p>
          {/if}

          {#if m.notes}
            <p
              class="text-sm whitespace-pre-wrap text-surface-700-300 border-l-2 border-surface-300-700 pl-3"
            >
              {m.notes}
            </p>
          {/if}

          <div class="flex flex-wrap items-center gap-2">
            {#if assigned.length === 0}
              <span class="text-xs text-surface-600-400">
                {$_('page.probetraining.noAssignment')}
              </span>
            {:else}
              {#each assigned as tId (tId)}
                {@const t = trainingById.get(tId)}
                {#if t}
                  <span class="chip preset-tonal-secondary text-xs">
                    {t.title} · {$_('weekdayShort.' + t.weekday)}
                  </span>
                {/if}
              {/each}
            {/if}
            <button class="btn btn-sm preset-tonal-primary ml-auto" onclick={() => openAssign(m)}>
              <Fa icon={faCalendarPlus} size="xs" />
              <span>
                {assigned.length
                  ? $_('page.probetraining.manageTrainings')
                  : $_('page.probetraining.assignTraining')}
              </span>
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

{#if selectedMember}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={closeAssign}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeAssign();
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card modal-dialog modal-dialog-lg" onclick={(e) => e.stopPropagation()}>
      <AssignTrainingDialog
        member={selectedMember}
        trainings={data.trainings}
        assignedTrainingIds={assignedTrainingIds(selectedMember.id)}
        onclose={closeAssign}
      />
    </div>
  </div>
{/if}
