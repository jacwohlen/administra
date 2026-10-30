<script lang="ts">
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowUpRightFromSquare,
    faCalendarPlus,
    faCopy,
    faRotate,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import { modalDialog } from '$lib/modalDialog';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import {
    calendarFeedUrl,
    googleCalendarUrl,
    webcalUrl,
    type FeedKind,
    type FeedLocale
  } from '$lib/calendarFeed';

  /**
   * The training plan as calendar feeds (all staff): the secret links of
   * "Meine Trainings" and "Alle Trainings" to copy or open in a calendar app.
   * "Link erneuern" replaces the account's token, so the old links stop
   * working (docs/TRAINING_PLAN.md).
   */
  let { onclose }: { onclose: () => void } = $props();

  let token = $state<string | null>(null);
  /** Whether the account has a member, whose trainings "Meine Trainings" shows */
  let linked = $state(false);
  let loadFailed = $state(false);
  let confirming = $state(false);
  let renewing = $state(false);

  // The feed's texts are in the language the app is in now
  let feedLocale = $derived<FeedLocale>($locale?.startsWith('de') ? 'de' : 'en');
  let urls = $derived(
    token
      ? {
          mine: calendarFeedUrl(window.location.origin, token, 'mine', feedLocale),
          all: calendarFeedUrl(window.location.origin, token, 'all', feedLocale)
        }
      : null
  );

  onMount(async () => {
    try {
      const [tokenResult, membersResult] = await Promise.all([
        supabaseClient.rpc('calendar_feed_token'),
        supabaseClient.rpc('my_member_ids')
      ]);
      const error = tokenResult.error ?? membersResult.error;
      if (error || typeof tokenResult.data !== 'string') throw error ?? new Error('No token');
      token = tokenResult.data;
      linked = Array.isArray(membersResult.data) && membersResult.data.length > 0;
    } catch (error) {
      console.error('Error loading the calendar links:', error);
      loadFailed = true;
      toaster.error({ title: $_('page.trainingPlan.calendar.loadError') });
    }
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toaster.success({ title: $_('page.trainingPlan.calendar.copied') });
    } catch {
      toaster.error({ title: $_('page.trainingPlan.calendar.copyError') });
    }
  }

  async function renew() {
    renewing = true;
    const { data, error } = await supabaseClient.rpc('calendar_feed_token', { p_renew: true });
    renewing = false;
    confirming = false;
    if (error || typeof data !== 'string') {
      console.error('Error renewing the calendar links:', error);
      toaster.error({ title: $_('page.trainingPlan.calendar.renewError') });
      return;
    }
    token = data;
    toaster.success({ title: $_('page.trainingPlan.calendar.renewed') });
  }
</script>

{#snippet feed(kind: FeedKind, url: string)}
  {@const title = $_(`page.trainingPlan.calendar.${kind}.title`)}
  <section class="space-y-2">
    <h4 class="font-semibold">{title}</h4>
    <p class="text-sm text-surface-600-400">
      {$_(`page.trainingPlan.calendar.${kind}.description`)}
    </p>
    {#if kind === 'mine' && !linked}
      <p
        class="flex items-start gap-2 rounded-md bg-warning-500/10 px-3 py-2 text-sm text-warning-800-200"
      >
        <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
        <span>{$_('page.trainingPlan.calendar.mine.notLinked')}</span>
      </p>
    {:else}
      <input
        class="input font-mono text-xs"
        type="text"
        readonly
        value={url}
        aria-label={$_('page.trainingPlan.calendar.link', { values: { feed: title } })}
        onfocus={(e) => e.currentTarget.select()}
      />
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm preset-tonal-surface flex-1"
          onclick={() => copy(url)}
        >
          <Fa icon={faCopy} size="xs" />
          <span>{$_('page.trainingPlan.calendar.copy')}</span><span class="sr-only">: {title}</span>
        </button>
        <a
          class="btn btn-sm preset-tonal-surface flex-1"
          href={webcalUrl(url)}
          title={$_('page.trainingPlan.calendar.appHint')}
        >
          <Fa icon={faCalendarPlus} size="xs" />
          <span>{$_('page.trainingPlan.calendar.app')}</span><span class="sr-only">: {title}</span>
        </a>
        <a
          class="btn btn-sm preset-tonal-surface flex-1"
          href={googleCalendarUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          title={$_('page.trainingPlan.calendar.googleHint')}
        >
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
          <span>{$_('page.trainingPlan.calendar.google')}</span><span class="sr-only"
            >: {title}</span
          >
        </a>
      </div>
    {/if}
  </section>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape' && !confirming) onclose();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    use:modalDialog
    class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto space-y-4"
    onclick={(e) => e.stopPropagation()}
  >
    <h3>{$_('page.trainingPlan.calendar.title')}</h3>
    <p class="text-sm">{$_('page.trainingPlan.calendar.intro')}</p>

    {#if loadFailed}
      <p class="text-error-600-400">{$_('page.trainingPlan.calendar.loadError')}</p>
    {:else if !urls}
      <p class="flex items-center gap-2">
        <Fa icon={faSpinner} spin />
        {$_('page.trainingPlan.calendar.loading')}
      </p>
    {:else}
      {@render feed('mine', urls.mine)}
      {@render feed('all', urls.all)}

      <ul class="list-disc pl-5 space-y-1 text-xs text-surface-600-400">
        <li>{$_('page.trainingPlan.calendar.secret')}</li>
        <li>{$_('page.trainingPlan.calendar.refresh')}</li>
        <li>{$_('page.trainingPlan.calendar.language')}</li>
      </ul>
    {/if}

    <footer class="flex flex-wrap justify-between gap-2 pt-2">
      {#if urls}
        <button
          type="button"
          class="btn preset-tonal-surface"
          disabled={renewing}
          onclick={() => (confirming = true)}
        >
          <Fa icon={faRotate} />
          <span>{$_('page.trainingPlan.calendar.renew')}</span>
        </button>
      {/if}
      <button type="button" class="btn preset-tonal-surface ml-auto" onclick={onclose}>
        {$_('button.close')}
      </button>
    </footer>
  </div>
</div>

{#if confirming}
  <ConfirmDialog
    title={$_('page.trainingPlan.calendar.renewTitle')}
    message={$_('page.trainingPlan.calendar.renewMessage')}
    confirmLabel={$_('page.trainingPlan.calendar.renew')}
    busy={renewing}
    onconfirm={renew}
    oncancel={() => (confirming = false)}
  />
{/if}
