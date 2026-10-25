import { supabaseClient } from '$lib/supabase';
import dayjs from 'dayjs';
import type { PlanTraining } from '$lib/trainingPlanUtils';
import { hasTrialLabel } from '$lib/trialUtils';

export interface PlanMember {
  id: number;
  firstname: string;
  lastname: string;
  /**
   * Adult trainer in Webling, led one of the planned trainings in the last
   * year, or is planned to: offered first
   */
  trainer: boolean;
}

/**
 * The members a training can be planned for (no trial candidates, nobody
 * archived), trainers of the planned trainings first
 */
export async function loadPlanMembers(
  trainings: PlanTraining[],
  plannedIds: number[] = []
): Promise<PlanMember[]> {
  const [members, logs] = await Promise.all([
    supabaseClient
      .from('members')
      .select('id, firstname, lastname, labels')
      .is('archivedAt', null)
      .order('lastname')
      .order('firstname')
      .returns<{ id: number; firstname: string; lastname: string; labels: string[] | null }[]>(),
    trainings.length > 0
      ? supabaseClient
          .from('logs')
          .select('memberId')
          .in(
            'trainingId',
            trainings.map((t) => t.id)
          )
          .eq('trainerRole', 'main_trainer')
          .gte('date', dayjs().subtract(1, 'year').format('YYYY-MM-DD'))
          .returns<{ memberId: number | null }[]>()
      : Promise.resolve({ data: [], error: null })
  ]);
  if (members.error) throw members.error;
  if (logs.error) throw logs.error;

  const trainerIds = new Set<number>(plannedIds);
  for (const t of trainings) if (t.mainTrainerId) trainerIds.add(t.mainTrainerId);
  for (const l of logs.data ?? []) if (l.memberId) trainerIds.add(l.memberId);
  // Webling labels the trainers too ("Erwachsenentrainer")
  for (const m of members.data ?? []) {
    if ((m.labels ?? []).some((l) => l.toLowerCase().includes('erwachsenentrainer'))) {
      trainerIds.add(m.id);
    }
  }

  return (members.data ?? [])
    .filter((m) => trainerIds.has(m.id) || !hasTrialLabel(m.labels))
    .map((m) => ({
      id: m.id,
      firstname: m.firstname,
      lastname: m.lastname,
      trainer: trainerIds.has(m.id)
    }));
}
