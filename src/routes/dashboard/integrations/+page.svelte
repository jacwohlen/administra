<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { invalidate, invalidateAll } from '$app/navigation';
  import Fa from 'svelte-fa';
  import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
  import { invalidateIntegrationConfig } from '$lib/integrationConfigLoad';
  import { hasSync } from '$lib/integrations';
  import type { PageData } from './$types';
  import ConnectionOverview from './ConnectionOverview.svelte';
  import RunTable from './RunTable.svelte';
  import IssueList from './IssueList.svelte';
  import MappingEditor from './MappingEditor.svelte';
  import ModuleSwitch from './ModuleSwitch.svelte';

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

  // A connection switched on or off: menus and modules (J+S) follow at once
  async function switched() {
    invalidateIntegrationConfig();
    await invalidateAll();
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
        {#if !hasSync(connection)}
          <!-- A module without a sync (J+S): what it does, on or off, where it is -->
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="flex-1 min-w-0 truncate mb-0">{connection.display_name}</h2>
            {#if !connection.enabled}
              <span class="chip preset-tonal-warning text-xs">
                {$_('page.integrations.disabled')}
              </span>
            {/if}
            <ModuleSwitch {connection} onchanged={switched} />
          </div>
          <p class="text-sm text-surface-600-400">
            {$_(`page.integrations.module.${connection.provider}`, {
              default: connection.display_name
            })}
          </p>
          {#if connection.enabled && connection.provider === 'js'}
            <a href="/dashboard/js" class="btn preset-tonal-primary self-start">
              <span>{$_('page.integrations.module.openJs')}</span>
              <Fa icon={faArrowRight} />
            </a>
          {/if}
        {:else}
          <ConnectionOverview {connection} {runs} />
          <div class="flex justify-end">
            <ModuleSwitch {connection} onchanged={switched} />
          </div>

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
        {/if}
      </section>
    {/each}
  </div>
{/if}
