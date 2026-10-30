<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { invalidate } from '$app/navigation';
  import type { PageData } from './$types';
  import ConnectionOverview from './ConnectionOverview.svelte';
  import RunTable from './RunTable.svelte';
  import IssueList from './IssueList.svelte';
  import MappingEditor from './MappingEditor.svelte';

  /**
   * Admins: where members, events and holidays come from (one card per
   * connection of the integration layer), what the latest runs did, the
   * open issues and the mapping of groups and calendars
   * (docs/INTEGRATIONS.md, "Integrations page").
   */
  let { data }: { data: PageData } = $props();

  let members = $derived(new Map(data.members.map((m) => [m.id, m])));
  let events = $derived(new Map(data.events.map((e) => [e.id, e])));

  async function reload() {
    // The avatar's warning dot (dashboard layout) follows the page
    await Promise.all([invalidate('integrations:page'), invalidate('integrations:status')]);
  }
</script>

<div class="page-header">
  <h1>{$_('page.integrations.title')}</h1>
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.integrations.intro')}</p>

{#if data.connections.length === 0}
  <p class="empty-state">{$_('page.integrations.empty')}</p>
{:else}
  <div class="flex flex-col gap-6">
    {#each data.connections as connection (connection.id)}
      {@const runs = data.runs.filter((r) => r.connection === connection.id)}
      {@const issues = data.issues.filter((i) => i.connection === connection.id)}
      {@const groups = data.groups.filter((g) => g.connection === connection.id)}
      {@const calendars = data.calendars.filter((c) => c.connection === connection.id)}
      <section class="card p-4 bg-surface-50-950 border border-surface-300-700 flex flex-col gap-4">
        <ConnectionOverview {connection} {runs} />

        <details class="rounded-md border border-surface-200-800 px-3 py-2">
          <summary class="cursor-pointer font-medium">
            {$_('page.integrations.runs.title')}
            <span class="text-sm text-surface-600-400 font-normal">({runs.length})</span>
          </summary>
          <div class="pt-2">
            <RunTable {runs} />
          </div>
        </details>

        <details
          class="rounded-md border border-surface-200-800 px-3 py-2"
          open={connection.issues.error + connection.issues.warning > 0}
        >
          <summary class="cursor-pointer font-medium">
            {$_('page.integrations.issues.title')}
            <span class="text-sm text-surface-600-400 font-normal">
              ({connection.issues.error + connection.issues.warning + connection.issues.info})
            </span>
          </summary>
          <div class="pt-2">
            <IssueList
              {issues}
              {members}
              {events}
              provider={connection.display_name}
              eventUrl={data.eventUrls[connection.id] ?? null}
              onchanged={reload}
            />
          </div>
        </details>

        <details
          class="rounded-md border border-surface-200-800 px-3 py-2"
          open={connection.to_review.groups + connection.to_review.calendars > 0}
        >
          <summary class="cursor-pointer font-medium">
            {$_('page.integrations.mapping.title')}
            {#if connection.to_review.groups + connection.to_review.calendars > 0}
              <span class="chip preset-tonal-warning text-xs ml-1">
                {$_('page.integrations.mapping.toReview', {
                  values: { count: connection.to_review.groups + connection.to_review.calendars }
                })}
              </span>
            {/if}
          </summary>
          <div class="pt-2">
            <MappingEditor {connection} {groups} {calendars} onsaved={reload} />
          </div>
        </details>
      </section>
    {/each}
  </div>
{/if}
