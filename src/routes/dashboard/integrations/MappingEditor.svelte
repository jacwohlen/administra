<script lang="ts">
  import { untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faEye } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { clubConfig } from '$lib/clubConfig';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { invalidateIntegrationConfig } from '$lib/integrationConfigLoad';
  import {
    calendarDraft,
    changesKey,
    dropLine,
    groupDraft,
    mappingAccept,
    mappingChanges,
    parseMappingResult,
    rebaseDraft,
    sameDraft,
    type CalendarDraft,
    type CalendarRow,
    type CalendarTarget,
    type ConnectionStatus,
    type DropLine,
    type GroupDraft,
    type MappingResult,
    type MemberGroupRow
  } from '$lib/integrations';
  import type { MembershipStatus } from '$lib/models';

  /**
   * What the provider's groups and calendars mean in Alleda
   * (integration_member_groups, integration_calendars). Changes go through
   * integration_set_mapping(): Preview is its dry run and shows how many
   * members would get another status; Save sends exactly the numbers the
   * preview was over a guard with, after a confirmation. The database
   * derives the statuses again at once; calendars count from the next
   * events run.
   */
  let {
    connection,
    groups,
    calendars,
    onsaved
  }: {
    connection: ConnectionStatus;
    groups: MemberGroupRow[];
    calendars: CalendarRow[];
    /** After a save: reload the page */
    onsaved: () => Promise<void>;
  } = $props();

  const STATUSES: MembershipStatus[] = ['active', 'passive', 'non_member', 'trial', 'left'];
  const TARGETS: CalendarTarget[] = ['event', 'break', 'ignore'];

  // Inputs per catalog row, and the values each was made from (its base).
  // The page reloads the rows in place (after a dismiss, a merge, or another
  // admin's save): a value the admin left as loaded then takes the row's
  // current one, so a change saved meanwhile is not sent back as ours; a new
  // row gets its own draft.
  let groupDrafts = $state<Record<number, GroupDraft>>({});
  let calendarDrafts = $state<Record<number, CalendarDraft>>({});
  const groupBases = new Map<number, GroupDraft>();
  const calendarBases = new Map<number, CalendarDraft>();

  function syncDrafts<R extends { id: number }, D extends GroupDraft | CalendarDraft>(
    rows: readonly R[],
    drafts: Record<number, D>,
    bases: Map<number, D>,
    toDraft: (row: R) => D
  ) {
    for (const row of rows) {
      const fresh = toDraft(row);
      const base = bases.get(row.id);
      if (base && drafts[row.id] && sameDraft(base, fresh)) continue;
      drafts[row.id] = rebaseDraft(drafts[row.id], base, fresh);
      bases.set(row.id, fresh);
    }
  }

  $effect.pre(() => {
    const groupRows = groups;
    const calendarRows = calendars;
    // Only when the rows change, not with every input
    untrack(() => {
      syncDrafts(groupRows, groupDrafts, groupBases, groupDraft);
      syncDrafts(calendarRows, calendarDrafts, calendarBases, calendarDraft);
    });
  });

  /** All inputs as the rows are now */
  function resetDrafts() {
    groupDrafts = {};
    calendarDrafts = {};
    groupBases.clear();
    calendarBases.clear();
    syncDrafts(groups, groupDrafts, groupBases, groupDraft);
    syncDrafts(calendars, calendarDrafts, calendarBases, calendarDraft);
  }

  // New rows first, then the status groups by rank, then the rest by name
  let sortedGroups = $derived(
    [...groups].sort(
      (a, b) =>
        Number(a.reviewed) - Number(b.reviewed) ||
        Number(a.status == null) - Number(b.status == null) ||
        a.rank - b.rank ||
        a.name.localeCompare(b.name, 'de')
    )
  );
  let sortedCalendars = $derived(
    [...calendars].sort(
      (a, b) =>
        Number(a.gone_at != null) - Number(b.gone_at != null) ||
        Number(a.reviewed) - Number(b.reviewed) ||
        a.name.localeCompare(b.name, 'de')
    )
  );

  let current = $derived(mappingChanges(groups, groupDrafts, calendars, calendarDrafts));
  let count = $derived(current.changes.groups.length + current.changes.calendars.length);
  let key = $derived(changesKey(current.changes, groups, calendars));

  let busy = $state(false);
  let preview = $state<{ key: string; result: MappingResult } | null>(null);
  let previewFits = $derived(preview !== null && preview.key === key);
  let confirming = $state(false);

  /** The club's sections, plus a calendar's own if it is none of them */
  function sectionsFor(row: CalendarRow): string[] {
    const own = row.section && !clubConfig.sections.includes(row.section) ? [row.section] : [];
    return [...clubConfig.sections, ...own];
  }

  function errorMessage(e: unknown): string {
    const message = (e as { message?: string } | null)?.message ?? '';
    if (message.includes('INVALID_MAPPING')) return $_('page.integrations.mapping.error.invalid');
    if (message.includes('NOT_ALLOWED')) return $_('page.integrations.mapping.error.notAllowed');
    return $_('page.integrations.mapping.error.failed');
  }

  async function setMapping(options: Record<string, unknown>): Promise<MappingResult> {
    const { data, error } = await supabaseClient.rpc('integration_set_mapping', {
      p_connection: connection.id,
      p_changes: current.changes,
      p_options: options
    });
    if (error) throw error;
    return parseMappingResult(data);
  }

  async function showPreview() {
    if (count === 0 || current.invalid.length > 0) return;
    busy = true;
    const previewed = key;
    try {
      preview = { key: previewed, result: await setMapping({ dry_run: true }) };
    } catch (e) {
      console.error('Error previewing a mapping change:', e);
      toaster.error({ title: errorMessage(e) });
    } finally {
      busy = false;
    }
  }

  async function save() {
    confirming = false;
    // An input the database would refuse is left out of the changes: saving
    // the others would drop it without a word
    if (!preview || !previewFits || current.invalid.length > 0) return;
    busy = true;
    const saved = key;
    try {
      const result = await setMapping(mappingAccept(preview.result));
      if (result.status === 'refused') {
        // The numbers changed since the preview (a run in between): show the new ones
        preview = { key: saved, result };
        toaster.error({ title: $_('page.integrations.mapping.toast.refused') });
        return;
      }
      toaster.success({ title: $_('page.integrations.mapping.toast.saved') });
      invalidateIntegrationConfig();
      preview = null;
      await onsaved();
      resetDrafts();
    } catch (e) {
      console.error('Error saving a mapping change:', e);
      toaster.error({ title: errorMessage(e) });
    } finally {
      busy = false;
    }
  }

  function reset() {
    resetDrafts();
    preview = null;
  }

  function statusName(status: string): string {
    return $_(`page.members.status.${status}`, { default: status });
  }

  function dropText(line: DropLine): string {
    switch (line.key) {
      case 'dropping':
        return $_('page.integrations.mapping.dropping', {
          values: { count: line.count, limit: line.limit }
        });
      case 'droppingStatus':
        return $_('page.integrations.mapping.droppingStatus', {
          values: { count: line.count, status: statusName(line.status) }
        });
      case 'droppingStatuses':
        return $_('page.integrations.mapping.droppingStatuses', {
          values: {
            count: line.count,
            list: line.statuses
              .map(([status, count]) =>
                $_('page.integrations.mapping.statusCount', {
                  values: { count, status: statusName(status) }
                })
              )
              .join(', ')
          }
        });
    }
  }

  function summary(result: MappingResult): string {
    return $_('page.integrations.mapping.previewResult', {
      values: {
        groups: result.groups,
        calendars: result.calendars,
        statuses: result.statuses_changed
      }
    });
  }
</script>

<div class="flex flex-col gap-4">
  <p class="text-sm text-surface-600-400">
    {$_('page.integrations.mapping.intro', { values: { provider: connection.display_name } })}
  </p>

  <section class="flex flex-col gap-2">
    <h4 class="mb-0">{$_('page.integrations.mapping.groups')}</h4>
    <p class="text-xs text-surface-600-400">{$_('page.integrations.mapping.groupsHelp')}</p>
    {#if groups.length === 0}
      <p class="text-sm text-surface-600-400">{$_('page.integrations.mapping.noGroups')}</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-surface-600-400">
            <tr>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.group')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.status')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.rank')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.hidden')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.role')}</th>
              <th class="py-1 font-medium">{$_('page.integrations.mapping.reviewed')}</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedGroups as row (row.id)}
              {@const d = groupDrafts[row.id]}
              {#if d}
                <tr class="border-t border-surface-200-800">
                  <td class="py-1 pr-2 min-w-40">
                    <span class="font-medium">{row.name}</span>
                    {#if row.label && row.label !== row.name}
                      <span class="text-xs text-surface-600-400">
                        {$_('page.integrations.mapping.asLabel', { values: { label: row.label } })}
                      </span>
                    {/if}
                    {#if !row.reviewed}
                      <span class="chip preset-tonal-warning text-xs">
                        {$_('page.integrations.mapping.new')}
                      </span>
                    {/if}
                  </td>
                  <td class="py-1 pr-2">
                    <select
                      class="select text-sm py-1 w-auto"
                      bind:value={d.status}
                      disabled={busy}
                      aria-label={$_('page.integrations.mapping.status')}
                    >
                      <option value="">{$_('page.integrations.mapping.noStatus')}</option>
                      {#each STATUSES as status (status)}
                        <option value={status}>{$_(`page.members.status.${status}`)}</option>
                      {/each}
                    </select>
                  </td>
                  <td class="py-1 pr-2">
                    <input
                      class="input text-sm py-1 w-16"
                      type="text"
                      inputmode="numeric"
                      aria-invalid={current.invalid.includes(row.id)}
                      bind:value={d.rank}
                      disabled={busy}
                      aria-label={$_('page.integrations.mapping.rank')}
                    />
                  </td>
                  <td class="py-1 pr-2">
                    <input
                      class="checkbox"
                      type="checkbox"
                      bind:checked={d.hidden}
                      disabled={busy}
                      aria-label={$_('page.integrations.mapping.hidden')}
                    />
                  </td>
                  <td class="py-1 pr-2">
                    <select
                      class="select text-sm py-1 w-auto"
                      bind:value={d.role}
                      disabled={busy}
                      aria-label={$_('page.integrations.mapping.role')}
                    >
                      <option value="">{$_('page.integrations.mapping.noRole')}</option>
                      <option value="trainer">{$_('page.integrations.mapping.roleTrainer')}</option>
                    </select>
                  </td>
                  <td class="py-1">
                    {#if !row.reviewed}
                      <input
                        class="checkbox"
                        type="checkbox"
                        bind:checked={d.reviewed}
                        disabled={busy}
                        aria-label={$_('page.integrations.mapping.reviewed')}
                      />
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="flex flex-col gap-2">
    <h4 class="mb-0">{$_('page.integrations.mapping.calendars')}</h4>
    <p class="text-xs text-surface-600-400">{$_('page.integrations.mapping.calendarsHelp')}</p>
    {#if calendars.length === 0}
      <p class="text-sm text-surface-600-400">{$_('page.integrations.mapping.noCalendars')}</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-surface-600-400">
            <tr>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.calendar')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.target')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.section')}</th>
              <th class="py-1 pr-2 font-medium">{$_('page.integrations.mapping.closedMaxDays')}</th>
              <th class="py-1 font-medium">{$_('page.integrations.mapping.reviewed')}</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedCalendars as row (row.id)}
              {@const d = calendarDrafts[row.id]}
              {#if d}
                <tr class="border-t border-surface-200-800">
                  <td class="py-1 pr-2 min-w-40">
                    <span class="font-medium">{row.name}</span>
                    {#if row.gone_at}
                      <span class="chip preset-tonal-surface text-xs">
                        {$_('page.integrations.mapping.gone', {
                          values: { provider: connection.display_name }
                        })}
                      </span>
                    {:else if !row.reviewed}
                      <span class="chip preset-tonal-warning text-xs">
                        {$_('page.integrations.mapping.new')}
                      </span>
                    {/if}
                  </td>
                  <td class="py-1 pr-2">
                    <select
                      class="select text-sm py-1 w-auto"
                      bind:value={d.target}
                      disabled={busy}
                      aria-label={$_('page.integrations.mapping.target')}
                    >
                      {#each TARGETS as target (target)}
                        <option value={target}>
                          {$_(`page.integrations.mapping.targets.${target}`)}
                        </option>
                      {/each}
                    </select>
                  </td>
                  <td class="py-1 pr-2">
                    <select
                      class="select text-sm py-1 w-auto"
                      bind:value={d.section}
                      disabled={busy || d.target !== 'event'}
                      aria-label={$_('page.integrations.mapping.section')}
                    >
                      {#if !row.section}<option value="">–</option>{/if}
                      {#each sectionsFor(row) as section (section)}
                        <option value={section}>{section}</option>
                      {/each}
                    </select>
                  </td>
                  <td class="py-1 pr-2">
                    <input
                      class="input text-sm py-1 w-16"
                      type="text"
                      inputmode="numeric"
                      aria-invalid={current.invalid.includes(row.id)}
                      bind:value={d.closedMaxDays}
                      disabled={busy || d.target !== 'break'}
                      aria-label={$_('page.integrations.mapping.closedMaxDays')}
                    />
                  </td>
                  <td class="py-1">
                    {#if !row.reviewed}
                      <input
                        class="checkbox"
                        type="checkbox"
                        bind:checked={d.reviewed}
                        disabled={busy}
                        aria-label={$_('page.integrations.mapping.reviewed')}
                      />
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  {#if current.invalid.length > 0}
    <p class="text-sm text-error-600-400">{$_('page.integrations.mapping.invalid')}</p>
  {/if}

  {#if preview}
    {@const result = preview.result}
    {@const drop = dropLine(result.guard)}
    <div
      class="flex flex-col gap-1 p-3 rounded-lg text-sm {result.guard.over_drop ||
      result.guard.over_gain
        ? 'preset-tonal-warning'
        : 'preset-tonal-surface'}"
      aria-live="polite"
    >
      <p>{summary(result)}</p>
      {#if drop}
        <p>{dropText(drop)}</p>
      {/if}
      {#if result.guard.gaining > 0}
        <p>
          {$_('page.integrations.mapping.gaining', {
            values: { count: result.guard.gaining, limit: result.guard.limit }
          })}
        </p>
      {/if}
      {#if result.guard.over_drop || result.guard.over_gain}
        <p class="font-semibold">{$_('page.integrations.mapping.overGuard')}</p>
      {/if}
      {#if result.calendars > 0}
        <p class="text-surface-600-400">{$_('page.integrations.mapping.calendarsLater')}</p>
      {/if}
      {#if !previewFits}
        <p class="text-surface-600-400">{$_('page.integrations.mapping.previewOutdated')}</p>
      {/if}
    </div>
  {/if}

  <div class="flex flex-wrap justify-end gap-2">
    {#if count > 0 || preview}
      <button type="button" class="btn preset-tonal-surface" disabled={busy} onclick={reset}>
        {$_('page.integrations.mapping.reset')}
      </button>
    {/if}
    <button
      type="button"
      class="btn preset-tonal-surface"
      disabled={busy || count === 0 || current.invalid.length > 0}
      onclick={showPreview}
    >
      <Fa icon={faEye} />
      <span>{$_('page.integrations.mapping.preview')}</span>
    </button>
    <button
      type="button"
      class="btn preset-filled-primary-500"
      disabled={busy || count === 0 || !previewFits || current.invalid.length > 0}
      onclick={() => (confirming = true)}
    >
      {$_('page.integrations.mapping.save')}
    </button>
  </div>
</div>

{#if confirming && preview}
  <ConfirmDialog
    title={$_('page.integrations.mapping.confirmTitle')}
    message={[
      summary(preview.result),
      preview.result.guard.over_drop || preview.result.guard.over_gain
        ? $_('page.integrations.mapping.confirmOverride')
        : ''
    ]
      .filter(Boolean)
      .join(' ')}
    confirmLabel={$_('page.integrations.mapping.save')}
    {busy}
    oncancel={() => (confirming = false)}
    onconfirm={save}
  />
{/if}
