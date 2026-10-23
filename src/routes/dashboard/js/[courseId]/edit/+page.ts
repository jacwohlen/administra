import { error as err, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { JsCourse } from '$lib/jsExport';
import { loadTrainingOptions } from '../../trainingOptions';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite } = await parent();
  if (!canWrite) {
    redirect(303, `/dashboard/js/${params.courseId}`);
  }

  const { data: course, error } = await supabaseClient
    .from('js_courses')
    .select('*, js_course_trainings(training_id)')
    .eq('id', Number(params.courseId))
    .maybeSingle<JsCourse>();
  if (error) throw err(500, error);
  if (!course) throw err(404, 'Course not found');

  return { course, trainings: await loadTrainingOptions() };
};
