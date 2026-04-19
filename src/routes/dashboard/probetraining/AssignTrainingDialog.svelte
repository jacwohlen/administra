<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSpinner, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidate } from '$app/navigation';
  import { calculateAge } from '$lib/utils';
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

  let sorted = $derived.by(() => {
    const suggested: Training[] = [];
    const others: Training[] = [];
    for (const t of trainings) {
      if (assignedTrainingIds.has(Number(t.id))) continue;
      const matches =
        age !== null &&
        t.ageFrom !== undefined &&
        t.ageFrom !== null &&
        t.ageTo !== undefined &&
        t.ageTo !== null &&
        age >= t.ageFrom &&
        age <= t.ageTo;
      if (matches) suggested.push(t);
      else others.push(t);
    }
    return { suggested, others };
  });

  let submitting = $state(false);

  async function assign(trainingId: string | number) {
    submitting = true;
    try {
      const { error } = await supabaseClient.from('participants').insert({
        trainingId: Number(trainingId),
        memberId: member.id
      });
      if (error) throw error;
      toaster.success({ title: $_('page.probetraining.assignSuccess') });
      await invalidate('probetraining:list');
      onclose();
    } catch (e) {
      console.error(e);
      toaster.error({ title: $_('page.probetraining.assignError') });
    } finally {
      submitting = false;
    }
  }
</script>

<div class="space-y-4">
  <h3>{$_('page.probetraining.assignTitle')}</h3>
  <p class="text-sm text-surface-600-400">
    {member.firstname}
    {member.lastname}{#if age !== null}
      · {$_('page.probetraining.ageLabel')}: {age}
    {/if}
  </p>

  {#if sorted.suggested.length > 0}
    <div>
      <div class="flex items-center gap-2 mb-2 text-sm font-semibold">
        <Fa icon={faWandMagicSparkles} />
        <span>{$_('page.probetraining.suggestedTrainings')}</span>
      </div>
      <ul class="space-y-2">
        {#each sorted.suggested as t (t.id)}
          <li class="list-item border border-primary-500/40 rounded-md px-3">
            <span class="list-item-content">
              <dt class="font-bold truncate">{t.title}</dt>
              <dd class="text-xs text-surface-600-400">
                {$_('weekday.' + t.weekday)} · {t.dateFrom} · {t.section} · {t.ageFrom}–{t.ageTo}
              </dd>
            </span>
            <button
              class="btn preset-filled-primary-500 flex-shrink-0"
              disabled={submitting}
              onclick={() => assign(t.id)}
            >
              {$_('page.probetraining.assign')}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div>
    <div class="mb-2 text-sm font-semibold">
      {$_('page.probetraining.otherTrainings')}
    </div>
    {#if sorted.others.length === 0}
      <p class="text-sm text-surface-600-400">{$_('page.probetraining.noOtherTrainings')}</p>
    {:else}
      <ul class="space-y-2">
        {#each sorted.others as t (t.id)}
          <li class="list-item">
            <span class="list-item-content">
              <dt class="font-bold truncate">{t.title}</dt>
              <dd class="text-xs text-surface-600-400">
                {$_('weekday.' + t.weekday)} · {t.dateFrom} · {t.section}{#if t.ageFrom != null && t.ageTo != null}
                  · {t.ageFrom}–{t.ageTo}
                {/if}
              </dd>
            </span>
            <button
              class="btn preset-tonal-primary flex-shrink-0"
              disabled={submitting}
              onclick={() => assign(t.id)}
            >
              {$_('page.probetraining.assign')}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <footer class="flex justify-end gap-2">
    <button class="btn preset-tonal-surface" disabled={submitting} onclick={onclose}>
      {$_('button.cancel')}
    </button>
    {#if submitting}
      <span class="btn"><Fa icon={faSpinner} spin /></span>
    {/if}
  </footer>
</div>
