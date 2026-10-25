import { redirect, error as err } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { compareTrainings } from '$lib/trainingUtils';
import type { Training } from '$lib/models';
import type { PageLoad } from './$types';

// The Daten-Assistent overview: for anyone who may save at least one of
// its proposals (trainers and admins, or the TK for the training plan)
export const load: PageLoad = async ({ parent }) => {
  const { canWrite, canPlanTrainings } = await parent();
  if (!canWrite && !canPlanTrainings) {
    redirect(303, '/dashboard');
  }

  const { data, error } = await supabaseClient
    .from('trainings')
    .select('id, title, weekday, dateFrom, dateTo, section')
    .returns<Training[]>();
  if (error) throw err(500, error.message);

  return { trainings: (data ?? []).sort(compareTrainings) };
};
