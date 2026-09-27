<script lang="ts">
  import type { PageData } from './$types';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faHourglassHalf,
    faCalendarCheck,
    faInbox,
    faBan,
    faUserCheck,
    faLinkSlash,
    faSpinner,
    faArrowUpRightFromSquare
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { invalidate } from '$app/navigation';
  import { supabaseClient } from '$lib/supabase';
  import { clubConfig } from '$lib/clubConfig';
  import ClubLogo from '$lib/components/ClubLogo.svelte';
  import { setPublicLocale } from '$lib/publicLocale';
  import { formatTrainingLines } from '$lib/trialMail';

  let { data }: { data: PageData } = $props();

  let confirming = $state(false);
  let cancelling = $state(false);
  let cancelError = $state(false);

  let status = $derived(data.status);
  let active = $derived(status !== null && ['new', 'waitlist', 'assigned'].includes(status.status));

  const ICON = {
    new: faInbox,
    waitlist: faHourglassHalf,
    assigned: faCalendarCheck,
    cancelled: faBan,
    member: faUserCheck
  } as const;

  const TONE = {
    new: 'bg-primary-500/15 text-primary-700-300',
    waitlist: 'bg-warning-500/20 text-warning-800-200',
    assigned: 'bg-success-500/20 text-success-800-200',
    cancelled: 'bg-surface-200-800 text-surface-600-400',
    member: 'bg-success-500/20 text-success-800-200'
  } as const;

  /** Progress through the intake: registered → place found → training. */
  let steps = $derived.by(() => {
    if (!status) return [];
    const s = status.status;
    const placed = s === 'assigned' || s === 'member';
    return [
      { key: 'registered', done: true, current: false },
      {
        key: s === 'waitlist' ? 'waitlist' : 'searching',
        done: placed,
        current: s === 'new' || s === 'waitlist'
      },
      { key: 'training', done: s === 'member', current: s === 'assigned' }
    ];
  });

  function date(iso: string | null): string {
    return iso ? dayjs(iso).format('DD.MM.YYYY') : '';
  }

  let trainingLines = $derived(
    status
      ? formatTrainingLines(status.trainings, $locale?.startsWith('en') ? 'en' : 'de')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.replace(/^- /, ''))
      : []
  );

  async function cancel() {
    cancelling = true;
    cancelError = false;
    try {
      const { data: ok, error } = await supabaseClient.rpc('cancel_trial', {
        p_token: data.token
      });
      if (error || !ok) throw error ?? new Error('not cancelled');
      confirming = false;
      await invalidate('probetraining:status');
    } catch (e) {
      console.error('Cancelling trial failed:', e);
      cancelError = true;
    } finally {
      cancelling = false;
    }
  }
</script>

<svelte:head>
  <title>{clubConfig.name} – {$_('page.trialStatus.title')}</title>
  <!-- Personal page behind a secret link: keep it out of search engines and referrers. -->
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<!-- Scrolls itself, like the registration form (see /probetraining). -->
<div class="h-full overflow-y-auto">
  <div class="max-w-lg mx-auto px-4 py-8 space-y-4">
    <div class="flex justify-end">
      <div class="flex items-center gap-1 text-xs" role="group" aria-label="Sprache / Language">
        {#each ['de', 'en'] as const as l (l)}
          <button
            type="button"
            class="btn btn-sm {$locale?.startsWith(l)
              ? 'preset-filled-primary-500'
              : 'preset-tonal-surface'}"
            aria-pressed={$locale?.startsWith(l)}
            onclick={() => setPublicLocale(l)}
          >
            {l.toUpperCase()}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex flex-col items-center">
      <ClubLogo class="h-20 w-auto" />
      <p class="mt-3 text-sm font-semibold tracking-wide text-surface-700-300">
        {clubConfig.name}
      </p>
      <h1 class="mt-1 text-center">{$_('page.trialStatus.title')}</h1>
    </div>

    {#if !status}
      <section class="card border border-surface-200-800 p-6 text-center space-y-3">
        <div class="flex justify-center">
          <span
            class="size-14 rounded-full bg-surface-200-800 text-surface-600-400 flex items-center justify-center text-xl"
          >
            <Fa icon={faLinkSlash} />
          </span>
        </div>
        <h2>{$_('page.trialStatus.notFound.title')}</h2>
        <p class="text-surface-600-400">{$_('page.trialStatus.notFound.text')}</p>
        {#if clubConfig.contactEmail}
          <a class="anchor" href="mailto:{clubConfig.contactEmail}">{clubConfig.contactEmail}</a>
        {/if}
      </section>
    {:else}
      <section class="card border border-surface-200-800 overflow-hidden">
        <div class="h-2 bg-linear-to-r from-primary-500/40 to-tertiary-500/30"></div>
        <div class="p-5 space-y-5">
          <p class="text-lg">
            {$_('page.trialStatus.greeting', { values: { name: status.firstname } })}
          </p>

          <div class="flex items-start gap-4">
            <span
              class="size-12 rounded-full flex items-center justify-center flex-shrink-0 text-lg {TONE[
                status.status
              ]}"
            >
              <Fa icon={ICON[status.status]} />
            </span>
            <div class="min-w-0 space-y-1">
              <h2 class="mb-0!">
                {$_(
                  status.status === 'cancelled' && status.selfCancelled
                    ? 'page.trialStatus.state.selfCancelled.title'
                    : `page.trialStatus.state.${status.status}.title`
                )}
              </h2>
              <p class="text-surface-700-300">
                {$_(
                  status.status === 'cancelled' && status.selfCancelled
                    ? 'page.trialStatus.state.selfCancelled.text'
                    : `page.trialStatus.state.${status.status}.text`,
                  { values: { club: clubConfig.name } }
                )}
              </p>
              {#if status.status === 'waitlist' && status.statusChangedAt}
                <p class="text-xs text-surface-600-400">
                  {$_('page.trialStatus.waitlistSince', {
                    values: { date: date(status.statusChangedAt) }
                  })}
                </p>
              {/if}
            </div>
          </div>

          {#if status.status === 'assigned' && trainingLines.length > 0}
            <ul class="space-y-2">
              {#each trainingLines as line (line)}
                <li
                  class="flex items-center gap-3 rounded-md border border-success-500/40 bg-success-500/5 px-3 py-2"
                >
                  <Fa icon={faCalendarCheck} class="text-success-700-300" />
                  <span class="font-medium">{line}</span>
                </li>
              {/each}
            </ul>
            <p class="text-sm text-surface-600-400">{$_('page.trialStatus.assignedHint')}</p>
          {/if}

          {#if status.status !== 'cancelled'}
            <!-- Where the registration stands -->
            <ol class="grid grid-cols-3 gap-2 pt-1" aria-label={$_('page.trialStatus.progress')}>
              {#each steps as step (step.key)}
                <li class="flex flex-col items-center gap-1 text-center">
                  <span
                    class="size-7 rounded-full flex items-center justify-center text-xs {step.done
                      ? 'preset-filled-success-500'
                      : step.current
                        ? 'preset-filled-primary-500'
                        : 'bg-surface-200-800 text-surface-500'}"
                    aria-current={step.current ? 'step' : undefined}
                  >
                    {#if step.done}
                      <Fa icon={faCheck} size="xs" />
                    {:else}
                      <span class="size-2 rounded-full bg-current"></span>
                    {/if}
                  </span>
                  <span
                    class="text-xs {step.current
                      ? 'font-semibold'
                      : 'text-surface-600-400'} leading-tight"
                  >
                    {$_(`page.trialStatus.step.${step.key}`)}
                  </span>
                </li>
              {/each}
            </ol>
          {/if}

          <dl class="grid grid-cols-2 gap-2 text-sm">
            {#if status.registeredAt}
              <div class="rounded-md bg-surface-100-900 px-3 py-2">
                <dt class="text-xs text-surface-600-400">{$_('page.trialStatus.registeredOn')}</dt>
                <dd>{date(status.registeredAt)}</dd>
              </div>
            {/if}
            {#if status.section}
              <div class="rounded-md bg-surface-100-900 px-3 py-2">
                <dt class="text-xs text-surface-600-400">{$_('page.trialStatus.section')}</dt>
                <dd>{status.section}</dd>
              </div>
            {/if}
          </dl>
        </div>
      </section>

      {#if active}
        <section class="card border border-surface-200-800 p-5 space-y-3">
          <h3 class="mb-0!">{$_('page.trialStatus.cancel.title')}</h3>
          <p class="text-sm text-surface-600-400">{$_('page.trialStatus.cancel.text')}</p>
          {#if confirming}
            <div
              class="rounded-md border border-error-500/40 bg-error-500/5 p-3 space-y-3"
              role="alertdialog"
              aria-label={$_('page.trialStatus.cancel.title')}
            >
              <p class="text-sm">{$_('page.trialStatus.cancel.confirm')}</p>
              <div class="flex flex-wrap justify-end gap-2">
                <button
                  class="btn preset-tonal-surface"
                  disabled={cancelling}
                  onclick={() => (confirming = false)}
                >
                  {$_('page.trialStatus.cancel.keep')}
                </button>
                <button class="btn preset-filled-error-500" disabled={cancelling} onclick={cancel}>
                  {#if cancelling}
                    <Fa icon={faSpinner} spin />
                  {/if}
                  <span>{$_('page.trialStatus.cancel.yes')}</span>
                </button>
              </div>
            </div>
          {:else}
            <button class="btn preset-tonal-error" onclick={() => (confirming = true)}>
              <Fa icon={faBan} size="xs" />
              <span>{$_('page.trialStatus.cancel.button')}</span>
            </button>
          {/if}
          {#if cancelError}
            <p class="text-sm text-error-600-400">{$_('page.trialStatus.cancel.error')}</p>
          {/if}
        </section>
      {/if}

      <div class="text-center space-y-2 text-sm text-surface-600-400">
        {#if clubConfig.contactEmail}
          <p>
            {$_('page.trialRegistration.contactHint')}
            <a class="underline" href="mailto:{clubConfig.contactEmail}">
              {clubConfig.contactEmail}
            </a>
          </p>
        {/if}
        <a
          class="btn preset-tonal-surface"
          href={clubConfig.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{$_('page.trialRegistration.backToWebsite')}</span>
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
        </a>
      </div>
    {/if}
  </div>
</div>
