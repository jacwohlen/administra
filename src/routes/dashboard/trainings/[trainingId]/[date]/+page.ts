import type { PageLoad } from './$types';
import type { MMember } from './types';
import type { TrainerRole } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';

interface ChecklistMemberData {
  memberId: string;
  firstname: string;
  lastname: string;
  labels: string[];
  img: string;
  date: string | null;
  trainerRole: TrainerRole;
}

interface StreakRow {
  memberId: number;
  date: string;
  seq: number;
}

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

    // Build a map: memberId -> Set of seq numbers they attended
    const streakRows: StreakRow[] = streakResult.data || [];
    const totalDates = new Set(streakRows.map((r) => r.seq)).size;
    const memberSeqs = new Map<number, Set<number>>();
    for (const row of streakRows) {
      if (!memberSeqs.has(row.memberId)) {
        memberSeqs.set(row.memberId, new Set());
      }
      memberSeqs.get(row.memberId)!.add(row.seq);
    }

    // Build ordered sequence numbers (1..totalDates)
    const seqNumbers = Array.from({ length: totalDates }, (_, i) => i + 1);

    return checklistResult.data.map(
      (item: ChecklistMemberData) =>
        ({
          id: item.memberId,
          firstname: item.firstname,
          lastname: item.lastname,
          labels: item.labels,
          img: item.img,
          isPresent: item.date ? true : false,
          trainerRole: item.trainerRole || 'attendee',
          streak: seqNumbers.map((seq) => memberSeqs.get(Number(item.memberId))?.has(seq) ?? false)
        } as MMember)
    );
  }

  return {
    trainingId: params.trainingId,
    date: params.date,
    participants: await getMembersWithPresentStatus()
  };
}) satisfies PageLoad;
