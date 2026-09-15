import type { PageLoad } from './$types';
import type { MMember } from './types';
import type { MedalCounts, MemberSectionGrade, MemberTopBadge } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import { buildMembersWithStreaks } from '$lib/trainingUtils';
import { displayConfig, loadAppSettings } from '$lib/appSettings';

export const load = (async ({ params }) => {
  // Page loads run concurrently with the root layout load, so make sure any
  // admin-configured streak length is applied before querying.
  await loadAppSettings();
  const [
    checklistResult,
    streakResult,
    { data: topBadges },
    { data: grades },
    { data: medalCounts },
    { data: trialMembers }
  ] = await Promise.all([
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
      n: displayConfig.checklistStreakLength
    }),
    supabaseClient.rpc('get_members_top_badges'),
    supabaseClient.rpc('get_members_current_grades'),
    supabaseClient.rpc('get_members_medal_counts'),
    supabaseClient.from('view_trial_members').select('id, attendedCount')
  ]);

  if (checklistResult.error) {
    throw err(404, checklistResult.error);
  }

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

  // Attended-session count per trial member ("probetraining" label), so the
  // checklist can flag candidates who have reached the membership threshold.
  const trialCountMap: Record<string, number> = {};
  if (Array.isArray(trialMembers)) {
    for (const t of trialMembers as { id: number; attendedCount: number }[]) {
      trialCountMap[t.id] = t.attendedCount;
    }
  }

  return {
    trainingId: params.trainingId,
    date: params.date,
    participants: buildMembersWithStreaks(
      checklistResult.data,
      streakResult.data || []
    ) as MMember[],
    badgeMap,
    gradeMap,
    medalMap,
    trialCountMap
  };
}) satisfies PageLoad;
