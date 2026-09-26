<script lang="ts">
  import LogoImage from './LogoImage.svelte';
  import { error as err } from '@sveltejs/kit';
  import { supabaseClient } from '$lib/supabase';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faEnvelope, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { AuthApiError, type SignInWithOAuthCredentials } from '@supabase/supabase-js';
  import { page } from '$app/state';
  import { PUBLIC_MODE } from '$env/static/public';
  import { onDestroy, tick } from 'svelte';
  import type { PageData } from './$types';

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

  // If the OAuth provider reports an error it is passed back via GET
  // parameters. We surface it here and sign the user out so they can start
  // over with a different Google account. Access itself is governed by the
  // admin approval flow (see user_profiles), not by the login step.
  let { data, error = null }: { data: PageData; error: string | null } = $props();
  let signInError = page.url.searchParams.get('error');
  if (signInError) {
    error = 'Error: Could not log in: ' + page.url.searchParams.get('error_description');
    supabaseClient.auth.signOut({ scope: 'local' });
  }

  // Passwordless sign-in: members enter the email the club has on file, get a
  // one-time code and are in. Accounts whose email matches a member record are
  // approved automatically (see 20260926090100_member_self_service.sql).
  // Must match auth.email.otp_length in supabase/config.toml.
  const OTP_LENGTH = 6;
  const RESEND_SECONDS = 60;

  let step: 'email' | 'code' = $state('email');
  // Prefilled when the form was submitted natively before hydration finished.
  let email = $state(page.url.searchParams.get('email') ?? '');
  let code = $state('');
  let busy = $state(false);
  let otpError = $state('');
  let resendIn = $state(0);
  let codeInput: HTMLInputElement | undefined = $state();
  let resendTimer: ReturnType<typeof setInterval> | undefined;

  onDestroy(() => clearInterval(resendTimer));

  function startResendCountdown() {
    resendIn = RESEND_SECONDS;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      resendIn -= 1;
      if (resendIn <= 0) clearInterval(resendTimer);
    }, 1000);
  }

  function authErrorMessage(e: unknown, fallbackKey: string): string {
    if (e instanceof AuthApiError && e.status === 429) return $_('page.login.errorRateLimit');
    return $_(fallbackKey);
  }

  async function sendCode(e?: Event) {
    e?.preventDefault();
    otpError = '';
    email = email.trim();
    if (!email) return;
    busy = true;
    const { error: sendError } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    busy = false;
    if (sendError) {
      otpError = authErrorMessage(sendError, 'page.login.errorSend');
      return;
    }
    step = 'code';
    code = '';
    startResendCountdown();
    await tick();
    codeInput?.focus();
  }

  async function verifyCode(e?: Event) {
    e?.preventDefault();
    if (busy || code.length !== OTP_LENGTH) return;
    otpError = '';
    busy = true;
    const { error: verifyError } = await supabaseClient.auth.verifyOtp({
      email,
      token: code,
      type: 'email'
    });
    if (verifyError) {
      busy = false;
      code = '';
      otpError = authErrorMessage(verifyError, 'page.login.errorCode');
      codeInput?.focus();
      return;
    }
    // The server load of this page sends the account where it belongs
    // (dashboard, club area or pending).
    window.location.href = '/';
  }

  function onCodeInput() {
    code = code.replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (code.length === OTP_LENGTH) verifyCode();
  }

  function changeEmail() {
    step = 'email';
    code = '';
    otpError = '';
  }

  // Email/password login for non-production environments only. Supabase
  // preview branches have their own OAuth callback URL that the Google
  // client does not know, so Google login cannot work on Deploy Previews;
  // the seeded test users (see supabase/seed.sql) are used instead.
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
    window.location.href = '/';
  }
</script>

<div class="flex flex-col items-center gap-6 mt-10 px-4 pb-10">
  <LogoImage />
  <h1 class="my-2 text-center">{$_('page.routes.welcomeMessage')}</h1>
  {#if data.session}
    <p>
      {$_('page.routes.hi')} <strong>{data.session.user.email}</strong>
    </p>
    <a class="btn preset-filled-primary-500 mt-2" href="/" color="primary"
      >{$_('button.openDashboard')}</a
    >
  {:else}
    {#if error}
      <span>
        {error}
      </span>
    {/if}

    <div class="card w-full max-w-sm p-5 space-y-4 bg-surface-50-950 border border-surface-200-800">
      {#if step === 'email'}
        <form class="space-y-3" onsubmit={sendCode}>
          <div class="space-y-1">
            <h2 class="font-semibold">{$_('page.login.title')}</h2>
            <p class="text-sm text-surface-600-400">{$_('page.login.subtitle')}</p>
          </div>
          <label class="block">
            <span class="sr-only">{$_('page.routes.email')}</span>
            <input
              class="input"
              type="email"
              name="email"
              autocomplete="email"
              inputmode="email"
              placeholder={$_('page.login.emailPlaceholder')}
              bind:value={email}
              required
            />
          </label>
          <button class="btn preset-filled-primary-500 w-full" type="submit" disabled={busy}>
            {#if busy}
              <Fa icon={faSpinner} spin />
            {:else}
              <Fa icon={faEnvelope} />
            {/if}
            <span>{$_('page.login.sendCode')}</span>
          </button>
        </form>

        <div class="flex items-center gap-3 text-xs text-surface-600-400">
          <span class="h-px flex-1 bg-surface-300-700"></span>
          <span>{$_('page.login.or')}</span>
          <span class="h-px flex-1 bg-surface-300-700"></span>
        </div>

        <button class="btn preset-tonal-surface w-full" type="button" onclick={login}>
          <svg class="size-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
            />
          </svg>
          <span>{$_('page.login.google')}</span>
        </button>
      {:else}
        <form class="space-y-3" onsubmit={verifyCode}>
          <button
            type="button"
            class="btn btn-sm preset-tonal-surface -ml-1"
            onclick={changeEmail}
            disabled={busy}
          >
            <Fa icon={faArrowLeft} />
            <span>{$_('page.login.changeEmail')}</span>
          </button>
          <div class="space-y-1">
            <h2 class="font-semibold">{$_('page.login.checkInbox')}</h2>
            <p class="text-sm text-surface-600-400">
              {$_('page.login.codeSent', { values: { length: OTP_LENGTH } })}
              <strong class="break-all">{email}</strong>
            </p>
          </div>
          <label class="block">
            <span class="sr-only">{$_('page.login.codeLabel')}</span>
            <input
              bind:this={codeInput}
              class="input text-center text-2xl font-mono tracking-[0.5em] py-3"
              type="text"
              name="code"
              autocomplete="one-time-code"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={OTP_LENGTH}
              placeholder={'•'.repeat(OTP_LENGTH)}
              aria-label={$_('page.login.codeLabel')}
              bind:value={code}
              oninput={onCodeInput}
              disabled={busy}
              required
            />
          </label>
          <button
            class="btn preset-filled-primary-500 w-full"
            type="submit"
            disabled={busy || code.length !== OTP_LENGTH}
          >
            {#if busy}
              <Fa icon={faSpinner} spin />
            {/if}
            <span>{$_('page.login.verify')}</span>
          </button>
          <div class="flex flex-col items-center gap-1 text-sm text-surface-600-400">
            <span>{$_('page.login.noEmail')}</span>
            <button
              type="button"
              class="anchor disabled:opacity-50 disabled:no-underline"
              onclick={() => sendCode()}
              disabled={busy || resendIn > 0}
            >
              {resendIn > 0
                ? $_('page.login.resendIn', { values: { seconds: resendIn } })
                : $_('page.login.resend')}
            </button>
          </div>
        </form>
      {/if}

      {#if otpError}
        <p class="text-sm text-error-600-400 text-center" role="alert">{otpError}</p>
      {/if}
    </div>

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
