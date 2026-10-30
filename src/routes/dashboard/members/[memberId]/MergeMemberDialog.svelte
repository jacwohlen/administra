<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowRightArrowLeft,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { modalDialog } from '$lib/modalDialog';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { fetchAllRows } from '$lib/assistant/attendance';
  import { normalizeName } from '$lib/assistant/nameMatch';
  import {
    findDuplicatePairs,
    inProvider,
    isTrialOrigin,
    linkStates,
    mergeOrderProblem,
    suggestKeep,
    type LinkState
  } from '$lib/memberDuplicates';
  import {
    MERGE_COLUMNS,
    accountChanges,
    conflictText,
    mergeErrorCode,
    mergeSummary,
    mergeWarnings,
    mergeWithPhoto,
    type MergeErrorCode,
    type MergeMember
  } from '$lib/memberMerge';
  import { statusChip, visibleLabels } from '$lib/memberStatus';
  import type { MemberMergeResult } from '$lib/models';
  import { toaster } from '$lib/toast';

  /**
   * Merge a duplicate into one member (admins): pick the other record (or get
   * both from the duplicates list), check the preview of what moves, confirm.
   * The database decides and refuses (merge_members); this dialog only orders
   * the pair so the record Webling has stays.
   */
  let {
    first,
    second = null,
    onclose,
    onmerged
  }: {
    first: MergeMember;
    /** The other record, when the pair is known (duplicates list) */
    second?: MergeMember | null;
    onclose: () => void;
    /** After the merge, with the id of the member that stayed */
    onmerged: (keepId: number) => void;
  } = $props();

  const PROVIDER = 'Webling';

  // svelte-ignore state_referenced_locally
  let other = $state<MergeMember | null>(second);
  let members = $state<MergeMember[]>([]);
  let links = $state(new Map<number, LinkState>());
  let ready = $state(false);
  let loadFailed = $state(false);
  let search = $state('');
  let swapped = $state(false);
  let preview = $state<MemberMergeResult | null>(null);
  let previewError = $state<MergeErrorCode | null>(null);
  let loadingPreview = $state(false);
  let confirming = $state(false);
  let merging = $state(false);

  onMount(async () => {
    try {
      const [linkRows, memberRows] = await Promise.all([
        fetchAllRows<{ member_id: number; gone_at: string | null }>((from, to) =>
          supabaseClient
            .from('member_links')
            .select('member_id, gone_at')
            .order('connection')
            .order('external_id')
            .range(from, to)
        ),
        // Archived trial candidates included: they are duplicates too
        second
          ? Promise.resolve([] as MergeMember[])
          : fetchAllRows<MergeMember>((from, to) =>
              supabaseClient
                .from('members')
                .select(MERGE_COLUMNS)
                .order('lastname')
                .order('firstname')
                .order('id')
                .range(from, to)
            )
      ]);
      links = linkStates(linkRows);
      members = memberRows.map((m) => ({ ...m, id: Number(m.id) }));
      ready = true;
    } catch (error) {
      console.error('Error loading members for merging:', error);
      loadFailed = true;
    }
  });

  const providerOf = (m: MergeMember) => inProvider(m.id, links.get(m.id));

  // The same person by name, birthday or e-mail: offered before searching
  let suggestions = $derived(
    findDuplicatePairs([first, ...members.filter((m) => m.id !== first.id)], links)
      .filter((p) => p.keep.id === first.id || p.drop.id === first.id)
      .map((p) => (p.keep.id === first.id ? p.drop : p.keep))
  );
  let matches = $derived.by(() => {
    const q = normalizeName(search);
    if (q.length < 2) return suggestions;
    return members
      .filter(
        (m) =>
          m.id !== first.id &&
          (normalizeName(`${m.firstname} ${m.lastname}`).includes(q) ||
            normalizeName(`${m.lastname} ${m.firstname}`).includes(q) ||
            String(m.id) === search.trim())
      )
      .slice(0, 20);
  });

  let pair = $derived.by(() => {
    if (!ready || !other) return null;
    const [keep, drop] = suggestKeep(first, other, links);
    return swapped ? { keep: drop, drop: keep } : { keep, drop };
  });
  // Swapping is offered only when the database would accept the other order
  let swapProblem = $derived(
    pair ? mergeOrderProblem(providerOf(pair.drop), providerOf(pair.keep)) : null
  );

  // Only the answer for the latest pair counts: a slow preview for the pair
  // before must not overwrite it
  let previewRun = 0;
  $effect(() => {
    const p = pair;
    const run = ++previewRun;
    preview = null;
    previewError = null;
    if (!p) return;
    loadingPreview = true;
    supabaseClient.rpc('merge_members_preview', { p_keep: p.keep.id, p_drop: p.drop.id }).then(
      ({ data, error }) => {
        if (run !== previewRun) return;
        loadingPreview = false;
        if (error) previewError = mergeErrorCode(error);
        else preview = data as MemberMergeResult;
      },
      (error: unknown) => {
        // Offline or a dropped connection: say so instead of spinning
        if (run !== previewRun) return;
        console.error('Error loading the merge preview:', error);
        loadingPreview = false;
        previewError = 'unknown';
      }
    );
  });

  let summary = $derived(preview ? mergeSummary(preview) : []);
  // Status and trial labels are not worth a line: the kept status stays
  let lostLabels = $derived(preview ? visibleLabels(preview.fields.labelsNotCarried) : []);
  let warnings = $derived(preview ? mergeWarnings(preview) : []);
  let conflictLines = $derived(preview ? preview.conflicts.map((c) => conflictText(c, $_)) : []);
  let accounts = $derived(preview ? accountChanges(preview) : []);
  const statusName = (status: string | null) =>
    status ? $_(`page.members.status.${status}`) : '–';
  let fieldLines = $derived.by(() => {
    if (!preview || !pair) return [];
    const drop = pair.drop;
    return (['birthday', 'mobile', 'email'] as const)
      .filter((f) => preview!.fields[f] !== 'same')
      .map((f) =>
        $_(`page.members.merge.fieldDecision.${preview!.fields[f]}`, {
          values: {
            field: $_(`page.members.merge.field.${f}`),
            value:
              f === 'birthday' && drop.birthday
                ? dayjs(drop.birthday).format('DD.MM.YYYY')
                : (drop[f] ?? ''),
            provider: PROVIDER
          }
        })
      );
  });

  function pick(m: MergeMember) {
    other = m;
    swapped = false;
  }

  function name(m: MergeMember) {
    return `${m.firstname} ${m.lastname}`;
  }

  async function merge() {
    if (!pair || !preview) return;
    const { keep, drop } = pair;
    merging = true;
    try {
      const result = await mergeWithPhoto(
        supabaseClient.storage.from('avatars'),
        preview,
        keep.id,
        drop.id,
        async () => {
          const { data, error } = await supabaseClient.rpc('merge_members', {
            p_keep: keep.id,
            p_drop: drop.id
          });
          if (error) throw error;
          return data as MemberMergeResult;
        }
      );
      toaster.success({ title: $_('page.members.merge.success') });
      onmerged(result.keep);
    } catch (error) {
      console.error('Error merging members:', error);
      toaster.error({
        title: $_(`page.members.merge.error.${mergeErrorCode(error)}`, {
          values: { provider: PROVIDER }
        })
      });
      merging = false;
      confirming = false;
    }
  }
</script>

{#snippet memberCard(m: MergeMember, label: string)}
  {@const status = statusChip(m.membership_status)}
  <div class="rounded-md border border-surface-300-700 p-3 space-y-1 min-w-0">
    <div class="text-xs uppercase tracking-wide text-surface-600-400">{label}</div>
    <div class="font-semibold truncate">
      {name(m)} <span class="text-surface-500">#{m.id}</span>
    </div>
    <div class="text-sm text-surface-600-400 truncate">
      {m.birthday ? dayjs(m.birthday).format('DD.MM.YYYY') : '–'}
      {#if m.email}· {m.email}{/if}
    </div>
    <div class="flex flex-wrap gap-1">
      {#if providerOf(m)}
        <span class="chip preset-tonal-primary text-xs">
          {$_('page.members.merge.inProvider', { values: { provider: PROVIDER } })}
        </span>
      {/if}
      {#if status}
        <span class="chip preset-tonal-surface text-xs">{$_(`page.members.status.${status}`)}</span>
      {/if}
      {#if isTrialOrigin(m) && status !== 'trial'}
        <span class="chip preset-tonal-surface text-xs">{$_('page.members.status.trial')}</span>
      {/if}
      {#if m.archivedAt}
        <span class="chip preset-tonal-surface text-xs">{$_('page.members.status.archived')}</span>
      {/if}
    </div>
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={() => !merging && onclose()}
  onkeydown={(e) => {
    if (e.key === 'Escape' && !merging && !confirming) onclose();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    use:modalDialog
    class="card modal-dialog modal-dialog-lg space-y-4"
    onclick={(e) => e.stopPropagation()}
  >
    <h3>{$_('page.members.merge.title')}</h3>
    <p class="text-sm">{$_('page.members.merge.intro')}</p>

    {#if loadFailed}
      <p class="text-error-600-400">{$_('page.members.merge.loadError')}</p>
    {:else if !ready}
      <p class="flex items-center gap-2">
        <Fa icon={faSpinner} spin />
        {$_('page.members.merge.previewLoading')}
      </p>
    {:else}
      {#if !second}
        <div class="space-y-2">
          <input
            class="input"
            type="search"
            bind:value={search}
            placeholder={$_('page.members.merge.search')}
            aria-label={$_('page.members.merge.search')}
          />
          {#if matches.length}
            <ul
              class="max-h-48 overflow-y-auto divide-y divide-surface-200-800 rounded-md border border-surface-300-700"
            >
              {#each matches as m (m.id)}
                <li>
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 hover:bg-surface-100-900 {other?.id === m.id
                      ? 'bg-primary-500/10'
                      : ''}"
                    onclick={() => pick(m)}
                  >
                    {name(m)} <span class="text-surface-500">#{m.id}</span>
                    <span class="text-xs text-surface-600-400">
                      {m.birthday ? dayjs(m.birthday).format('DD.MM.YYYY') : ''}
                      {providerOf(m) ? `· ${PROVIDER}` : ''}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else if search.trim().length >= 2}
            <p class="text-sm text-surface-600-400">{$_('page.members.merge.noMatches')}</p>
          {/if}
        </div>
      {/if}

      {#if pair}
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center">
          {@render memberCard(pair.keep, $_('page.members.merge.keep'))}
          <button
            type="button"
            class="btn preset-tonal-surface justify-self-center"
            onclick={() => (swapped = !swapped)}
            disabled={swapProblem !== null || merging}
            title={swapProblem
              ? $_('page.members.merge.swapBlocked', { values: { provider: PROVIDER } })
              : $_('page.members.merge.swap')}
            aria-label={$_('page.members.merge.swap')}
          >
            <Fa icon={faArrowRightArrowLeft} />
          </button>
          {@render memberCard(pair.drop, $_('page.members.merge.drop'))}
        </div>

        {#if loadingPreview}
          <p class="flex items-center gap-2 text-sm">
            <Fa icon={faSpinner} spin />
            {$_('page.members.merge.previewLoading')}
          </p>
        {:else if previewError}
          <p
            class="flex items-center gap-2 rounded-md bg-error-500/10 px-3 py-2 text-sm text-error-800-200"
          >
            <Fa icon={faTriangleExclamation} />
            {$_(`page.members.merge.error.${previewError}`, { values: { provider: PROVIDER } })}
          </p>
        {:else if preview}
          <div class="space-y-2 text-sm">
            <h4 class="font-semibold">{$_('page.members.merge.previewTitle')}</h4>
            {#if summary.length}
              <ul class="space-y-1">
                {#each summary as row (row.ref)}
                  <li class="flex flex-wrap justify-between gap-2">
                    <span
                      >{$_(`page.members.merge.refs.${row.key}`, {
                        values: { ref: row.ref }
                      })}</span
                    >
                    <span class="text-surface-600-400">
                      {[
                        row.moved
                          ? $_('page.members.merge.moved', { values: { count: row.moved } })
                          : '',
                        row.merged
                          ? $_('page.members.merge.merged', { values: { count: row.merged } })
                          : '',
                        row.removed
                          ? $_('page.members.merge.removed', { values: { count: row.removed } })
                          : ''
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-surface-600-400">{$_('page.members.merge.nothingToMove')}</p>
            {/if}
            {#if conflictLines.length}
              <h4 class="font-semibold pt-2">{$_('page.members.merge.conflictsTitle')}</h4>
              <ul class="list-disc pl-5 space-y-1">
                {#each conflictLines as line, i (i)}
                  <li>{line}</li>
                {/each}
              </ul>
            {/if}
            {#if preview.badges.added.length || preview.badges.removed.length}
              <p>
                {$_('page.members.merge.badges', {
                  values: {
                    added: preview.badges.added.length,
                    removed: preview.badges.removed.length
                  }
                })}
              </p>
            {/if}
            {#if preview.badges.othersChanged}
              <p>
                {$_('page.members.merge.othersChanged', {
                  values: { count: preview.badges.othersChanged }
                })}
              </p>
            {/if}

            <h4 class="font-semibold pt-2">{$_('page.members.merge.fieldsTitle')}</h4>
            <ul class="list-disc pl-5 space-y-1">
              <li>
                {preview.status.before === preview.status.after
                  ? $_('page.members.merge.statusSame', {
                      values: { status: statusName(preview.status.before) }
                    })
                  : $_('page.members.merge.statusChanges', {
                      values: {
                        before: statusName(preview.status.before),
                        after: statusName(preview.status.after)
                      }
                    })}
              </li>
              {#each fieldLines as line (line)}
                <li>{line}</li>
              {/each}
              {#if preview.fields.notes === 'joined'}<li>
                  {$_('page.members.merge.notesJoined')}
                </li>{/if}
              {#if preview.fields.photo === 'from_drop'}<li>
                  {$_('page.members.merge.photoFromDrop')}
                </li>{/if}
              {#if preview.fields.photo === 'kept_both'}<li>
                  {$_('page.members.merge.photoKeptBoth')}
                </li>{/if}
              {#if preview.fields.archived === 'unarchived'}<li>
                  {$_('page.members.merge.unarchived')}
                </li>{/if}
              {#if preview.fields.trial === 'from_drop'}<li>
                  {$_('page.members.merge.trialFromDrop')}
                </li>{/if}
              {#if lostLabels.length}
                <li>
                  {$_('page.members.merge.labelsNotCarried', {
                    values: { labels: lostLabels.join(', ') }
                  })}
                </li>
              {/if}
            </ul>

            {#if accounts.length}
              <h4 class="font-semibold pt-2">{$_('page.members.merge.accountsTitle')}</h4>
              <ul class="list-disc pl-5 space-y-1">
                {#each accounts as { account, change } (account.userId)}
                  <li class={change.startsWith('gains') ? '' : 'text-warning-800-200'}>
                    {$_(`page.members.merge.account.${change}`, {
                      values: { email: account.email ?? account.userId }
                    })}
                  </li>
                {/each}
              </ul>
            {/if}

            <!-- E-mail and photo decisions already have their line above -->
            {#each warnings as w (w.code)}
              {#if w.code === 'TRIAL_LINK_ENDS' || w.code === 'ACCOUNT_LOSES_ACCESS'}
                <p
                  class="flex items-start gap-2 rounded-md bg-warning-500/10 px-3 py-2 text-warning-800-200"
                >
                  <Fa icon={faTriangleExclamation} class="mt-0.5" />
                  <span
                    >{$_(`page.members.merge.warning.${w.code}`, {
                      values: { count: w.accounts ?? 0 }
                    })}</span
                  >
                </p>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}
    {/if}

    <div class="flex justify-end gap-2">
      <button type="button" class="btn preset-tonal-surface" onclick={onclose} disabled={merging}>
        {$_('button.cancel')}
      </button>
      <button
        type="button"
        class="btn preset-filled-error-500"
        disabled={!preview || merging}
        onclick={() => (confirming = true)}
      >
        {$_('page.members.merge.confirm')}
      </button>
    </div>
  </div>
</div>

{#if confirming && pair}
  <ConfirmDialog
    title={$_('page.members.merge.confirmTitle')}
    message={$_('page.members.merge.confirmMessage', {
      values: {
        drop: name(pair.drop),
        dropId: pair.drop.id,
        keep: name(pair.keep),
        keepId: pair.keep.id
      }
    })}
    confirmLabel={$_('page.members.merge.confirm')}
    busy={merging}
    oncancel={() => (confirming = false)}
    onconfirm={merge}
  />
{/if}
