<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faSpinner,
    faWandMagicSparkles,
    faXmark,
    faPlus,
    faUsers
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidate } from '$app/navigation';
  import { calculateAge } from '$lib/utils';
  import { splitTrainingsByAge } from '$lib/trialUtils';
  import type { Training, TrainingActivity, TrialMember } from '$lib/models';

  let {
    member,
    trainings,
    activityByTraining,
    assignedTrainingIds,
    onclose,
    onassigned
  }: {
    member: TrialMember;
    trainings: Training[];
    activityByTraining: Map<number, TrainingActivity>;
    assignedTrainingIds: Set<number>;
    onclose: () => void;
    /** After a training was assigned; defaults to closing. */
    onassigned?: () => void;
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
      (onassigned ?? onclose)();
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

{#snippet activity(t: Training)}
  {@const a = activityByTraining.get(Number(t.id))}
  {#if a}
    <span
      class="flex items-center gap-1 text-xs text-surface-600-400"
      title={$_('page.probetraining.activityHint')}
    >
      <Fa icon={faUsers} size="xs" />
      {$_('page.probetraining.activeCount', { values: { count: a.activeCount } })}
      {#if a.trialCount > 0}
        · {$_('page.probetraining.trialCount', { values: { count: a.trialCount } })}
      {/if}
    </span>
  {/if}
{/snippet}

<div class="space-y-4">
  <header class="flex items-center gap-3">
    <span class="avatar-initials bg-primary-500/15! text-primary-700-300">
      {member.lastname.charAt(0)}{member.firstname.charAt(0)}
    </span>
    <span class="min-w-0">
      <h3 class="mb-0!">{$_('page.probetraining.manageTitle')}</h3>
      <span class="block text-sm text-surface-600-400 truncate">
        {[
          `${member.firstname} ${member.lastname}`,
          age !== null ? `${age} ${$_('page.probetraining.yearsOld')}` : null,
          member.trialSection
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </span>
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
                {@render activity(t)}
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
                {@render activity(t)}
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
            <li class="flex items-center gap-2 rounded-md border border-surface-200-800 px-3 py-2">
              <span class="flex-1 min-w-0">
                <span class="font-medium block truncate">{t.title}</span>
                <span class="text-xs text-surface-600-400">
                  {$_('weekday.' + t.weekday)} · {t.dateFrom} · {t.section}{#if t.ageFrom != null && t.ageTo != null}
                    · {t.ageFrom}–{t.ageTo}
                    {$_('page.probetraining.yearsOld')}{/if}
                </span>
                {@render activity(t)}
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
