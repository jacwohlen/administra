<script lang="ts">
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import {
    acceptedOverrides,
    adapterErrors,
    refusalOverride,
    runCounts,
    runStatusClass,
    type IntegrationRun
  } from '$lib/integrations';

  /**
   * The connection's latest runs: when, what, how it ended, the counts
   * other than zero, the overrides used and the error or refusal code. The
   * log holds codes and counts only, so this shows no names.
   */
  let { runs }: { runs: IntegrationRun[] } = $props();

  function details(run: IntegrationRun): string[] {
    const parts = runCounts(run).map(([key, count]) =>
      $_(`page.integrations.count.${key}`, { values: { count } })
    );
    const errors = adapterErrors(run);
    if (errors > 0)
      parts.push($_('page.integrations.runs.adapterErrors', { values: { count: errors } }));
    return parts;
  }

  function reason(run: IntegrationRun): string {
    if (run.status === 'refused') {
      const code = String(run.guard?.refused ?? '');
      const override = refusalOverride(run.guard);
      return override ? `${code} (${override.key}=${override.count})` : code;
    }
    return run.error ?? '';
  }
</script>

{#if runs.length === 0}
  <p class="text-sm text-surface-600-400">{$_('page.integrations.runs.empty')}</p>
{:else}
  <!-- On a phone the table scrolls sideways -->
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="text-left text-xs text-surface-600-400">
        <tr>
          <th class="py-1 pr-3 font-medium">{$_('page.integrations.runs.started')}</th>
          <th class="py-1 pr-3 font-medium">{$_('page.integrations.runs.kind')}</th>
          <th class="py-1 pr-3 font-medium">{$_('page.integrations.runs.status')}</th>
          <th class="py-1 pr-3 font-medium">{$_('page.integrations.runs.counts')}</th>
          <th class="py-1 font-medium">{$_('page.integrations.runs.error')}</th>
        </tr>
      </thead>
      <tbody>
        {#each runs as run (run.id)}
          {@const parts = details(run)}
          <tr class="border-t border-surface-200-800 align-top">
            <td class="py-1 pr-3 whitespace-nowrap tabular-nums" title={`#${run.id}`}>
              {dayjs(run.started_at).format('DD.MM. HH:mm')}
            </td>
            <td class="py-1 pr-3 whitespace-nowrap">
              {$_(`page.integrations.kind.${run.kind}`)}
              <span class="text-xs text-surface-600-400">
                · {$_(`page.integrations.trigger.${run.trigger}`)}
              </span>
            </td>
            <td class="py-1 pr-3">
              <span class="flex flex-wrap gap-1">
                <span class="chip text-xs {runStatusClass(run.status)}">
                  {$_(`page.integrations.status.${run.status}`)}
                </span>
                {#if run.dry_run}
                  <span class="chip preset-tonal-surface text-xs">
                    {$_('page.integrations.dryRun')}
                  </span>
                {/if}
              </span>
            </td>
            <td class="py-1 pr-3 min-w-48">
              {parts.length > 0 ? parts.join(' · ') : $_('page.integrations.runs.noChange')}
              {#each acceptedOverrides(run) as accepted (accepted)}
                <code class="code text-xs ml-1">{accepted}</code>
              {/each}
            </td>
            <td class="py-1">
              {#if reason(run)}<code class="code text-xs">{reason(run)}</code>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
