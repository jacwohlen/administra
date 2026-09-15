import { AuthApiError } from '@supabase/supabase-js';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession, supabase } }) => {
  const { user } = await safeGetSession();
  if (!user) return {};

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.status === 'approved') {
    redirect(303, '/dashboard');
  }
  redirect(303, '/pending');
};

export const actions: Actions = {
  login: async ({ request, locals }) => {
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
