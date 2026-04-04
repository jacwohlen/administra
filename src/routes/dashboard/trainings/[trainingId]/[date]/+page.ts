import type { PageLoad } from './$types';
import type { MMember } from './types';
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

  return {
    trainingId: params.trainingId,
    date: params.date,
    participants: await getMembersWithPresentStatus()
  };
}) satisfies PageLoad;
