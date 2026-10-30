import { AuthApiError } from '@supabase/supabase-js';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { PUBLIC_MODE } from '$env/static/public';
import { homePath } from '$lib/roles';
import { demoAccountFor } from '$lib/server/demoAccounts';
import { demoSignInLimiter } from '$lib/server/demoRateLimit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  // The root layout has the profile and, for member accounts, my_access()
  const { session, userProfile, access } = await parent();
  if (!session) return {};

  redirect(303, homePath(userProfile, access));
};

export const actions: Actions = {
  // Email/password login exists only for non-production builds (local dev,
  // CI, Deploy Previews with the seeded test users) — the same condition that
  // shows the password form on the login page. Production builds answer 404.
  login: async ({ request, locals }) => {
    if (PUBLIC_MODE !== 'DEV') error(404, 'Not found');

    const body = Object.fromEntries(await request.formData());

    const { error: err } = await locals.supabase.auth.signInWithPassword({
      email: body.email as string,
      password: body.password as string
    });

    if (err) {
      if (err instanceof AuthApiError && err.status === 400) {
        return fail(400, {
          error: 'Invalid credentials'
        });
      }
      return fail(500, {
        message: 'Server error. Try again later.'
      });
    }

    redirect(303, '/');
  },

  // One-click sign-in of the public demo (PUBLIC_MODE=DEMO, demo.alleda.ch,
  // its own Supabase project). The form only sends a role; the e-mail and
  // password are looked up here (see $lib/server/demoAccounts), so this
  // action never signs in with anything the browser chose. Every other
  // build answers 404. All visitors reach Supabase Auth through the
  // function's few IPs, so each client is throttled here to keep one script
  // from spending the shared per-IP sign-in limit ($lib/server/demoRateLimit).
  demo: async ({ request, locals, getClientAddress }) => {
    if (PUBLIC_MODE !== 'DEMO') error(404, 'Not found');

    const account = demoAccountFor((await request.formData()).get('role'));
    if (!account) return fail(400, { demoError: 'unknownRole' as const });

    if (!demoSignInLimiter.take(getClientAddress())) {
      return fail(429, { demoError: 'tooManyAttempts' as const });
    }

    const { error: err } = await locals.supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password
    });
    if (err) {
      console.error('Demo sign-in failed', err);
      return fail(503, { demoError: 'signInFailed' as const });
    }

    // Full page load (native form POST): the load above forwards to homePath.
    redirect(303, '/');
  }
};
