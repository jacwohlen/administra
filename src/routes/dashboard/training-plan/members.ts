import { supabaseClient } from '$lib/supabase';
import dayjs from 'dayjs';
import type { PlanTraining } from '$lib/trainingPlanUtils';
import { canBeTrainer, hasTrainerLabel } from '$lib/memberStatus';
import { loadIntegrationConfig } from '$lib/integrationConfigLoad';
import type { MembershipStatus } from '$lib/models';

export interface PlanMember {
  id: number;
  firstname: string;
  lastname: string;
  /**
   * In a trainer group (role 'trainer' in the integration catalog, Webling's
   * Erwachsenentrainer), led one of the planned trainings in the last year,
   * or is planned to: offered first
   */
  trainer: boolean;
}

/**
 * The members a training can be planned for (active and passive members,
 * nobody archived), trainers of the planned trainings first
 */
export async function loadPlanMembers(
  trainings: PlanTraining[],
  plannedIds: number[] = []
): Promise<PlanMember[]> {
  const [members, logs] = await Promise.all([
    supabaseClient
      .from('members')
      .select('id, firstname, lastname, labels, membership_status')
      .is('archivedAt', null)
      .order('lastname')
      .order('firstname')
      .returns<
        {
          id: number;
          firstname: string;
          lastname: string;
          labels: string[] | null;
          membership_status: MembershipStatus | null;
        }[]
      >(),
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
      : Promise.resolve({ data: [], error: null }),
    // The trainer groups: this load does not wait for the dashboard layout,
    // which loads them too (one request for both)
    loadIntegrationConfig()
  ]);
  if (members.error) throw members.error;
  if (logs.error) throw logs.error;

  const trainerIds = new Set<number>(plannedIds);
  for (const t of trainings) if (t.mainTrainerId) trainerIds.add(t.mainTrainerId);
  for (const l of logs.data ?? []) if (l.memberId) trainerIds.add(l.memberId);
  // The provider's trainer groups mark trainers too
  for (const m of members.data ?? []) {
    if (hasTrainerLabel(m.labels)) trainerIds.add(m.id);
  }

  // Who is already planned or the default trainer stays selectable; everybody
  // else only while an active or passive member
  const keep = new Set<number>(plannedIds);
  for (const t of trainings) if (t.mainTrainerId) keep.add(t.mainTrainerId);

  return (members.data ?? [])
    .filter((m) => keep.has(m.id) || canBeTrainer(m.membership_status))
    .map((m) => ({
      id: m.id,
      firstname: m.firstname,
      lastname: m.lastname,
      trainer: trainerIds.has(m.id)
    }));
}
