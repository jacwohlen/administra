<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faSpinner,
    faWandMagicSparkles,
    faXmark,
    faPlus
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidate } from '$app/navigation';
  import { calculateAge } from '$lib/utils';
  import { splitTrainingsByAge } from '$lib/trialUtils';
  import type { Training, TrialMember } from '$lib/models';

  let {
    member,
    trainings,
    assignedTrainingIds,
    onclose
  }: {
    member: TrialMember;
    trainings: Training[];
    assignedTrainingIds: Set<number>;
    onclose: () => void;
  } = $props();

  let age = $derived(calculateAge(member.birthday));
  let assignedList = $derived(trainings.filter((t) => assignedTrainingIds.has(Number(t.id))));
  let split = $derived(splitTrainingsByAge(trainings, age, assignedTrainingIds));

  let busy = $state(false);

  async function assign(trainingId: string | number) {
    busy = true;
    try {
      const { error } = await supabaseClient
        .from('participants')
        .insert({ trainingId: Number(trainingId), memberId: member.id });
      if (error) throw error;
      toaster.success({ title: $_('page.probetraining.assignSuccess') });
      await invalidate('probetraining:list');
      onclose();
    } catch (e) {
      console.error('Error assigning training:', e);
      toaster.error({ title: $_('page.probetraining.assignError') });
    } finally {
      busy = false;
    }
  }

  async function unassign(trainingId: string | number) {
    busy = true;
    try {
      const { error } = await supabaseClient
        .from('participants')
        .delete()
        .eq('trainingId', Number(trainingId))
        .eq('memberId', member.id);
      if (error) throw error;
      toaster.success({ title: $_('page.probetraining.removeSuccess') });
      await invalidate('probetraining:list');
      onclose();
    } catch (e) {
      console.error('Error removing training assignment:', e);
      toaster.error({ title: $_('page.probetraining.removeError') });
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-4">
  <header>
    <h3>{$_('page.probetraining.manageTitle')}</h3>
    <p class="text-sm text-surface-600-400">
      {member.firstname}
      {member.lastname}{#if age !== null}
        · {age} {$_('page.probetraining.yearsOld')}{/if}
    </p>
  </header>

  <div class="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
    {#if assignedList.length > 0}
      <section>
        <h4 class="text-sm font-semibold mb-2">{$_('page.probetraining.assignedTrainings')}</h4>
        <ul class="space-y-1">
          {#each assignedList as t (t.id)}
            <li class="flex items-center gap-2 rounded-md bg-surface-100-900 px-3 py-2">
              <span class="flex-1 min-w-0">
                <span class="font-medium block truncate">{t.title}</span>
                <span class="text-xs text-surface-600-400">
                  {$_('weekday.' + t.weekday)} · {t.dateFrom} · {t.section}
                </span>
              </span>
              <button
                class="btn-icon preset-tonal-error flex-shrink-0"
                disabled={busy}
                title={$_('button.remove')}
                aria-label="{$_('button.remove')}: {t.title}"
                onclick={() => unassign(t.id)}
              >
                <Fa icon={faXmark} />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h4 class="text-sm font-semibold mb-2 flex items-center gap-2">
        <Fa icon={faWandMagicSparkles} size="xs" />
        {$_('page.probetraining.suggestedTrainings')}
      </h4>
      {#if split.suggested.length === 0}
        <p class="text-xs text-surface-600-400">
          {age === null
            ? $_('page.probetraining.noBirthday')
            : $_('page.probetraining.noSuggestion')}
        </p>
      {:else}
        <ul class="space-y-1">
          {#each split.suggested as t (t.id)}
            <li
              class="flex items-center gap-2 rounded-md border border-primary-500/50 bg-primary-500/5 px-3 py-2"
            >
              <span class="flex-1 min-w-0">
                <span class="font-medium block truncate">{t.title}</span>
                <span class="text-xs text-surface-600-400">
                  {$_('weekday.' + t.weekday)} · {t.dateFrom} · {t.section} · {t.ageFrom}–{t.ageTo}
                  {$_('page.probetraining.yearsOld')}
                </span>
              </span>
              <button
                class="btn btn-sm preset-filled-primary-500 flex-shrink-0"
                disabled={busy}
                onclick={() => assign(t.id)}
              >
                <Fa icon={faPlus} size="xs" />
                <span>{$_('page.probetraining.assign')}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h4 class="text-sm font-semibold mb-2">{$_('page.probetraining.otherTrainings')}</h4>
      {#if split.others.length === 0}
        <p class="text-xs text-surface-600-400">{$_('page.probetraining.noOtherTrainings')}</p>
      {:else}
        <ul class="space-y-1">
          {#each split.others as t (t.id)}
            <li class="flex items-center gap-2 px-3 py-2">
              <span class="flex-1 min-w-0">
                <span class="font-medium block truncate">{t.title}</span>
                <span class="text-xs text-surface-600-400">
                  {$_('weekday.' + t.weekday)} · {t.dateFrom} · {t.section}{#if t.ageFrom != null && t.ageTo != null}
                    · {t.ageFrom}–{t.ageTo}
                    {$_('page.probetraining.yearsOld')}{/if}
                </span>
              </span>
              <button
                class="btn btn-sm preset-tonal-primary flex-shrink-0"
                disabled={busy}
                onclick={() => assign(t.id)}
              >
                <Fa icon={faPlus} size="xs" />
                <span>{$_('page.probetraining.assign')}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <footer class="flex justify-end items-center gap-2">
    {#if busy}
      <Fa icon={faSpinner} spin />
    {/if}
    <button class="btn preset-tonal-surface" disabled={busy} onclick={onclose}>
      {$_('button.close')}
    </button>
  </footer>
</div>
