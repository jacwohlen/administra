import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from '$lib/models';
import type { PlanEvent, PlanTraining } from '$lib/trainingPlanUtils';
import { endsOnOrAfter } from '$lib/eventUtils';
import { loadPlanMembers } from './members';
import type { PageLoad } from './$types';

// The plan covers one calendar year (?year=2027), the current one by default
export const load: PageLoad = async ({ url, depends }) => {
  depends('training-plan:year');
  const param = Number(url.searchParams.get('year'));
  const year = Number.isInteger(param) && param > 2000 && param < 2100 ? param : dayjs().year();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [plan, sessions, breaks, events] = await Promise.all([
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
      .returns<PlanEvent[]>()
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
    members
  };
};
