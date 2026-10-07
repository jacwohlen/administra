import { redirect, error as err } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { supabaseClient } from '$lib/supabase';

export interface TrainerOption {
  id: number;
  firstname: string;
  lastname: string;
  /** On this training's participant list, so offered first. */
  participant: boolean;
}

// Viewers may look at a training but not edit it
export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite } = await parent();
  if (!canWrite) {
    redirect(303, `/dashboard/trainings/${params.trainingId}`);
  }

  // Main trainer candidates: members, without trial candidates and archived ones.
  const { data: members, error } = await supabaseClient
    .from('members')
    .select('id, firstname, lastname, labels')
    .is('archivedAt', null)
    .order('lastname')
    .order('firstname')
    .returns<{ id: number; firstname: string; lastname: string; labels: string[] | null }[]>();
  if (error) throw err(500, error);

  const { data: participants, error: partErr } = await supabaseClient
    .from('participants')
    .select('memberId')
    .eq('trainingId', Number(params.trainingId));
  if (partErr) throw err(500, partErr);

  const onList = new Set((participants ?? []).map((p) => p.memberId));
  const trainerOptions: TrainerOption[] = (members ?? [])
    .filter((m) => !(m.labels ?? []).includes('probetraining'))
    .map((m) => ({
      id: m.id,
      firstname: m.firstname,
      lastname: m.lastname,
      participant: onList.has(m.id)
    }));

  return { trainerOptions };
};
