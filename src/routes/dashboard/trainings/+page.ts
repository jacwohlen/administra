import { supabaseClient } from '#lib/supabase.ts';
import { error as err } from '@sveltejs/kit';
import type { Training } from '#lib/models.ts';
import { compareTrainings } from '#lib/trainingUtils.ts';

export async function load() {
  const { error, data } = await supabaseClient.from('trainings').select('*').returns<Training[]>();
  if (error) {
    throw err(404, error.message);
  }

  data.sort(compareTrainings);

  return {
    trainings: data
  };
}
