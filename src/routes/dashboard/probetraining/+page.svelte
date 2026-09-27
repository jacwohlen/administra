<script lang="ts">
  import type { PageData } from './$types';
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faUserPlus,
    faEnvelope,
    faPhone,
    faTriangleExclamation,
    faCalendarPlus,
    faChevronDown,
    faNoteSticky,
    faHourglassHalf,
    faBan,
    faRotateLeft,
    faSpinner
  } from '@fortawesome/free-solid-svg-icons';
  import { calculateAge } from '$lib/utils';
  import {
    trialProgress,
    matchesTrialTab,
    sortTrialMembers,
    elapsedSince,
    type TrialProgress,
    type TrialTab
  } from '$lib/trialUtils';
  import { clubConfig } from '$lib/clubConfig';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidate } from '$app/navigation';
  import AssignTrainingDialog from './AssignTrainingDialog.svelte';
  import type { TrialMember, TrialStatus, Training, TrainingActivity } from '$lib/models';
  import dayjs from 'dayjs';

  const TABS: TrialTab[] = ['new', 'waitlist', 'assigned', 'convert', 'cancelled', 'all'];

  let { data }: { data: PageData } = $props();

  let selectedMember = $state<TrialMember | null>(null);
  let expandedId = $state<number | null>(null);
  let confirmCancelId = $state<number | null>(null);
  let busyId = $state<number | null>(null);
  let searchTerm = $state('');
  // Open on the work queue; fall back to everyone when nothing new came in.
  let tab = $state<TrialTab>(
    untrack(() => data.trialMembers.some((m) => m.trialStatus === 'new')) ? 'new' : 'all'
  );

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

  let activityByTraining = $derived.by(() => {
    const map = new Map<number, TrainingActivity>();
    for (const a of data.trainingActivity) map.set(Number(a.trainingId), a);
    return map;
  });

  let tabCounts = $derived.by(() => {
    const counts = {} as Record<TrialTab, number>;
    for (const t of TABS) {
      counts[t] = data.trialMembers.filter((m) =>
        matchesTrialTab(m, t, clubConfig.trialSessionThreshold)
      ).length;
    }
    return counts;
  });

  let visibleMembers = $derived.by(() => {
    const q = searchTerm.toLowerCase().trim();
    const matching = data.trialMembers.filter((m) => {
      if (q && !`${m.firstname} ${m.lastname}`.toLowerCase().includes(q)) return false;
      return matchesTrialTab(m, tab, clubConfig.trialSessionThreshold);
    });
    return sortTrialMembers(matching, tab);
  });

  function assignedTrainings(memberId: number): Training[] {
    return (assignmentsByMember.get(memberId) ?? [])
      .map((id) => trainingById.get(id))
      .filter((t): t is Training => t !== undefined);
  }

  function countChipClass(progress: TrialProgress): string {
    return progress === 'convert' ? 'preset-filled-warning-500' : 'preset-tonal-surface';
  }

  const STATUS_CHIP: Record<TrialStatus, string> = {
    new: 'preset-tonal-primary',
    waitlist: 'preset-tonal-warning',
    assigned: 'preset-tonal-success',
    cancelled: 'preset-tonal-surface'
  };

  function ago(iso: string, kind: 'ago' | 'waiting' = 'ago'): string {
    const { unit, count } = elapsedSince(iso);
    return $_(`page.probetraining.${kind}.${unit}`, { values: { count } });
  }

  function toggle(id: number) {
    expandedId = expandedId === id ? null : id;
    confirmCancelId = null;
  }

  async function setStatus(m: TrialMember, status: TrialStatus) {
    busyId = m.id;
    try {
      const { error } = await supabaseClient
        .from('members')
        .update({ trialStatus: status })
        .eq('id', m.id);
      if (error) throw error;
      toaster.success({ title: $_('page.probetraining.statusChanged.' + status) });
      confirmCancelId = null;
      await invalidate('probetraining:list');
    } catch (e) {
      console.error('Error changing trial status:', e);
      toaster.error({ title: $_('page.probetraining.statusError') });
    } finally {
      busyId = null;
    }
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
    <div class="flex gap-1 flex-wrap" role="tablist">
      {#each TABS as t (t)}
        <button
          role="tab"
          aria-selected={tab === t}
          class="btn btn-sm {tab === t ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
          onclick={() => (tab = t)}
        >
          {$_('page.probetraining.tab.' + t)} ({tabCounts[t]})
        </button>
      {/each}
    </div>
  </div>

  {#if visibleMembers.length === 0}
    <p class="empty-state">{$_('page.probetraining.noResults')}</p>
  {:else}
    <ul class="card overflow-hidden">
      {#each visibleMembers as m (m.id)}
        {@const age = calculateAge(m.birthday)}
        {@const assigned = assignedTrainings(m.id)}
        {@const progress = trialProgress(m.attendedCount, clubConfig.trialSessionThreshold)}
        {@const showProgress = m.trialStatus !== 'cancelled' && progress === 'convert'}
        {@const isOpen = expandedId === m.id}
        <li
          class="border-b border-surface-300-700 last:border-b-0 border-l-4 {showProgress
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
              <span class="text-xs text-surface-600-400 flex items-center gap-2 min-w-0">
                {#if tab === 'all' || tab === 'convert'}
                  <span class="chip text-[10px] py-0 px-1.5 {STATUS_CHIP[m.trialStatus]}">
                    {$_('page.probetraining.status.' + m.trialStatus)}
                  </span>
                {/if}
                {#if m.trialRegisteredAt}
                  <span
                    class="truncate"
                    title="{$_('page.probetraining.registeredOn')} {dayjs(
                      m.trialRegisteredAt
                    ).format('DD.MM.YYYY HH:mm')}"
                  >
                    {$_('page.probetraining.registeredAgo', {
                      values: { ago: ago(m.trialRegisteredAt) }
                    })}
                  </span>
                {/if}
              </span>
            </span>

            <span class="hidden sm:flex items-center gap-1 min-w-0 max-w-[38%] flex-shrink-0">
              {#if m.trialStatus === 'waitlist' && m.trialStatusChangedAt}
                <span class="chip preset-tonal-warning text-xs gap-1">
                  <Fa icon={faHourglassHalf} size="xs" />
                  {ago(m.trialStatusChangedAt, 'waiting')}
                </span>
              {:else if m.trialStatus === 'cancelled'}
                <span class="text-xs text-surface-600-400 italic">
                  {$_('page.probetraining.status.cancelled')}
                </span>
              {:else if assigned.length === 0}
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
              class="chip gap-1 flex-shrink-0 text-xs {countChipClass(
                showProgress ? progress : 'none'
              )}"
              title={$_('page.probetraining.attended')}
            >
              {#if showProgress}
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
              {#if showProgress}
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
                    {dayjs(m.trialRegisteredAt).format('DD.MM.YYYY HH:mm')}
                  </span>
                {/if}
                {#if m.trialStatusChangedAt && m.trialStatus !== 'new'}
                  <span>
                    {$_('page.probetraining.statusSince.' + m.trialStatus)}
                    {dayjs(m.trialStatusChangedAt).format('DD.MM.YYYY')}
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
                {#if m.trialStatus === 'cancelled'}
                  <button
                    class="btn btn-sm preset-tonal-surface"
                    disabled={busyId === m.id}
                    onclick={() => setStatus(m, 'new')}
                  >
                    <Fa icon={faRotateLeft} size="xs" />
                    <span>{$_('page.probetraining.action.reactivate')}</span>
                  </button>
                {:else}
                  {#if m.trialStatus === 'new'}
                    <button
                      class="btn btn-sm preset-tonal-warning"
                      disabled={busyId === m.id}
                      onclick={() => setStatus(m, 'waitlist')}
                    >
                      <Fa icon={faHourglassHalf} size="xs" />
                      <span>{$_('page.probetraining.action.waitlist')}</span>
                    </button>
                  {/if}
                  <button
                    class="btn btn-sm preset-tonal-surface"
                    disabled={busyId === m.id}
                    onclick={() => (confirmCancelId = m.id)}
                  >
                    <Fa icon={faBan} size="xs" />
                    <span>{$_('page.probetraining.action.cancel')}</span>
                  </button>
                {/if}
                {#if busyId === m.id}
                  <Fa icon={faSpinner} spin />
                {/if}
                <button
                  class="btn btn-sm preset-tonal-primary ml-auto"
                  disabled={busyId === m.id}
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

              {#if confirmCancelId === m.id}
                <div
                  class="flex flex-wrap items-center gap-2 rounded-md bg-surface-100-900 px-3 py-2"
                  role="alertdialog"
                  aria-label={$_('page.probetraining.action.cancel')}
                >
                  <p class="flex-1 min-w-48 text-xs">
                    {assigned.length
                      ? $_('page.probetraining.cancelConfirmAssigned')
                      : $_('page.probetraining.cancelConfirm')}
                  </p>
                  <button
                    class="btn btn-sm preset-tonal-surface"
                    disabled={busyId === m.id}
                    onclick={() => (confirmCancelId = null)}
                  >
                    {$_('button.cancel')}
                  </button>
                  <button
                    class="btn btn-sm preset-filled-error-500"
                    disabled={busyId === m.id}
                    onclick={() => setStatus(m, 'cancelled')}
                  >
                    {$_('page.probetraining.action.confirmCancel')}
                  </button>
                </div>
              {/if}
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
        {activityByTraining}
        assignedTrainingIds={new Set(assignmentsByMember.get(selectedMember.id) ?? [])}
        onclose={() => (selectedMember = null)}
      />
    </div>
  </div>
{/if}
