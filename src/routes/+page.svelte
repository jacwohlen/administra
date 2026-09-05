<script lang="ts">
  import LogoImage from './LogoImage.svelte';
  import { error as err } from '@sveltejs/kit';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';

  async function login() {
    const config: SignInWithOAuthCredentials = {
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    };
    const { error } = await supabaseClient.auth.signInWithOAuth(config);
    if (error) throw err(404, error);
  }

  import { page } from '$app/state';
  import type { PageData } from './$types';
  import type { SignInWithOAuthCredentials } from '@supabase/supabase-js';

  // supabase policy will prevent google accounts to log in if not using the
  // proper domain (e.g. jacwohlen.ch). In such a case the error is passed
  // via GET parameters. We catch it here and sign out the user at google.
  // This way the user can start over loggign in with the right google account
  let { data, error = null }: { data: PageData; error: string | null } = $props();
  let signInError = page.url.searchParams.get('error');
  if (signInError) {
    error = 'Error: Could not log in: ' + page.url.searchParams.get('error_description');
    supabaseClient.auth.signOut();
  }

  // Email/password login for non-production environments only. Supabase
  // preview branches have their own OAuth callback URL that the Google
  // client does not know, so Google login cannot work on Deploy Previews;
  // the seeded test user (see supabase/seed.sql) is used instead.
  import { PUBLIC_MODE } from '$env/static/public';
  let devEmail = $state('');
  let devPassword = $state('');
  let devLoginError = $state('');

  async function devLogin(e: Event) {
    e.preventDefault();
    devLoginError = '';
    const { error: pwError } = await supabaseClient.auth.signInWithPassword({
      email: devEmail,
      password: devPassword
    });
    if (pwError) {
      devLoginError = pwError.message;
      return;
    }
    window.location.href = '/dashboard';
  }
</script>

<div class="grid grid-cols-1 place-items-center space-y-8 mt-10">
  <LogoImage />
  <h1 class="my-2">{$_('page.routes.welcomeMessage')}</h1>
  {#if data.session}
    <p>
      {$_('page.routes.hi')} <strong>{data.session.user.email}</strong>
    </p>
    <a class="btn preset-filled-primary-500 mt-2" href="/dashboard" color="primary"
      >{$_('button.openDashboard')}</a
    >
  {:else}
    {#if error}
      <span>
        {error}
      </span>
    {/if}
    <button class="btn preset-filled-primary-500" onclick={login} color="primary">
      {$_('button.login')}
    </button>
    {#if PUBLIC_MODE === 'DEV'}
      <form class="card p-4 w-72 space-y-3" onsubmit={devLogin}>
        <p class="text-sm text-center">{$_('page.routes.devLoginTitle')}</p>
        <input
          class="input"
          type="email"
          autocomplete="username"
          placeholder={$_('page.routes.email')}
          bind:value={devEmail}
          required
        />
        <input
          class="input"
          type="password"
          autocomplete="current-password"
          placeholder={$_('page.routes.password')}
          bind:value={devPassword}
          required
        />
        {#if devLoginError}
          <p class="text-sm text-error-500">{devLoginError}</p>
        {/if}
        <button class="btn preset-tonal w-full" type="submit">
          {$_('page.routes.devLoginButton')}
        </button>
      </form>
    {/if}
  {/if}
</div>
