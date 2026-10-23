import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseLog, CourseMember, CourseTraining, JsCourse } from './jsExport';

export interface CourseData {
  course: JsCourse;
  trainings: CourseTraining[];
  logs: CourseLog[];
  members: CourseMember[];
}

// PostgREST returns at most 1000 rows per request; a year of attendance
// in a course is more than that.
const PAGE = 1000;
// Ids per `in` filter, so the request URL stays short
const ID_CHUNK = 150;

/**
 * A J+S course with its trainings and the attendance logged in them within
 * the course dates. Works with the browser client and with the server's
 * `locals.supabase`; row-level security limits both to staff.
 */
export async function loadCourseData(
  supabase: SupabaseClient,
  courseId: number
): Promise<CourseData | null> {
  const { data: course, error: courseError } = await supabase
    .from('js_courses')
    .select('*, js_course_trainings(training_id)')
    .eq('id', courseId)
    .maybeSingle<JsCourse>();
  if (courseError) throw courseError;
  if (!course) return null;

  const trainingIds = (course.js_course_trainings ?? []).map((t) => t.training_id);
  if (!trainingIds.length) return { course, trainings: [], logs: [], members: [] };

  const { data: trainings, error: trainingsError } = await supabase
    .from('trainings')
    .select('id, title, dateFrom, dateTo')
    .in('id', trainingIds)
    .returns<CourseTraining[]>();
  if (trainingsError) throw trainingsError;

  const logs: CourseLog[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('logs')
      .select('date, trainingId, memberId, trainerRole')
      .in('trainingId', trainingIds)
      .gte('date', course.date_from)
      .lte('date', course.date_to)
      .not('memberId', 'is', null)
      .order('date')
      .order('trainingId')
      .order('memberId')
      .range(from, from + PAGE - 1)
      .returns<CourseLog[]>();
    if (error) throw error;
    logs.push(...data);
    if (data.length < PAGE) break;
  }

  const memberIds = [...new Set(logs.map((l) => l.memberId))];
  const members: CourseMember[] = [];
  for (let i = 0; i < memberIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('members')
      .select('id, firstname, lastname, jsPersonNumber')
      .in('id', memberIds.slice(i, i + ID_CHUNK))
      .returns<CourseMember[]>();
    if (error) throw error;
    members.push(...data);
  }

  return { course, trainings: trainings ?? [], logs, members };
}
