<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSpinner, faCheck } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import LogoImage from '../LogoImage.svelte';

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
        notes:
          [section ? `Sektion: ${section}` : null, notes.trim() || null]
            .filter(Boolean)
            .join('\n') || null,
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

<div class="max-w-lg mx-auto px-4 py-8">
  <div class="flex flex-col items-center mb-6">
    <LogoImage />
    <h1 class="mt-4">{$_('page.trialRegistration.title')}</h1>
    <p class="text-center text-surface-600-400 mt-2">
      {$_('page.trialRegistration.subtitle')}
    </p>
  </div>

  {#if submitted}
    <div class="card p-6 text-center space-y-4">
      <div class="flex justify-center">
        <div
          class="size-14 rounded-full bg-success-500/10 text-success-600-400 flex items-center justify-center"
        >
          <Fa icon={faCheck} size="2x" />
        </div>
      </div>
      <h2>{$_('page.trialRegistration.successTitle')}</h2>
      <p class="text-surface-600-400">{$_('page.trialRegistration.successMessage')}</p>
    </div>
  {:else}
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
        <input
          class="input"
          bind:value={firstname}
          type="text"
          required
          autocomplete="given-name"
          placeholder={$_('dialog.newMember.firstNamePlaceholder')}
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
          placeholder={$_('dialog.newMember.lastNamePlaceholder')}
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
