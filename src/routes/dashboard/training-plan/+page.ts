import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from '$lib/models';
import type { PlanEvent, PlanTraining } from '$lib/trainingPlanUtils';
import type { PageLoad } from './$types';

export interface PlanMember {
  id: number;
  firstname: string;
  lastname: string;
  /**
   * Adult trainer in Webling, led one of the planned trainings in the last
   * year, or is planned to: offered first
   */
  trainer: boolean;
}

// The plan covers one calendar year (?year=2027), the current one by default
export const load: PageLoad = async ({ url, depends }) => {
  depends('training-plan:year');
  const param = Number(url.searchParams.get('year'));
  const year = Number.isInteger(param) && param > 2000 && param < 2100 ? param : dayjs().year();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [plan, sessions, breaks, events, members] = await Promise.all([
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
      .select('id, title, date_from, date_to')
      .lte('date_from', to)
      .gte('date_to', from)
      .order('date_from')
      .returns<TrainingPlanBreak[]>(),
    supabaseClient
      .from('events')
      .select('id, title, date, section')
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .returns<PlanEvent[]>(),
    supabaseClient
      .from('members')
      .select('id, firstname, lastname, labels')
      .is('archivedAt', null)
      .order('lastname')
      .order('firstname')
      .returns<{ id: number; firstname: string; lastname: string; labels: string[] | null }[]>()
  ]);
  for (const r of [plan, sessions, breaks, events, members]) {
    if (r.error) throw err(500, r.error.message);
  }

  const trainings = (plan.data ?? []).map((p) => p.training).filter(Boolean);

  // Trainers of the planned trainings: main trainers in the last year, the
  // trainings' main trainers and whoever is already planned
  const trainerIds = new Set<number>();
  for (const t of trainings) if (t.mainTrainerId) trainerIds.add(t.mainTrainerId);
  for (const s of sessions.data ?? []) if (s.trainer_id) trainerIds.add(s.trainer_id);
  if (trainings.length > 0) {
    const { data: logs, error } = await supabaseClient
      .from('logs')
      .select('memberId')
      .in(
        'trainingId',
        trainings.map((t) => t.id)
      )
      .eq('trainerRole', 'main_trainer')
      .gte('date', dayjs().subtract(1, 'year').format('YYYY-MM-DD'))
      .returns<{ memberId: number | null }[]>();
    if (error) throw err(500, error.message);
    for (const l of logs ?? []) if (l.memberId) trainerIds.add(l.memberId);
  }

  // Webling labels the trainers too ("Erwachsenentrainer", "Kindertrainer")
  for (const m of members.data ?? []) {
    if ((m.labels ?? []).some((l) => l.toLowerCase().includes('erwachsenentrainer'))) {
      trainerIds.add(m.id);
    }
  }

  const people: PlanMember[] = (members.data ?? [])
    .filter((m) => trainerIds.has(m.id) || !(m.labels ?? []).includes('probetraining'))
    .map((m) => ({
      id: m.id,
      firstname: m.firstname,
      lastname: m.lastname,
      trainer: trainerIds.has(m.id)
    }));

  return {
    year,
    from,
    to,
    trainings,
    sessions: sessions.data ?? [],
    breaks: breaks.data ?? [],
    events: events.data ?? [],
    members: people
  };
};
