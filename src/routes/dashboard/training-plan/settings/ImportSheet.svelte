<script lang="ts">
  import Fa from 'svelte-fa';
  import { faFileImport, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import {
    buildImport,
    matchLeader,
    parseSheet,
    sheetLeaders,
    type SheetRow
  } from '$lib/trainingPlanImport';
  import type { PlanTraining } from '$lib/trainingPlanUtils';
  import type { TrainingPlanBreak } from '$lib/models';
  import TrainerSelect from '../TrainerSelect.svelte';
  import type { PlanMember } from '../members';

  let {
    trainings,
    members,
    breaks,
    onimported
  }: {
    /** The planned trainings; the sheet's rows go to these */
    trainings: PlanTraining[];
    members: PlanMember[];
    /** Holidays already entered, not imported twice */
    breaks: TrainingPlanBreak[];
    onimported: () => void;
  } = $props();

  let text = $state('');
  let rows = $state<SheetRow[] | null>(null);
  let leaderIds = $state<Record<string, number | null | 'keep' | 'none'>>({});
  /** Per found holiday: imported, and whether it closes the dojo */
  let holidayChoice = $state<{ use: boolean; closed: boolean }[]>([]);
  let busy = $state(false);

  function read(value: string) {
    text = value;
    rows = value.trim() ? parseSheet(value) : null;
    const ids: Record<string, number | null> = {};
    for (const name of rows ? sheetLeaders(rows) : []) ids[name] = matchLeader(name, members);
    leaderIds = ids;
    holidayChoice = (result?.breaks ?? []).map((b) => ({
      use: !exists(b),
      closed: b.cancels_training
    }));
  }

  async function readFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) read(await file.text());
  }

  let result = $derived(
    rows
      ? buildImport(
          rows,
          trainings,
          new Map(Object.entries(leaderIds).map(([k, v]) => [k, typeof v === 'number' ? v : null]))
        )
      : null
  );
  let leaders = $derived(Object.keys(leaderIds));
  let range = $derived(
    result && result.sessions.length > 0
      ? {
          from: result.sessions[0].date,
          to: result.sessions[result.sessions.length - 1].date
        }
      : null
  );

  function exists(b: { title: string; date_from: string; date_to: string }) {
    return breaks.some(
      (e) => e.title === b.title && e.date_from === b.date_from && e.date_to === b.date_to
    );
  }

  function period(b: { date_from: string; date_to: string }) {
    const to = dayjs(b.date_to).format('DD.MM.YYYY');
    return b.date_from === b.date_to ? to : `${dayjs(b.date_from).format('DD.MM.')} – ${to}`;
  }

  async function runImport() {
    if (!result) return;
    busy = true;
    const newBreaks = result.breaks
      .map((b, i) => ({ ...b, cancels_training: holidayChoice[i]?.closed ?? b.cancels_training }))
      .filter((_, i) => holidayChoice[i]?.use);
    let error = null;
    // In portions, so a whole year stays well below request limits
    for (let i = 0; i < result.sessions.length && !error; i += 200) {
      ({ error } = await supabaseClient
        .from('training_plan_sessions')
        .upsert(result.sessions.slice(i, i + 200), { onConflict: 'training_id,date' }));
    }
    if (!error && newBreaks.length > 0) {
      ({ error } = await supabaseClient.from('training_plan_breaks').insert(newBreaks));
    }
    busy = false;
    if (error) {
      console.error('Error importing the training plan:', error);
      toaster.error({ title: $_('page.trainingPlan.import.error') });
      return;
    }
    toaster.success({
      title: $_('page.trainingPlan.import.done', {
        values: { sessions: result.sessions.length, breaks: newBreaks.length }
      })
    });
    read('');
    onimported();
  }
</script>

<p class="text-sm text-surface-600-400 mb-2">{$_('page.trainingPlan.import.hint')}</p>

{#if trainings.length === 0}
  <div class="empty-state"><p>{$_('page.trainingPlan.import.noTrainings')}</p></div>
{:else}
  <textarea
    class="textarea font-mono text-xs"
    rows="5"
    placeholder={$_('page.trainingPlan.import.placeholder')}
    bind:value={text}
    oninput={() => read(text)}
  ></textarea>
  <label class="flex items-center gap-2 text-sm mt-2">
    <span>{$_('page.trainingPlan.import.file')}</span>
    <input type="file" accept=".csv,.tsv,.txt,text/csv" class="text-sm" onchange={readFile} />
  </label>

  {#if text.trim() && rows === null}
    <p class="text-sm text-error-600-400 mt-2">{$_('page.trainingPlan.import.noHeader')}</p>
  {:else if result}
    <div class="card border border-surface-200-800 p-3 mt-3 space-y-4">
      {#if range}
        <p class="text-sm">
          {$_('page.trainingPlan.import.summary', {
            values: {
              sessions: result.sessions.length,
              cancelled: result.sessions.filter((s) => s.cancelled).length,
              from: dayjs(range.from).format('DD.MM.YYYY'),
              to: dayjs(range.to).format('DD.MM.YYYY')
            }
          })}
          {#if result.skipped > 0}
            {$_('page.trainingPlan.import.skipped', { values: { count: result.skipped } })}
          {/if}
        </p>
      {:else}
        <p class="text-sm">{$_('page.trainingPlan.import.nothing')}</p>
      {/if}

      {#if leaders.length > 0}
        <div>
          <p class="font-semibold text-sm">{$_('page.trainingPlan.import.leaders')}</p>
          <p class="text-xs text-surface-600-400 mb-2">
            {$_('page.trainingPlan.import.leadersHint')}
          </p>
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
            {#each leaders as name (name)}
              <span class="text-sm truncate">{name}</span>
              <TrainerSelect {members} bind:value={leaderIds[name]} />
            {/each}
          </div>
        </div>
      {/if}

      {#if result.breaks.length > 0}
        <div>
          <p class="font-semibold text-sm">{$_('page.trainingPlan.import.holidays')}</p>
          <p class="text-xs text-surface-600-400 mb-2">
            {$_('page.trainingPlan.import.holidaysHint')}
          </p>
          <ul class="space-y-1">
            {#each result.breaks as b, i (b.title + b.date_from)}
              {#if holidayChoice[i]}
                <li class="flex flex-wrap items-center gap-x-3 text-sm">
                  <label class="flex items-center gap-2 flex-1 min-w-0">
                    <input class="checkbox" type="checkbox" bind:checked={holidayChoice[i].use} />
                    <span class="font-semibold">{b.title}</span>
                    <span class="text-surface-600-400">{period(b)}</span>
                    {#if exists(b)}
                      <span class="text-xs text-surface-600-400"
                        >({$_('page.trainingPlan.import.exists')})</span
                      >
                    {/if}
                  </label>
                  <label class="flex items-center gap-1">
                    <input
                      class="checkbox"
                      type="checkbox"
                      bind:checked={holidayChoice[i].closed}
                      disabled={!holidayChoice[i].use}
                    />
                    <span>{$_('page.trainingPlan.settings.closedShort')}</span>
                  </label>
                </li>
              {/if}
            {/each}
          </ul>
        </div>
      {/if}

      {#if result.sessions.length > 0}
        <div class="flex items-start gap-2 p-2 rounded preset-tonal-warning text-sm">
          <Fa icon={faTriangleExclamation} class="mt-0.5" />
          <span>{$_('page.trainingPlan.import.overwrite')}</span>
        </div>
        <button class="btn preset-filled-primary-500" onclick={runImport} disabled={busy}>
          <Fa icon={faFileImport} />
          <span>
            {busy
              ? $_('button.saving')
              : $_('page.trainingPlan.import.run', {
                  values: { count: result.sessions.length }
                })}
          </span>
        </button>
      {/if}
    </div>
  {/if}
{/if}
