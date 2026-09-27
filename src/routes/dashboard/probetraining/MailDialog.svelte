<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faPaperPlane,
    faSpinner,
    faTriangleExclamation,
    faEnvelope
  } from '@fortawesome/free-solid-svg-icons';
  import { invalidate } from '$app/navigation';
  import { clubConfig } from '$lib/clubConfig';
  import { settingValues } from '$lib/appSettings';
  import { toaster } from '$lib/toast';
  import {
    TRIAL_MAIL_KINDS,
    buildTrialMailVars,
    renderTrialMail,
    trialMailLocale,
    trialMailTemplate,
    type TrialMailKind
  } from '$lib/trialMail';
  import type { Training, TrialMember } from '$lib/models';

  /**
   * Preview of a mail to a trial candidate: the template for the chosen
   * kind, filled in and editable. Nothing is sent until "Senden".
   */
  let {
    member,
    kind: initialKind,
    trainings,
    onclose
  }: {
    member: TrialMember;
    kind: TrialMailKind;
    /** The candidate's assigned trainings, for the {trainings} placeholder. */
    trainings: Training[];
    onclose: () => void;
  } = $props();

  let kind = $state<TrialMailKind>(untrack(() => initialKind));
  let subject = $state('');
  let body = $state('');
  let sending = $state(false);
  /** null while unknown; false shows that nothing would leave. */
  let configured = $state<boolean | null>(null);

  let locale = $derived(trialMailLocale(member.trialLocale, clubConfig.defaultLocale));

  function fill(k: TrialMailKind) {
    const mail = renderTrialMail(
      trialMailTemplate(settingValues, k, locale),
      buildTrialMailVars(member, clubConfig, trainings, locale)
    );
    subject = mail.subject;
    body = mail.body;
  }

  // Re-fill whenever another kind is picked (and only then, so edits survive).
  $effect(() => {
    const k = kind;
    untrack(() => fill(k));
  });

  onMount(async () => {
    try {
      const res = await fetch('/api/probetraining/mail');
      if (res.ok) configured = ((await res.json()) as { configured: boolean }).configured;
    } catch {
      configured = null;
    }
  });

  async function send() {
    sending = true;
    try {
      const res = await fetch('/api/probetraining/mail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId: member.id, kind, subject, body })
      });
      const result = res.ok
        ? ((await res.json()) as { status: string; error?: string })
        : { status: 'failed', error: (await res.text()) || String(res.status) };
      if (result.status === 'sent') {
        toaster.success({ title: $_('page.probetraining.mail.sent') });
      } else if (result.status === 'skipped') {
        toaster.warning({ title: $_('page.probetraining.mail.skipped') });
      } else {
        toaster.error({
          title: $_('page.probetraining.mail.failed'),
          description: result.error
        });
      }
      await invalidate('probetraining:list');
      if (result.status !== 'failed') onclose();
    } catch (e) {
      console.error('Sending trial mail failed:', e);
      toaster.error({ title: $_('page.probetraining.mail.failed') });
    } finally {
      sending = false;
    }
  }
</script>

<div class="space-y-4">
  <header class="flex items-center gap-3">
    <span class="avatar-initials bg-primary-500/15! text-primary-700-300">
      <Fa icon={faEnvelope} />
    </span>
    <span class="min-w-0">
      <h3 class="mb-0!">{$_('page.probetraining.mail.title')}</h3>
      <span class="block text-sm text-surface-600-400 truncate">
        {$_('page.probetraining.mail.to')}
        {member.firstname}
        {member.lastname} &lt;{member.email}&gt; · {locale.toUpperCase()}
      </span>
    </span>
  </header>

  {#if configured === false}
    <p
      class="flex items-start gap-2 rounded-md bg-warning-500/10 px-3 py-2 text-xs text-warning-800-200"
    >
      <Fa icon={faTriangleExclamation} size="xs" class="mt-0.5" />
      {$_('page.probetraining.mail.notConfigured')}
    </p>
  {/if}

  <div class="flex flex-wrap gap-1" role="tablist" aria-label={$_('page.probetraining.mail.kind')}>
    {#each TRIAL_MAIL_KINDS as k (k)}
      <button
        type="button"
        role="tab"
        aria-selected={kind === k}
        class="btn btn-sm {kind === k ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
        disabled={sending}
        onclick={() => (kind = k)}
      >
        {$_('page.settings.trialMail.kind.' + k)}
      </button>
    {/each}
  </div>

  {#if kind === 'assigned' && trainings.length === 0}
    <p class="text-xs text-warning-800-200">{$_('page.probetraining.mail.noTrainings')}</p>
  {/if}

  <label class="label">
    <span class="text-sm font-medium">{$_('page.settings.trialMail.subjectShort')}</span>
    <input class="input" type="text" bind:value={subject} disabled={sending} maxlength="300" />
  </label>
  <label class="label">
    <span class="text-sm font-medium">{$_('page.settings.trialMail.bodyShort')}</span>
    <textarea
      class="textarea text-sm leading-relaxed"
      rows="12"
      bind:value={body}
      disabled={sending}
      maxlength="10000"
    ></textarea>
  </label>

  <footer class="flex flex-wrap justify-end items-center gap-2">
    {#if sending}
      <Fa icon={faSpinner} spin />
    {/if}
    <button class="btn preset-tonal-surface" disabled={sending} onclick={onclose}>
      {$_('page.probetraining.mail.skip')}
    </button>
    <button
      class="btn preset-filled-primary-500"
      disabled={sending || !subject.trim() || !body.trim()}
      onclick={send}
    >
      <Fa icon={faPaperPlane} size="xs" />
      <span>{$_('page.probetraining.mail.send')}</span>
    </button>
  </footer>
</div>
