import { redirect, error as err } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { compareTrainings } from '$lib/trainingUtils';
import type { Training, TrainingPlanBreak } from '$lib/models';
import { loadPlanMembers } from '../members';
import type { PageLoad } from './$types';

// Which trainings are planned, the holidays and the import: the TK
export const load: PageLoad = async ({ parent, depends }) => {
  const { canPlanTrainings } = await parent();
  if (!canPlanTrainings) {
    redirect(303, '/dashboard/training-plan');
  }
  depends('training-plan:settings');

  const [trainings, planned, breaks] = await Promise.all([
    supabaseClient
      .from('trainings')
      .select('id, title, weekday, dateFrom, dateTo, section, mainTrainerId')
      .returns<Training[]>(),
    supabaseClient
      .from('training_plan_trainings')
      .select('training_id')
      .returns<{ training_id: number }[]>(),
    // connection: a provider's holiday (Webling) is read-only but for "Dojo zu"
    supabaseClient
      .from('training_plan_breaks')
      .select('id, title, date_from, date_to, cancels_training, connection')
      .order('date_from', { ascending: false })
      .returns<TrainingPlanBreak[]>()
  ]);
  for (const r of [trainings, planned, breaks]) {
    if (r.error) throw err(500, r.error.message);
  }

  const all = (trainings.data ?? []).sort(compareTrainings);
  const plannedIds = (planned.data ?? []).map((p) => p.training_id);
  const plannedTrainings = all
    .filter((t) => plannedIds.includes(Number(t.id)))
    .map((t) => ({ ...t, id: Number(t.id) }));

  let members;
  try {
    members = await loadPlanMembers(plannedTrainings);
  } catch (e) {
    throw err(500, (e as Error).message);
  }

  return {
    trainings: all,
    plannedIds,
    plannedTrainings,
    breaks: breaks.data ?? [],
    members
  };
};
