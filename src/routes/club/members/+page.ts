import type { DirectoryMember, MemberSectionGrade, MemberTopBadge } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { highestGrade } from '$lib/gradeUtils';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
  const [{ data: members }, { data: grades }, { data: topBadges }] = await Promise.all([
    supabaseClient.rpc('get_member_directory'),
    supabaseClient.rpc('get_members_current_grades'),
    supabaseClient.rpc('get_members_top_badges')
  ]);

  const gradesByMember = new Map<number, MemberSectionGrade[]>();
  for (const g of (grades ?? []) as MemberSectionGrade[]) {
    const list = gradesByMember.get(g.memberId) ?? [];
    list.push(g);
    gradesByMember.set(g.memberId, list);
  }
  const topGrade = new Map<number, MemberSectionGrade>();
  for (const [memberId, list] of gradesByMember) {
    const top = highestGrade(list);
    if (top) topGrade.set(memberId, top);
  }

  const badge = new Map<number, string>();
  for (const b of (topBadges ?? []) as MemberTopBadge[]) badge.set(b.memberId, b.emoji);

  return {
    members: ((members ?? []) as DirectoryMember[]).map((m) => ({
      ...m,
      topGrade: topGrade.get(m.id) ?? null,
      topBadge: badge.get(m.id) ?? null
    }))
  };
};
