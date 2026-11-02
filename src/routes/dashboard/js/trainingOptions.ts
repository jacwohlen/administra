import { error as err } from '@sveltejs/kit';
import { supabaseClient } from '#lib/supabase.ts';
import type { Training } from '#lib/models.ts';
import { compareTrainings } from '#lib/trainingUtils.ts';

/** All trainings, in the order of the trainings page, to assign to a course. */
export async function loadTrainingOptions(): Promise<Training[]> {
  const { data, error } = await supabaseClient.from('trainings').select('*').returns<Training[]>();
  if (error) throw err(500, error.message);
  return (data ?? []).sort(compareTrainings);
}
