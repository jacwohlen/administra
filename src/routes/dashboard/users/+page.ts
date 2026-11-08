import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '#lib/supabase.ts';
import type { Member, MemberAccessReportRow, UserProfile } from '#lib/models.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { userProfile } = await parent();
  if (!userProfile || userProfile.role !== 'admin') {
    redirect(303, '/dashboard');
  }

  const [profilesRes, membersRes, reportRes, unconfirmedRes] = await Promise.all([
    supabaseClient
      .from('user_profiles')
      .select('*')
      .order('status', { ascending: true })
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('members')
      .select('id, firstname, lastname, membership_status')
      .is('archivedAt', null)
      .order('lastname'),
    // Member accounts none of whose member records counts (no access, or none once approved)
    supabaseClient.rpc('member_access_report'),
    // Accounts that asked for a sign-in code but never entered one: often a
    // mistyped address, which the admin can delete
    supabaseClient.rpc('unconfirmed_user_ids')
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
    members: (membersRes.data ?? []) as Pick<
      Member,
      'id' | 'firstname' | 'lastname' | 'membership_status'
    >[],
    accessReport: (reportRes.data ?? []) as MemberAccessReportRow[],
    // Only a marker on the page: an error leaves it out instead of failing the page
    unconfirmedUserIds: unconfirmedRes.error ? [] : ((unconfirmedRes.data ?? []) as string[])
  };
};
