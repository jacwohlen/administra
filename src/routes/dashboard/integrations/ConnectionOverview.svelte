<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faCircleExclamation,
    faLink,
    faListCheck,
    faSun,
    faTriangleExclamation,
    faUserMinus
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import relativeTime from 'dayjs/plugin/relativeTime';
  import {
    STALE_HOURS,
    connectionAlerts,
    isStale,
    refusalOverride,
    runStatusClass,
    type ConnectionStatus,
    type IntegrationAlert,
    type IntegrationRun,
    type SyncKind
  } from '$lib/integrations';

  dayjs.extend(relativeTime);

  /**
   * The head of a connection's card: what needs an admin (a refused run
   * with the exact override, a failed or stale one, open errors), the
   * numbers, and the latest run per kind.
   */
  let {
    connection,
    runs
  }: {
    connection: ConnectionStatus;
    /** The connection's runs on the page, for the guard numbers of a refusal */
    runs: IntegrationRun[];
  } = $props();

  const KINDS: SyncKind[] = ['members', 'events'];

  let alerts = $derived(connectionAlerts(connection));
  let provider = $derived(connection.display_name);

  let tiles = $derived([
    {
      icon: faLink,
      label: $_('page.integrations.kpi.membersLinked'),
      value: connection.members.linked
    },
    {
      icon: faUserMinus,
      label: $_('page.integrations.kpi.membersGone'),
      value: connection.members.gone
    },
    {
      icon: faCalendarDays,
      label: $_('page.integrations.kpi.eventsLinked'),
      value: connection.events.linked
    },
    { icon: faSun, label: $_('page.integrations.kpi.breaks'), value: connection.breaks },
    {
      icon: faCircleExclamation,
      label: $_('page.integrations.kpi.issues'),
      value: connection.issues.error + connection.issues.warning,
      alert: connection.issues.error > 0
    },
    {
      icon: faListCheck,
      label: $_('page.integrations.kpi.toReview'),
      value: connection.to_review.groups + connection.to_review.calendars
    }
  ]);

  function ago(at: string | null | undefined): string {
    return at ? dayjs(at).fromNow() : '';
  }

  function when(at: string | null | undefined): string {
    return at ? dayjs(at).format('DD.MM.YYYY HH:mm') : '';
  }

  function kindLabel(kind: SyncKind): string {
    return $_(`page.integrations.kind.${kind}`);
  }

  /** Which guard, what to check, and the exact override from the run's guard numbers */
  function refusalText(alert: Extract<IntegrationAlert, { code: 'refused' }>): string {
    const guard = runs.find((r) => r.id === alert.runId)?.guard;
    const override = refusalOverride(guard);
    const code = alert.refused ?? 'unknown';
    // Without the run's numbers (not among the runs loaded) only the code
    const known = code === 'empty_snapshot' || override !== null;
    const reason = known
      ? $_(`page.integrations.refused.${code}`, {
          values: { count: override?.count ?? 0, provider, code },
          default: $_('page.integrations.refused.unknown', { values: { code } })
        })
      : $_('page.integrations.refused.unknown', { values: { code } });
    const lines = [
      $_('page.integrations.alert.refused', { values: { kind: kindLabel(alert.kind) } }),
      reason
    ];
    if (override) {
      lines.push(
        $_(`page.integrations.override.${connection.runs_in}`, {
          values: { key: override.key, count: override.count }
        })
      );
    }
    return lines.join(' ');
  }

  function alertText(alert: IntegrationAlert): string {
    switch (alert.code) {
      case 'refused':
        return refusalText(alert);
      case 'failed':
        return $_('page.integrations.alert.failed', {
          values: { kind: kindLabel(alert.kind), error: alert.error ?? '–' }
        });
      case 'stale':
        return alert.lastSuccess
          ? $_('page.integrations.alert.stale', {
              values: {
                kind: kindLabel(alert.kind),
                ago: ago(alert.lastSuccess),
                hours: STALE_HOURS
              }
            })
          : $_('page.integrations.alert.staleNever', { values: { kind: kindLabel(alert.kind) } });
      case 'errors':
        return $_('page.integrations.alert.errors', { values: { count: alert.count } });
    }
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  <h2 class="flex-1 min-w-0 truncate mb-0">{provider}</h2>
  <span class="chip preset-tonal-surface text-xs">
    {$_(`page.integrations.runsIn.${connection.runs_in}`)}
  </span>
  {#if !connection.enabled}
    <span class="chip preset-tonal-warning text-xs">{$_('page.integrations.disabled')}</span>
  {/if}
</div>

{#each alerts as alert, i (i)}
  <div
    class="flex items-start gap-2 p-3 rounded-lg text-sm {alert.code === 'stale'
      ? 'preset-tonal-warning'
      : 'preset-tonal-error'}"
    role="alert"
  >
    <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
    <span class="min-w-0 break-words">{alertText(alert)}</span>
  </div>
{/each}

<section class="grid grid-cols-2 gap-2 sm:grid-cols-3">
  {#each tiles as tile (tile.label)}
    <div class="card border border-surface-200-800 p-3 flex items-center gap-3 min-w-0">
      <div class="entity-badge {tile.alert ? 'text-error-600-400' : 'text-primary-600-400'}">
        <Fa icon={tile.icon} />
      </div>
      <div class="min-w-0">
        <div class="text-2xl font-bold leading-tight tabular-nums">{tile.value}</div>
        <div class="text-xs leading-tight text-surface-600-400 hyphens-auto break-words">
          {tile.label}
        </div>
      </div>
    </div>
  {/each}
</section>

<dl class="grid gap-1 text-sm">
  {#each KINDS as kind (kind)}
    {@const last = connection.last_run[kind]}
    {@const success = connection.last_success[kind]}
    <div class="flex flex-wrap items-center gap-2">
      <dt class="font-medium w-24">{kindLabel(kind)}</dt>
      <dd class="flex flex-wrap items-center gap-2 min-w-0">
        {#if last}
          <span class="chip text-xs {runStatusClass(last.status)}">
            {$_(`page.integrations.status.${last.status}`)}
          </span>
          <span class="text-surface-600-400" title={when(last.finished_at ?? last.started_at)}>
            {ago(last.finished_at ?? last.started_at)}
          </span>
          {#if success && success !== last.finished_at}
            <span class="text-surface-600-400" title={when(success)}>
              · {$_('page.integrations.lastSuccess', { values: { ago: ago(success) } })}
            </span>
          {/if}
          {#if isStale(success, Date.now())}
            <span class="chip preset-tonal-warning text-xs">{$_('page.integrations.stale')}</span>
          {/if}
        {:else}
          <span class="text-surface-600-400">{$_('page.integrations.never')}</span>
        {/if}
      </dd>
    </div>
  {/each}
</dl>
