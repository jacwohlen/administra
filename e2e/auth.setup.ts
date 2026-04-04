import { test as setup, expect } from '@playwright/test';

const STORAGE_STATE_PATH = 'e2e/.auth/user.json';

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

  // Load the app first (establishes origin and waits for dev server)
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Sign in via the Supabase auth API from inside the browser and set the cookie
  // Retry a few times in case auth service is still starting after db reset
  const authError = await page.evaluate(
    async ({ url, key, email, password }) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: key,
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify({ email, password })
        });
        if (res.status === 502 || res.status === 503) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        if (!res.ok) {
          return `HTTP ${res.status}: ${await res.text()}`;
        }
        const data = await res.json();
        const val = JSON.stringify([
          data.access_token,
          data.refresh_token,
          data.provider_token ?? null,
          data.provider_refresh_token ?? null
        ]);
        document.cookie = `supabase-auth-token=${val}; path=/; max-age=3600; samesite=lax`;
        return null;
      }
      return 'Auth service unavailable after retries';
    },
    { url: supabaseUrl, key: supabaseKey, email, password }
  );

  if (authError) {
    throw new Error(`E2E auth failed: ${authError}`);
  }

  // Navigate to dashboard with the auth cookie set
  await page.goto('/dashboard');
  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 15000 });

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
