export const ssr = false;
import { redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent, depends }) => {
  const { session, userProfile } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (!userProfile || userProfile.status !== 'approved') {
    redirect(303, '/pending');
  }

  depends('users:pending');
  let pendingUsers = 0;
  if (userProfile.role === 'admin') {
    const { count } = await supabaseClient
      .from('user_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('status', 'pending');
    pendingUsers = count ?? 0;
  }

  return {
    session,
    userProfile,
    pendingUsers
  };
};
