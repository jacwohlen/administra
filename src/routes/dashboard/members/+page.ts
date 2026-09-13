import { error as err } from '@sveltejs/kit';
import type { Member, MemberTopBadge } from '$lib/models';
import { supabaseClient } from '$lib/supabase';

export async function load({ depends }) {
  // Set a dependency for this route to reload when member data changes
  depends('members:list');

  const [{ error, data }, { data: topBadges }] = await Promise.all([
    supabaseClient
      .from('members')
      .select('id, lastname, firstname, labels')
      .order('lastname', { ascending: true })
      .order('firstname', { ascending: true })
      .returns<Member[]>(),
    supabaseClient.rpc('get_members_top_badges')
  ]);
  if (error) throw err(404, error);

  const badgeMap: Record<string, string> = {};
  if (Array.isArray(topBadges)) {
    for (const tb of topBadges as MemberTopBadge[]) {
      badgeMap[tb.memberId] = tb.emoji;
    }
  }

  return {
    members: data,
    badgeMap
  };
}
