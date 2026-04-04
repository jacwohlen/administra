import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const STORAGE_STATE_PATH = 'e2e/.auth/user.json';

/**
 * Authenticates a test user via Supabase email/password and stores the
 * session tokens as cookies so that subsequent tests can reuse them.
 *
 * Requires environment variables:
 *   PUBLIC_SUPABASE_URL   – Supabase project URL
 *   PUBLIC_SUPABASE_ANON_KEY – Supabase anon key
 *   E2E_USER_EMAIL        – Test user email
 *   E2E_USER_PASSWORD     – Test user password
 */
setup('authenticate', async ({ page }) => {
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY!;
  const email = process.env.E2E_USER_EMAIL!;
  const password = process.env.E2E_USER_PASSWORD!;

  if (!supabaseUrl || !supabaseKey || !email || !password) {
    throw new Error(
      'Missing E2E auth env vars. Set PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, E2E_USER_EMAIL, E2E_USER_PASSWORD.'
    );
  }

  // Sign in via Supabase JS client
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    throw new Error(`E2E auth failed: ${error?.message ?? 'No session returned'}`);
  }

  const { access_token, refresh_token } = data.session;

  // Navigate to the app and inject the auth tokens as cookies
  // Supabase auth-helpers-sveltekit reads these cookie names
  await page.goto('/');
  const url = new URL(supabaseUrl);
  const projectRef = url.hostname.split('.')[0];

  await page.context().addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify({
        access_token,
        refresh_token,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }),
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax'
    }
  ]);

  // Verify authentication works by navigating to dashboard
  await page.goto('/dashboard');
  await page.waitForURL('/dashboard**');

  // Save the authenticated state for reuse
  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
