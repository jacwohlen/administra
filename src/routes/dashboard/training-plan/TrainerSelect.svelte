<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { PlanMember } from './members';

  let {
    members,
    value = $bindable(),
    allowKeep = false,
    allowNone = false,
    id
  }: {
    members: PlanMember[];
    /**
     * Member id, null for "open", 'keep' to leave it as it is (several rows),
     * 'none' for no training (rotation)
     */
    value: number | null | 'keep' | 'none';
    allowKeep?: boolean;
    allowNone?: boolean;
    id?: string;
  } = $props();

  let trainers = $derived(members.filter((m) => m.trainer));
  let others = $derived(members.filter((m) => !m.trainer));
</script>

<select {id} class="select" bind:value>
  {#if allowKeep}
    <option value="keep">{$_('page.trainingPlan.keep')}</option>
  {/if}
  <option value={null}>{$_('page.trainingPlan.trainerOpen')}</option>
  {#if allowNone}
    <option value="none">{$_('page.trainingPlan.rotation.none')}</option>
  {/if}
  {#if trainers.length > 0}
    <optgroup label={$_('page.trainingPlan.trainers')}>
      {#each trainers as m (m.id)}
        <option value={m.id}>{m.firstname} {m.lastname}</option>
      {/each}
    </optgroup>
  {/if}
  <optgroup label={$_('page.trainingPlan.otherMembers')}>
    {#each others as m (m.id)}
      <option value={m.id}>{m.firstname} {m.lastname}</option>
    {/each}
  </optgroup>
</select>
