import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { Member, UserProfile } from '$lib/models';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { userProfile } = await parent();
  if (!userProfile || userProfile.role !== 'admin') {
    redirect(303, '/dashboard');
  }

  const [profilesRes, membersRes] = await Promise.all([
    supabaseClient
      .from('user_profiles')
      .select('*')
      .order('status', { ascending: true })
      .order('created_at', { ascending: false }),
    supabaseClient.from('members').select('id, firstname, lastname').order('lastname')
  ]);

  if (profilesRes.error) {
    error(500, profilesRes.error.message);
  }
  if (membersRes.error) {
    error(500, membersRes.error.message);
  }

  return {
    profiles: (profilesRes.data ?? []) as UserProfile[],
    members: (membersRes.data ?? []) as Pick<Member, 'id' | 'firstname' | 'lastname'>[]
  };
};
