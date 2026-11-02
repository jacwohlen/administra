import { error as err } from '@sveltejs/kit';
import { supabaseClient } from '#lib/supabase.ts';
import type { JsCourse } from '#lib/jsExport.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
  const { data, error } = await supabaseClient
    .from('js_courses')
    .select('*, js_course_trainings(training_id)')
    .order('date_from', { ascending: false })
    .returns<JsCourse[]>();
  if (error) throw err(500, error.message);
  return { courses: data ?? [] };
};
