import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { Member, MemberAccessReportRow, UserProfile } from '$lib/models';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { userProfile } = await parent();
  if (!userProfile || userProfile.role !== 'admin') {
    redirect(303, '/dashboard');
  }

  const [profilesRes, membersRes, reportRes] = await Promise.all([
    supabaseClient
      .from('user_profiles')
      .select('*')
      .order('status', { ascending: true })
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('members')
      .select('id, firstname, lastname')
      .is('archivedAt', null)
      .order('lastname'),
    // Member accounts that lose access once sign-in requires an active or passive membership
    supabaseClient.rpc('member_access_report')
  ]);

  if (profilesRes.error) {
    error(500, profilesRes.error.message);
  }
  if (membersRes.error) {
    error(500, membersRes.error.message);
  }
  if (reportRes.error) {
    error(500, reportRes.error.message);
  }

  return {
    profiles: (profilesRes.data ?? []) as UserProfile[],
    members: (membersRes.data ?? []) as Pick<Member, 'id' | 'firstname' | 'lastname'>[],
    accessReport: (reportRes.data ?? []) as MemberAccessReportRow[]
  };
};
