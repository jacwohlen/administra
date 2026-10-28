import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { fetchAllRows } from '$lib/assistant/attendance';
import { isAdmin } from '$lib/roles';
import { findDuplicatePairs, linkStates } from '$lib/memberDuplicates';
import { MERGE_COLUMNS, type MergeMember } from '$lib/memberMerge';
import type { PageLoad } from './$types';

/** Likely duplicate members, for admins (they merge them) */
export const load: PageLoad = async ({ parent, depends }) => {
  const { userProfile } = await parent();
  if (!isAdmin(userProfile)) {
    redirect(303, '/dashboard/members');
  }
  depends('members:list');

  try {
    // Page by page: PostgREST returns at most 1000 rows. Archived trial
    // candidates included: they are duplicates too.
    const [members, links] = await Promise.all([
      fetchAllRows<MergeMember>((from, to) =>
        supabaseClient.from('members').select(MERGE_COLUMNS).order('id').range(from, to)
      ),
      fetchAllRows<{ member_id: number; gone_at: string | null }>((from, to) =>
        supabaseClient
          .from('member_links')
          .select('member_id, gone_at')
          .order('connection')
          .order('external_id')
          .range(from, to)
      )
    ]);
    const states = linkStates(links);
    return { pairs: findDuplicatePairs(members, states) };
  } catch (e) {
    error(500, (e as { message?: string } | null)?.message ?? 'Members not loaded');
  }
};
