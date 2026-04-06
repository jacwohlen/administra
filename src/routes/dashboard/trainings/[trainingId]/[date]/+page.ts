import type { PageLoad } from './$types';
import type { MMember } from './types';
import type { MemberTopBadge } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import { buildMembersWithStreaks } from '$lib/trainingUtils';

const STREAK_LENGTH = 9;

export const load = (async ({ params }) => {
  async function getMembersWithPresentStatus(): Promise<MMember[]> {
    const [checklistResult, streakResult] = await Promise.all([
      supabaseClient
        .rpc('get_checklist_members', {
          d: params.date,
          tid: params.trainingId
        })
        .order('lastname', { ascending: true })
        .order('firstname', { ascending: true }),
      supabaseClient.rpc('get_checklist_member_streak', {
        tid: params.trainingId,
        before_date: params.date,
        n: STREAK_LENGTH
      })
    ]);

    if (checklistResult.error) {
      throw err(404, checklistResult.error);
    }

    return buildMembersWithStreaks(checklistResult.data, streakResult.data || []) as MMember[];
  }

  const { data: topBadges } = await supabaseClient.rpc('get_members_top_badges');

  const badgeMap: Record<string, string> = {};
  if (Array.isArray(topBadges)) {
    for (const tb of topBadges as MemberTopBadge[]) {
      badgeMap[tb.memberId] = tb.emoji;
    }
  }

  return {
    trainingId: params.trainingId,
    date: params.date,
    participants: await getMembersWithPresentStatus(),
    badgeMap
  };
}) satisfies PageLoad;
