import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const STORAGE_STATE_PATH = 'e2e/.auth/user.json';

setup('authenticate', async ({ page, context }) => {
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY!;
  const email = process.env.E2E_USER_EMAIL!;
  const password = process.env.E2E_USER_PASSWORD!;

  if (!supabaseUrl || !supabaseKey || !email || !password) {
    throw new Error(
      'Missing E2E auth env vars. Set PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, E2E_USER_EMAIL, E2E_USER_PASSWORD.'
    );
  }

  // Sign in server-side using the Supabase JS client
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    throw new Error(`E2E auth failed: ${error?.message ?? 'no session returned'}`);
  }

  const session = data.session;

  // Build the cookie value in the format @supabase/ssr expects.
  // @supabase/ssr uses base64url encoding with a "base64-" prefix.
  const sessionPayload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user
  });

  const encoded = Buffer.from(sessionPayload)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const cookieValue = `base64-${encoded}`;

  // The default storage key used by @supabase/ssr is "sb-<project-ref>-auth-token".
  // Supabase extracts the project ref as the first segment of the hostname (before the first dot).
  const url = new URL(supabaseUrl);
  const projectRef = url.hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;

  console.log('Storage key:', storageKey);
  console.log('Cookie value length:', cookieValue.length);

  // Check if the cookie needs to be chunked (> 3180 bytes per chunk)
  const CHUNK_SIZE = 3180;
  const cookiesToSet: Array<{ name: string; value: string }> = [];

  if (cookieValue.length > CHUNK_SIZE) {
    const chunks = Math.ceil(cookieValue.length / CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      cookiesToSet.push({
        name: `${storageKey}.${i}`,
        value: cookieValue.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      });
    }
  } else {
    cookiesToSet.push({ name: storageKey, value: cookieValue });
  }

  console.log(
    'Setting cookies:',
    cookiesToSet.map((c) => `${c.name} (${c.value.length} bytes)`)
  );

  // Set cookies on the browser context
  await context.addCookies(
    cookiesToSet.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const
    }))
  );

  // Navigate to dashboard
  await page.goto('/dashboard');

  // Debug: check where we ended up
  await page.waitForLoadState('networkidle');
  console.log('Final URL:', page.url());

  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 15000 });

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
