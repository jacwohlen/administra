import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { loadAppSettings } from '$lib/appSettings';
import { usageKey } from '$lib/gradeLadders';
import type { GradeDefinition } from '$lib/models';
import type { PageLoad } from './$types';

/** Grade ladders per section, admins only (save_grade_ladder() checks again). */
export const load: PageLoad = async ({ parent, depends }) => {
  const { userProfile } = await parent();
  if (!userProfile || userProfile.role !== 'admin') {
    redirect(303, '/dashboard');
  }
  depends('app:grade-ladders');

  // The club's sections (clubConfig) as the settings say
  await loadAppSettings();
  // Fresh, not the per-session cache: this page is where ladders change
  const [definitions, gradings, candidates, programs] = await Promise.all([
    supabaseClient.from('grade_definitions').select('*').order('gradeRank'),
    supabaseClient.from('member_grades').select('section, grade'),
    supabaseClient.from('exam_candidates').select('section, grade'),
    supabaseClient.from('exam_programs').select('section, grade')
  ]);
  const failed = [definitions, gradings, candidates, programs].find((r) => r.error);
  if (failed?.error) {
    error(500, failed.error.message);
  }

  // How often each grade is used; a used grade cannot be deleted
  const usage: Record<string, number> = {};
  for (const row of [
    ...(gradings.data ?? []),
    ...(candidates.data ?? []),
    ...(programs.data ?? [])
  ]) {
    const key = usageKey(row.section, row.grade);
    usage[key] = (usage[key] ?? 0) + 1;
  }

  return {
    gradeDefinitions: (definitions.data ?? []) as GradeDefinition[],
    usage
  };
};
