<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faUserPlus, faEnvelope, faPhone } from '@fortawesome/free-solid-svg-icons';
  import { calculateAge } from '$lib/utils';
  import AssignTrainingDialog from './AssignTrainingDialog.svelte';
  import type { TrialMember, Training } from '$lib/models';
  import dayjs from 'dayjs';

  let { data }: { data: PageData } = $props();

  let selectedMember = $state<TrialMember | null>(null);

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

  function assignedTrainingIds(memberId: number): Set<number> {
    return new Set(assignmentsByMember.get(memberId) ?? []);
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
  <ul class="flex flex-col gap-2">
    {#each data.trialMembers as m (m.id)}
      {@const age = calculateAge(m.birthday)}
      {@const assigned = assignmentsByMember.get(m.id) ?? []}
      <li class="card p-3 flex flex-col gap-2">
        <div class="flex items-start gap-3">
          <div class="avatar-initials">
            {m.lastname.charAt(0)}{m.firstname.charAt(0)}
          </div>
          <div class="flex-1 min-w-0">
            <a href="/dashboard/members/{m.id}" class="font-bold block truncate">
              {m.lastname}
              {m.firstname}
            </a>
            <div class="text-xs text-surface-600-400 flex flex-wrap gap-x-3 gap-y-1">
              {#if age !== null}
                <span>{age} {$_('page.probetraining.yearsOld')}</span>
              {/if}
              {#if m.email}
                <span class="meta-item">
                  <Fa icon={faEnvelope} size="xs" />
                  <a href="mailto:{m.email}">{m.email}</a>
                </span>
              {/if}
              {#if m.mobile}
                <span class="meta-item">
                  <Fa icon={faPhone} size="xs" />
                  <a href="tel:{m.mobile}">{m.mobile}</a>
                </span>
              {/if}
            </div>
            {#if m.trialRegisteredAt}
              <div class="text-xs text-surface-600-400 mt-1">
                {$_('page.probetraining.registeredOn')}: {dayjs(m.trialRegisteredAt).format(
                  'DD.MM.YYYY'
                )}
              </div>
            {/if}
          </div>
          <div class="text-right flex-shrink-0">
            <div class="text-2xl font-bold">{m.attendedCount}</div>
            <div class="text-xs text-surface-600-400">
              {$_('page.probetraining.attended')}
            </div>
          </div>
        </div>

        {#if m.notes}
          <p class="text-sm whitespace-pre-wrap text-surface-700-300">{m.notes}</p>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          {#if assigned.length === 0}
            <span class="chip preset-tonal-warning text-xs">
              {$_('page.probetraining.noAssignment')}
            </span>
          {:else}
            {#each assigned as tId}
              {@const t = trainingById.get(tId)}
              {#if t}
                <span class="chip preset-tonal-secondary text-xs">
                  {t.title} · {$_('weekday.' + t.weekday)}
                </span>
              {/if}
            {/each}
          {/if}
          <button
            class="btn btn-sm preset-filled-primary-500 ml-auto"
            onclick={() => openAssign(m)}
          >
            {$_('page.probetraining.assignTraining')}
          </button>
        </div>
      </li>
    {/each}
  </ul>
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
