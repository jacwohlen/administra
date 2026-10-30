import { error as err } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { Training } from '$lib/models';
import { compareTrainings } from '$lib/trainingUtils';

/** All trainings, in the order of the trainings page, to assign to a course. */
export async function loadTrainingOptions(): Promise<Training[]> {
  const { data, error } = await supabaseClient.from('trainings').select('*').returns<Training[]>();
  if (error) throw err(500, error);
  return (data ?? []).sort(compareTrainings);
}
