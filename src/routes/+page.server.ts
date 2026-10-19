import { AuthApiError } from '@supabase/supabase-js';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { PUBLIC_MODE } from '$env/static/public';
import { homePath } from '$lib/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession, supabase } }) => {
  const { user } = await safeGetSession();
  if (!user) return {};

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('status, role')
    .eq('user_id', user.id)
    .maybeSingle();

  redirect(303, homePath(profile));
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
  }
};
