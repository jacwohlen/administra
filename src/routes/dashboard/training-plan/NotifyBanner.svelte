<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faEnvelope } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { computeNotices, type MailScope, type NoticeSet } from '$lib/trainingPlanMail';
  import { loadMailPlan } from '$lib/trainingPlanMailData';
  import type { MailMode } from '$lib/trainingPlanMailClient';

  /**
   * "Trainer informieren" on the plan page: how many trainers have changes
   * they were not told yet (docs/TRAINING_PLAN.md). Loads the plan from today
   * on and what each trainer was told, apart from the page's own year, and
   * shows nothing when nobody is pending or the load fails.
   */
  let {
    mode,
    scope,
    reloadKey,
    waiting = false,
    version = 0,
    onopen
  }: {
    /** smtp: mails leave; demo, test: sending is simulated */
    mode: MailMode;
    scope: MailScope;
    /** The page's data: loaded again whenever the plan was reloaded */
    reloadKey: unknown;
    /** The plan is being reloaded with what the table saved: wait for it */
    waiting?: boolean;
    /** Counts up when the dialog closes: loaded again */
    version?: number;
    onopen: () => void;
  } = $props();

  let set = $state.raw<NoticeSet | null>(null);
  // Only the answer to the latest load counts
  let request = 0;

  $effect(() => {
    void reloadKey;
    void version;
    if (waiting) return;
    const current = scope;
    const id = ++request;
    loadMailPlan(supabaseClient, current)
      .then((data) => {
        if (id === request) set = computeNotices(data, current);
      })
      .catch((error) => {
        if (id !== request) return;
        console.error('Error loading the plan mails:', error);
        set = null;
      });
  });
</script>

{#if set && set.members.length > 0}
  <div
    class="flex flex-wrap items-start gap-x-2 gap-y-3 p-3 mb-4 rounded-lg preset-tonal-warning text-sm print:hidden"
  >
    <Fa icon={faEnvelope} class="mt-0.5 flex-none" />
    <div class="flex-1 min-w-[12rem] space-y-1">
      <p>
        {set.firstTime
          ? $_('page.trainingPlan.notify.bannerFirst', { values: { count: set.members.length } })
          : $_('page.trainingPlan.notify.banner', { values: { count: set.members.length } })}
      </p>
      {#if mode === 'demo' || mode === 'test'}
        <p class="text-xs opacity-80">{$_(`page.trainingPlan.notify.${mode}`)}</p>
      {/if}
    </div>
    <button type="button" class="btn btn-sm preset-filled-warning-500 ml-auto" onclick={onopen}>
      {$_('page.trainingPlan.notify.button')}
    </button>
  </div>
{/if}
