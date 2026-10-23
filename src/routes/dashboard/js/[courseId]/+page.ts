import { error as err } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { loadCourseData } from '$lib/jsCourseData';
import { buildCourseExport } from '$lib/jsExport';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  let data;
  try {
    data = await loadCourseData(supabaseClient, Number(params.courseId));
  } catch (e) {
    throw err(500, (e as { message?: string })?.message ?? 'Loading the course failed');
  }
  if (!data) throw err(404, 'Course not found');

  return {
    course: data.course,
    trainings: data.trainings,
    result: buildCourseExport(data.course, data.trainings, data.logs, data.members)
  };
};
