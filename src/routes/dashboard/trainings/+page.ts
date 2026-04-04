import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Training } from '$lib/models';
import { compareTrainings } from '$lib/trainingUtils';

export async function load() {
  const { error, data } = await supabaseClient.from('trainings').select('*').returns<Training[]>();
  if (error) {
    throw err(404, error);
  }

  data.sort(compareTrainings);

  return {
    trainings: data
  };
}
