import { redirect, error as err } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { supabaseClient } from '$lib/supabase';
import { canBeTrainer } from '$lib/memberStatus';
import type { MembershipStatus } from '$lib/models';

export interface TrainerOption {
  id: number;
  firstname: string;
  lastname: string;
  /** On this training's participant list, so offered first. */
  participant: boolean;
}

// Viewers may look at a training but not edit it
export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite, canPlanTrainings, mainTrainerId } = await parent();
  if (!canWrite) {
    redirect(303, `/dashboard/trainings/${params.trainingId}`);
  }
  // Only the TK sets the main trainer; the others see it read-only
  if (!canPlanTrainings) {
    return { trainerOptions: [] as TrainerOption[] };
  }

  // Main trainer candidates: active and passive members (no trial candidates,
  // non-members or people who left), none archived. The current main trainer
  // always stays selectable, so saving the form does not drop them.
  const { data: members, error } = await supabaseClient
    .from('members')
    .select('id, firstname, lastname, membership_status')
    .is('archivedAt', null)
    .order('lastname')
    .order('firstname')
    .returns<
      {
        id: number;
        firstname: string;
        lastname: string;
        membership_status: MembershipStatus | null;
      }[]
    >();
  if (error) throw err(500, error);

  const { data: participants, error: partErr } = await supabaseClient
    .from('participants')
    .select('memberId')
    .eq('trainingId', Number(params.trainingId));
  if (partErr) throw err(500, partErr);

  const onList = new Set((participants ?? []).map((p) => p.memberId));
  const trainerOptions: TrainerOption[] = (members ?? [])
    .filter((m) => m.id === mainTrainerId || canBeTrainer(m.membership_status))
    .map((m) => ({
      id: m.id,
      firstname: m.firstname,
      lastname: m.lastname,
      participant: onList.has(m.id)
    }));

  return { trainerOptions };
};
