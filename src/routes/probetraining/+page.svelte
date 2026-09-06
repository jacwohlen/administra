<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSpinner, faCheck, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import ClubLogo from '$lib/components/ClubLogo.svelte';
  import { setPublicLocale } from '$lib/publicLocale';

  const CLUB_URL = 'https://jacwohlen.ch';

  let firstname = $state('');
  let lastname = $state('');
  let birthday = $state('');
  let email = $state('');
  let mobile = $state('');
  let section = $state('');
  let notes = $state('');
  // Honeypot – bots fill this; humans don't see it.
  let website = $state('');

  let submitting = $state(false);
  let submitted = $state(false);
  let error = $state('');

  const sections = ['Judo', 'Aikido'];

  async function submit() {
    error = '';
    if (website.trim() !== '') {
      // Honeypot triggered – silently pretend success.
      submitted = true;
      return;
    }

    if (!firstname.trim() || !lastname.trim() || !email.trim() || !birthday) {
      error = $_('page.trialRegistration.validation.required');
      return;
    }

    submitting = true;
    try {
      const { error: insertError } = await supabaseClient.from('members').insert({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        birthday,
        email: email.trim(),
        mobile: mobile.trim() || null,
        trialSection: section || null,
        notes: notes.trim() || null,
        labels: ['probetraining'],
        trialRegisteredAt: new Date().toISOString()
      });

      if (insertError) {
        error = insertError.message;
        return;
      }

      submitted = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{$_('page.trialRegistration.title')}</title>
  <meta name="description" content={$_('page.trialRegistration.metaDescription')} />
  <meta property="og:title" content={$_('page.trialRegistration.title')} />
  <meta property="og:description" content={$_('page.trialRegistration.metaDescription')} />
  <meta property="og:type" content="website" />
</svelte:head>

<!--
  The root layout clips its children in DEV mode (h-screen + overflow-hidden),
  expecting each page to bring its own scroll container the way the dashboard
  layout does. This page is rendered directly into it, so it scrolls itself.
-->
<div class="h-full overflow-y-auto">
  <div class="max-w-lg mx-auto px-4 py-8">
    <div class="flex justify-end mb-2">
      <div class="flex items-center gap-1 text-xs" role="group" aria-label="Sprache / Language">
        <button
          type="button"
          class="btn btn-sm {$locale?.startsWith('de')
            ? 'preset-filled-primary-500'
            : 'preset-tonal-surface'}"
          aria-pressed={$locale?.startsWith('de')}
          onclick={() => setPublicLocale('de')}
        >
          DE
        </button>
        <button
          type="button"
          class="btn btn-sm {$locale?.startsWith('en')
            ? 'preset-filled-primary-500'
            : 'preset-tonal-surface'}"
          aria-pressed={$locale?.startsWith('en')}
          onclick={() => setPublicLocale('en')}
        >
          EN
        </button>
      </div>
    </div>

    {#if submitted}
      <div class="card p-6 text-center space-y-4">
        <div class="flex justify-center">
          <span
            class="size-14 rounded-full preset-filled-primary-500 flex items-center justify-center"
          >
            <Fa icon={faCheck} size="2x" />
          </span>
        </div>
        <h1>{$_('page.trialRegistration.successTitle')}</h1>
        <p class="text-surface-600-400">{$_('page.trialRegistration.successMessage')}</p>
        <a
          class="btn preset-tonal-surface"
          href={CLUB_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{$_('page.trialRegistration.backToWebsite')}</span>
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
        </a>
      </div>
    {:else}
      <div class="flex flex-col items-center mb-6">
        <ClubLogo class="h-24 w-auto" />
        <h1 class="mt-4 text-center">{$_('page.trialRegistration.title')}</h1>
        <p class="text-center text-surface-600-400 mt-2">
          {$_('page.trialRegistration.subtitle')}
        </p>
      </div>

      <form
        class="card p-6 space-y-4"
        onsubmit={(e: SubmitEvent) => {
          e.preventDefault();
          submit();
        }}
      >
        <!-- Honeypot, hidden from humans -->
        <div style="position:absolute;left:-9999px;top:-9999px;" aria-hidden="true">
          <label>
            Website
            <input type="text" tabindex="-1" autocomplete="off" bind:value={website} />
          </label>
        </div>

        <label class="label">
          <span>{$_('page.trialRegistration.firstName')} *</span>
          <!-- No placeholder: it would only repeat the label right above it. -->
          <input
            class="input"
            bind:value={firstname}
            type="text"
            required
            autocomplete="given-name"
          />
        </label>

        <label class="label">
          <span>{$_('page.trialRegistration.lastName')} *</span>
          <input
            class="input"
            bind:value={lastname}
            type="text"
            required
            autocomplete="family-name"
          />
        </label>

        <label class="label">
          <span>{$_('page.trialRegistration.birthday')} *</span>
          <input class="input" bind:value={birthday} type="date" required />
        </label>

        <label class="label">
          <span>{$_('page.trialRegistration.email')} *</span>
          <input
            class="input"
            bind:value={email}
            type="email"
            required
            autocomplete="email"
            placeholder="name@example.com"
          />
          <span class="text-xs text-surface-600-400">
            {$_('page.trialRegistration.emailHint')}
          </span>
        </label>

        <label class="label">
          <span>{$_('page.trialRegistration.mobile')}</span>
          <input
            class="input"
            bind:value={mobile}
            type="tel"
            autocomplete="tel"
            placeholder="+41 79 123 45 67"
          />
        </label>

        <label class="label">
          <span>{$_('page.trialRegistration.section')}</span>
          <select class="select" bind:value={section}>
            <option value="">{$_('page.trialRegistration.sectionPlaceholder')}</option>
            {#each sections as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>

        <label class="label">
          <span>{$_('page.trialRegistration.notes')}</span>
          <textarea
            class="textarea"
            bind:value={notes}
            rows="3"
            placeholder={$_('page.trialRegistration.notesPlaceholder')}
          ></textarea>
        </label>

        {#if error}
          <div class="flex items-center gap-4 p-4 rounded-lg preset-filled-error-500">
            <p class="flex-1">{error}</p>
          </div>
        {/if}

        <button type="submit" class="btn preset-filled-primary-500 w-full" disabled={submitting}>
          {#if submitting}
            <Fa icon={faSpinner} spin />
            <span>{$_('page.trialRegistration.submitting')}</span>
          {:else}
            <span>{$_('page.trialRegistration.submit')}</span>
          {/if}
        </button>
      </form>
    {/if}
  </div>
</div>
