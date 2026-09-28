<script lang="ts">
  import type { PageData } from './$types';
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faUserPlus,
    faEnvelope,
    faPhone,
    faCakeCandles,
    faTriangleExclamation,
    faCalendarPlus,
    faCalendarCheck,
    faChevronDown,
    faNoteSticky,
    faHourglassHalf,
    faInbox,
    faUserCheck,
    faMagnifyingGlass,
    faBan,
    faRotateLeft,
    faSpinner,
    faPaperPlane,
    faLink
  } from '@fortawesome/free-solid-svg-icons';
  import { calculateAge } from '$lib/utils';
  import {
    trialProgress,
    matchesTrialTab,
    sortTrialMembers,
    elapsedSince,
    type TrialTab
  } from '$lib/trialUtils';
  import { clubConfig } from '$lib/clubConfig';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidate } from '$app/navigation';
  import AssignTrainingDialog from './AssignTrainingDialog.svelte';
  import MailDialog from './MailDialog.svelte';
  import { trialStatusUrl, type TrialMailKind } from '$lib/trialMail';
  import type {
    TrialEmail,
    TrialMember,
    TrialStatus,
    Training,
    TrainingActivity
  } from '$lib/models';
  import dayjs from 'dayjs';

  const TABS: TrialTab[] = ['new', 'waitlist', 'assigned', 'convert', 'cancelled', 'all'];

  /** The work queues get a tile each; 'cancelled' and 'all' are secondary filters. */
  const TILES = [
    { tab: 'new', icon: faInbox, badge: 'bg-primary-500/15 text-primary-700-300' },
    { tab: 'waitlist', icon: faHourglassHalf, badge: 'bg-warning-500/20 text-warning-800-200' },
    { tab: 'assigned', icon: faCalendarCheck, badge: 'bg-success-500/20 text-success-800-200' },
    { tab: 'convert', icon: faUserCheck, badge: 'bg-tertiary-500/20 text-tertiary-800-200' }
  ] as const;

  /** Per status: avatar tint, status dot and chip. */
  const STATUS_STYLE: Record<TrialStatus, { avatar: string; dot: string; chip: string }> = {
    new: {
      avatar: 'bg-primary-500/15 text-primary-700-300',
      dot: 'bg-primary-500',
      chip: 'preset-tonal-primary'
    },
    waitlist: {
      avatar: 'bg-warning-500/20 text-warning-800-200',
      dot: 'bg-warning-500',
      chip: 'preset-tonal-warning'
    },
    assigned: {
      avatar: 'bg-success-500/20 text-success-800-200',
      dot: 'bg-success-500',
      chip: 'preset-tonal-success'
    },
    cancelled: {
      avatar: 'bg-surface-200-800 text-surface-600-400',
      dot: 'bg-surface-400-600',
      chip: 'preset-tonal-surface'
    }
  };

  let { data }: { data: PageData } = $props();

  let selectedMember = $state<TrialMember | null>(null);
  /** Mail preview to show; opened after a status change or from the row. */
  let mailRequest = $state<{ member: TrialMember; kind: TrialMailKind } | null>(null);
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

  let emailsByMember = $derived.by(() => {
    const map = new Map<number, TrialEmail[]>();
    for (const e of data.emails) {
      const list = map.get(e.member_id) ?? [];
      list.push(e);
      map.set(e.member_id, list);
    }
    return map;
  });

  const MAIL_STATUS_CHIP: Record<TrialEmail['status'], string> = {
    sent: 'preset-tonal-success',
    pending: 'preset-tonal-surface',
    skipped: 'preset-tonal-warning',
    failed: 'preset-tonal-error'
  };

  async function copyStatusLink(m: TrialMember) {
    try {
      await navigator.clipboard.writeText(trialStatusUrl(window.location.origin, m.trialToken));
      toaster.success({ title: $_('page.probetraining.statusLink.copied') });
    } catch {
      toaster.error({ title: $_('page.probetraining.statusLink.copyError') });
    }
  }

  /** Status label, telling self-cancellations apart. */
  function statusLabel(m: TrialMember): string {
    return m.trialStatus === 'cancelled' && m.trialSelfCancelled
      ? $_('page.probetraining.status.selfCancelled')
      : $_('page.probetraining.status.' + m.trialStatus);
  }

  /** The mail that fits the candidate's status. */
  function defaultMailKind(m: TrialMember): TrialMailKind {
    if (m.trialStatus === 'assigned') return 'assigned';
    if (m.trialStatus === 'waitlist') return 'waitlist';
    return 'welcome';
  }

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

  /** Newest registration, longest wait: a hint under the tile's count. */
  let tileHints = $derived.by(() => {
    const hints: Partial<Record<TrialTab, string>> = {};
    const fresh = data.trialMembers
      .filter((m) => m.trialStatus === 'new' && m.trialRegisteredAt)
      .map((m) => m.trialRegisteredAt as string)
      .sort()
      .at(-1);
    if (fresh) hints.new = $_('page.probetraining.hint.newest', { values: { ago: ago(fresh) } });
    const waiting = data.trialMembers
      .filter((m) => m.trialStatus === 'waitlist' && m.trialStatusChangedAt)
      .map((m) => m.trialStatusChangedAt as string)
      .sort()
      .at(0);
    if (waiting) {
      hints.waitlist = $_('page.probetraining.hint.longest', {
        values: { since: ago(waiting, 'waiting') }
      });
    }
    hints.convert = $_('page.probetraining.hint.convert', {
      values: { count: clubConfig.trialSessionThreshold }
    });
    return hints;
  });

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
      // Offer the waiting-list notice; it only goes out after the preview.
      if (status === 'waitlist' && m.email) mailRequest = { member: m, kind: 'waitlist' };
    } catch (e) {
      console.error('Error changing trial status:', e);
      toaster.error({ title: $_('page.probetraining.statusError') });
    } finally {
      busyId = null;
    }
  }
</script>

<div class="page-header">
  <div class="min-w-0">
    <h1>{$_('page.probetraining.title')}</h1>
    <p class="text-sm text-surface-600-400">{$_('page.probetraining.subtitle')}</p>
  </div>
  <a
    href="/probetraining"
    target="_blank"
    rel="noopener"
    class="btn preset-tonal-primary flex-shrink-0"
    title={$_('page.probetraining.openPublicForm')}
  >
    <Fa icon={faUserPlus} />
    <span class="hidden sm:inline">{$_('page.probetraining.openPublicForm')}</span>
  </a>
</div>

{#if data.trialMembers.length === 0}
  <section
    class="card border border-surface-200-800 p-8 flex flex-col items-center gap-3 text-center"
  >
    <div class="entity-badge size-14! rounded-full! text-xl text-primary-600-400">
      <Fa icon={faInbox} />
    </div>
    <p class="text-surface-600-400">{$_('page.probetraining.empty')}</p>
  </section>
{:else}
  <!-- Work queues -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3" role="tablist">
    {#each TILES as tile (tile.tab)}
      {@const active = tab === tile.tab}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        class="card border p-3 flex items-start gap-3 min-w-0 text-left transition-colors {active
          ? 'border-primary-500 bg-primary-500/5 ring-1 ring-primary-500'
          : 'border-surface-200-800 hover:bg-surface-100-900'}"
        onclick={() => (tab = tile.tab)}
      >
        <span
          class="hidden sm:flex size-10 rounded-md items-center justify-center flex-shrink-0 {tile.badge}"
        >
          <Fa icon={tile.icon} />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold leading-tight">
            {$_('page.probetraining.tab.' + tile.tab)}
          </span>
          <span class="block text-2xl font-bold tabular-nums leading-tight">
            {tabCounts[tile.tab]}
          </span>
          <span class="block text-xs text-surface-600-400 leading-snug">
            {tileHints[tile.tab] ?? '\u00a0'}
          </span>
        </span>
      </button>
    {/each}
  </div>

  <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
    <label class="relative flex-1">
      <span class="sr-only">{$_('page.probetraining.searchPlaceholder')}</span>
      <Fa
        icon={faMagnifyingGlass}
        size="sm"
        class="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none"
      />
      <input
        class="input pl-9"
        bind:value={searchTerm}
        type="search"
        placeholder={$_('page.probetraining.searchPlaceholder')}
      />
    </label>
    <div class="flex gap-1" role="tablist">
      {#each ['cancelled', 'all'] as const as t (t)}
        <button
          role="tab"
          aria-selected={tab === t}
          class="btn btn-sm {tab === t ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
          onclick={() => (tab = t)}
        >
          {$_('page.probetraining.tab.' + t)}
          <span class="tabular-nums opacity-70">{tabCounts[t]}</span>
        </button>
      {/each}
    </div>
  </div>

  {#if visibleMembers.length === 0}
    <section
      class="card border border-dashed border-surface-300-700 p-8 flex flex-col items-center gap-2 text-center"
    >
      <p class="font-semibold">
        {searchTerm.trim()
          ? $_('page.probetraining.noResults')
          : $_('page.probetraining.emptyTab.' + tab)}
      </p>
    </section>
  {:else}
    <ul class="card border border-surface-200-800 overflow-hidden divide-y divide-surface-200-800">
      {#each visibleMembers as m (m.id)}
        {@const age = calculateAge(m.birthday)}
        {@const assigned = assignedTrainings(m.id)}
        {@const progress = trialProgress(m.attendedCount, clubConfig.trialSessionThreshold)}
        {@const showProgress = m.trialStatus !== 'cancelled' && progress === 'convert'}
        {@const style = STATUS_STYLE[m.trialStatus]}
        {@const isOpen = expandedId === m.id}
        <li class={isOpen ? 'bg-surface-100-900/60' : ''}>
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-100-900"
            aria-expanded={isOpen}
            onclick={() => toggle(m.id)}
          >
            <span class="relative flex-shrink-0">
              <span
                class="size-10 rounded-full flex items-center justify-center text-sm font-bold {style.avatar}"
              >
                {m.lastname.charAt(0)}{m.firstname.charAt(0)}
              </span>
              <span
                class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface-50-950 {style.dot}"
                aria-hidden="true"
              ></span>
            </span>

            <span class="flex-1 min-w-0">
              <span class="font-semibold truncate block leading-tight">
                {m.firstname}
                {m.lastname}
                {#if age !== null}
                  <span class="font-normal text-surface-600-400 text-sm">· {age}</span>
                {/if}
                {#if m.notes}
                  <Fa
                    icon={faNoteSticky}
                    size="xs"
                    class="inline text-surface-500 ml-1 align-baseline"
                  />
                {/if}
              </span>
              <span class="text-xs text-surface-600-400 flex items-center gap-1.5 min-w-0 mt-0.5">
                {#if tab === 'all' || tab === 'convert' || tab === 'cancelled'}
                  <span class="chip text-[10px] py-0 px-1.5 {style.chip}">
                    {statusLabel(m)}
                  </span>
                {/if}
                {#if m.trialSection}
                  <span class="truncate">{m.trialSection}</span>
                  <span aria-hidden="true">·</span>
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
              {:else if assigned.length > 0}
                <span class="chip preset-tonal-secondary text-xs truncate">
                  {assigned[0].title} · {$_('weekdayShort.' + assigned[0].weekday)}
                </span>
                {#if assigned.length > 1}
                  <span class="text-xs text-surface-600-400">+{assigned.length - 1}</span>
                {/if}
              {/if}
            </span>

            {#if m.attendedCount > 0 || showProgress}
              <span
                class="chip gap-1 flex-shrink-0 text-xs tabular-nums {showProgress
                  ? 'preset-filled-warning-500'
                  : 'preset-tonal-surface'}"
                title={$_('page.probetraining.attended')}
              >
                {#if showProgress}
                  <Fa icon={faTriangleExclamation} size="xs" />
                {/if}
                {m.attendedCount}×
              </span>
            {/if}

            <Fa
              icon={faChevronDown}
              size="xs"
              class="text-surface-500 flex-shrink-0 transition-transform {isOpen
                ? 'rotate-180'
                : ''}"
            />
          </button>

          {#if isOpen}
            <div class="px-3 pb-3 sm:pl-16 space-y-3 text-sm">
              {#if showProgress}
                <p
                  class="flex items-center gap-2 rounded-md bg-warning-500/10 px-3 py-2 text-xs text-warning-800-200"
                >
                  <Fa icon={faTriangleExclamation} size="xs" />
                  {$_('page.probetraining.convertHint')}
                </p>
              {/if}

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {#snippet contactTile(
                  icon: typeof faPhone,
                  label: string,
                  value: string | undefined,
                  href?: string
                )}
                  <div
                    class="rounded-md border border-surface-200-800 bg-surface-50-950 p-2 flex items-center gap-2 min-w-0"
                  >
                    <span class="entity-badge size-8! text-xs text-primary-600-400">
                      <Fa {icon} />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-[11px] text-surface-600-400">{label}</span>
                      {#if value && href}
                        <a {href} class="anchor block truncate">{value}</a>
                      {:else}
                        <span class="block truncate" class:text-surface-600-400={!value}
                          >{value || '–'}</span
                        >
                      {/if}
                    </span>
                  </div>
                {/snippet}
                {@render contactTile(
                  faEnvelope,
                  $_('page.members.email'),
                  m.email,
                  m.email ? `mailto:${m.email}` : undefined
                )}
                {@render contactTile(
                  faPhone,
                  $_('page.members.mobile'),
                  m.mobile,
                  m.mobile ? `tel:${m.mobile.replace(/\s+/g, '')}` : undefined
                )}
                {@render contactTile(
                  faCakeCandles,
                  $_('page.members.birthday'),
                  m.birthday
                    ? dayjs(m.birthday).format('DD.MM.YYYY') +
                        (age !== null ? ` · ${age} ${$_('page.probetraining.yearsOld')}` : '')
                    : undefined
                )}
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <!-- Timeline of what is known about the registration -->
                <ol class="relative border-l-2 border-surface-200-800 ml-1.5 space-y-2">
                  {#if m.trialRegisteredAt}
                    <li class="pl-4 relative">
                      <span
                        class="absolute -left-[7px] top-1 size-3 rounded-full bg-primary-500 ring-2 ring-surface-50-950"
                      ></span>
                      <span class="block font-medium"
                        >{$_('page.probetraining.timeline.registered')}</span
                      >
                      <span class="text-xs text-surface-600-400">
                        {dayjs(m.trialRegisteredAt).format('DD.MM.YYYY HH:mm')}
                      </span>
                    </li>
                  {/if}
                  {#if m.trialStatus !== 'new' && m.trialStatusChangedAt}
                    <li class="pl-4 relative">
                      <span
                        class="absolute -left-[7px] top-1 size-3 rounded-full ring-2 ring-surface-50-950 {style.dot}"
                      ></span>
                      <span class="block font-medium">
                        {m.trialStatus === 'cancelled' && m.trialSelfCancelled
                          ? $_('page.probetraining.timeline.selfCancelled')
                          : $_('page.probetraining.timeline.' + m.trialStatus)}
                      </span>
                      <span class="text-xs text-surface-600-400">
                        {dayjs(m.trialStatusChangedAt).format('DD.MM.YYYY')}
                        {#if m.trialStatus === 'waitlist'}
                          · {ago(m.trialStatusChangedAt, 'waiting')}
                        {/if}
                      </span>
                    </li>
                  {/if}
                  {#if assigned.length > 0}
                    <li class="pl-4 relative">
                      <span
                        class="absolute -left-[7px] top-1 size-3 rounded-full bg-surface-300-700 ring-2 ring-surface-50-950"
                      ></span>
                      <span class="flex flex-wrap gap-1">
                        {#each assigned as t (t.id)}
                          <span class="chip preset-tonal-secondary text-xs">
                            {t.title} · {$_('weekdayShort.' + t.weekday)}
                            {t.dateFrom}
                          </span>
                        {/each}
                      </span>
                      <span class="text-xs text-surface-600-400">
                        {$_('page.probetraining.attendedCount', {
                          values: { count: m.attendedCount }
                        })}
                      </span>
                    </li>
                  {/if}
                  {#each emailsByMember.get(m.id) ?? [] as mail (mail.id)}
                    <li class="pl-4 relative">
                      <span
                        class="absolute -left-[7px] top-1 size-3 rounded-full ring-2 ring-surface-50-950 {mail.status ===
                        'failed'
                          ? 'bg-error-500'
                          : 'bg-surface-300-700'}"
                      ></span>
                      <span class="flex items-center gap-1.5 font-medium">
                        <Fa icon={faEnvelope} size="xs" class="text-surface-500" />
                        {$_('page.settings.trialMail.kind.' + mail.kind)}
                        <span class="chip text-[10px] py-0 px-1.5 {MAIL_STATUS_CHIP[mail.status]}">
                          {$_('page.probetraining.mail.status.' + mail.status)}
                        </span>
                      </span>
                      <span class="block text-xs text-surface-600-400" title={mail.error ?? ''}>
                        {dayjs(mail.sent_at ?? mail.created_at).format('DD.MM.YYYY HH:mm')}
                        {#if mail.status === 'failed' && mail.error}
                          · <span class="text-error-600-400">{mail.error}</span>
                        {/if}
                      </span>
                    </li>
                  {/each}
                </ol>

                {#if m.notes}
                  <div class="rounded-md bg-surface-50-950 border border-surface-200-800 p-3">
                    <span class="block text-[11px] text-surface-600-400 mb-1">
                      {$_('page.members.notes')}
                    </span>
                    <p class="whitespace-pre-wrap text-surface-800-200">{m.notes}</p>
                  </div>
                {/if}
              </div>

              {#if confirmCancelId === m.id}
                <div
                  class="flex flex-wrap items-center gap-2 rounded-md border border-error-500/40 bg-error-500/5 px-3 py-2"
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
              {:else}
                <div class="flex flex-wrap items-center gap-2 pt-3 border-t border-surface-200-800">
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
                    <button
                      class="btn btn-sm preset-tonal-error"
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
                  <span class="flex-1"></span>
                  {#if m.trialToken}
                    <button
                      class="btn btn-sm preset-tonal-surface"
                      title={$_('page.probetraining.statusLink.hint')}
                      onclick={() => copyStatusLink(m)}
                    >
                      <Fa icon={faLink} size="xs" />
                      <span>{$_('page.probetraining.statusLink.copy')}</span>
                    </button>
                  {/if}
                  {#if m.email}
                    <button
                      class="btn btn-sm preset-tonal-surface"
                      disabled={busyId === m.id}
                      onclick={() => (mailRequest = { member: m, kind: defaultMailKind(m) })}
                    >
                      <Fa icon={faPaperPlane} size="xs" />
                      <span>{$_('page.probetraining.mail.write')}</span>
                    </button>
                  {/if}
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
                  {#if m.trialStatus !== 'cancelled'}
                    <button
                      class="btn btn-sm preset-filled-primary-500"
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
                  {/if}
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
        onassigned={() => {
          const m = selectedMember;
          selectedMember = null;
          // Offer the training information; it only goes out after the preview.
          if (m?.email) mailRequest = { member: m, kind: 'assigned' };
        }}
      />
    </div>
  </div>
{/if}

{#if mailRequest}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onkeydown={(e) => {
      if (e.key === 'Escape') mailRequest = null;
    }}
  >
    <div class="card modal-dialog modal-dialog-lg">
      <MailDialog
        member={mailRequest.member}
        kind={mailRequest.kind}
        trainings={assignedTrainings(mailRequest.member.id)}
        onclose={() => (mailRequest = null)}
      />
    </div>
  </div>
{/if}
