import { rpcRows, supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from '$lib/models';
import { plannableTrainingIds, type PlanEvent, type PlanTraining } from '$lib/trainingPlanUtils';
import { endsOnOrAfter } from '$lib/eventUtils';
import { loadPlanMembers } from './members';
import type { PageLoad } from './$types';

/**
 * The planned trainings an account leads as main trainer while it has a
 * writing role (my_main_training_ids(), the rule of the RLS policies on
 * training_plan_sessions). Without an answer (the database before the
 * migration) the plan stays read-only for it, as before
 */
async function mainTrainingIds(): Promise<number[]> {
  const { data, error } = await rpcRows<number>('my_main_training_ids');
  if (error) {
    console.error('Error loading the own trainings:', error);
    return [];
  }
  return data.map(Number).filter((id) => Number.isSafeInteger(id));
}

// The plan covers one calendar year (?year=2027), the current one by default
export const load: PageLoad = async ({ url, depends, parent }) => {
  depends('training-plan:year');
  const param = Number(url.searchParams.get('year'));
  const year = Number.isInteger(param) && param > 2000 && param < 2100 ? param : dayjs().year();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  // Who plans which training: the TK all of them, a trainer their own as
  // main trainer, so only trainers ask; viewers plan nothing
  const access = parent().then(async ({ canWrite, canPlanTrainings }) => ({
    all: canPlanTrainings,
    own: canWrite && !canPlanTrainings ? await mainTrainingIds() : []
  }));

  const [plan, sessions, breaks, events, { all, own }] = await Promise.all([
    supabaseClient
      .from('training_plan_trainings')
      .select('training:trainings (id, title, weekday, dateFrom, section, mainTrainerId)')
      .returns<{ training: PlanTraining }[]>(),
    supabaseClient
      .from('training_plan_sessions')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .returns<TrainingPlanSession[]>(),
    supabaseClient
      .from('training_plan_breaks')
      .select('id, title, date_from, date_to, cancels_training')
      .lte('date_from', to)
      .gte('date_to', from)
      .order('date_from')
      .returns<TrainingPlanBreak[]>(),
    // Everything overlapping the year, also what starts in December before
    supabaseClient
      .from('events')
      .select('id, title, date, date_to, section')
      .lte('date', to)
      .or(endsOnOrAfter(from))
      .order('date')
      .returns<PlanEvent[]>(),
    access
  ]);
  for (const r of [plan, sessions, breaks, events]) {
    if (r.error) throw err(500, r.error.message);
  }

  const trainings = (plan.data ?? []).map((p) => p.training).filter(Boolean);
  let members;
  try {
    members = await loadPlanMembers(
      trainings,
      (sessions.data ?? []).flatMap((s) => (s.trainer_id ? [s.trainer_id] : []))
    );
  } catch (e) {
    throw err(500, (e as Error).message);
  }

  return {
    year,
    from,
    to,
    trainings,
    sessions: sessions.data ?? [],
    breaks: breaks.data ?? [],
    events: events.data ?? [],
    members,
    // The trainings whose dates this account edits; RLS stays the guard
    plannableIds: plannableTrainingIds(trainings, all, own)
  };
};
