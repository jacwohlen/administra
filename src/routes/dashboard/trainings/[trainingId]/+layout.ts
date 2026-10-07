import type { LayoutLoad } from './$types';
import { error as err } from '@sveltejs/kit';
import type { Training } from '$lib/models';
import { supabaseClient } from '$lib/supabase';

export const load = (async ({ params }) => {
  const { error, data } = await supabaseClient
    .from('trainings')
    .select(
      `*, participants (*), mainTrainer:members!trainings_main_trainer_id_fkey (id, firstname, lastname, mobile, email)`
    )
    .eq('id', params.trainingId)
    .single();

  if (error) {
    throw err(404, error);
  }

  return data as Training;
}) satisfies LayoutLoad;
