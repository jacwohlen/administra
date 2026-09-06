import type { PageLoad } from './$types';
import type { MMember } from './types';
import type { MedalCounts, MemberSectionGrade, MemberTopBadge } from '$lib/models';
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

  const [{ data: topBadges }, { data: grades }, { data: medalCounts }] = await Promise.all([
    supabaseClient.rpc('get_members_top_badges'),
    supabaseClient.rpc('get_members_current_grades'),
    supabaseClient.rpc('get_members_medal_counts')
  ]);

  const badgeMap: Record<string, string> = {};
  if (Array.isArray(topBadges)) {
    for (const tb of topBadges as MemberTopBadge[]) {
      badgeMap[tb.memberId] = tb.emoji;
    }
  }

  // Current grade per member in every section; the page picks the training's section
  const gradeMap: Record<string, MemberSectionGrade[]> = {};
  if (Array.isArray(grades)) {
    for (const g of grades as MemberSectionGrade[]) {
      (gradeMap[g.memberId] ??= []).push(g);
    }
  }

  const medalMap: Record<string, MedalCounts> = {};
  if (Array.isArray(medalCounts)) {
    for (const m of medalCounts as MedalCounts[]) {
      medalMap[m.memberId] = m;
    }
  }

  return {
    trainingId: params.trainingId,
    date: params.date,
    participants: await getMembersWithPresentStatus(),
    badgeMap,
    gradeMap,
    medalMap
  };
}) satisfies PageLoad;
