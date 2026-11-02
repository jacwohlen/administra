import { rpcRows, supabaseClient } from '#lib/supabase.ts';
import { error as err } from '@sveltejs/kit';
import dayjs from 'dayjs';
import type { TrainingPlanBreak, TrainingPlanSession } from '#lib/models.ts';
import { plannableTrainingIds, type PlanEvent, type PlanTraining } from '#lib/trainingPlanUtils.ts';
import { endsOnOrAfter } from '#lib/eventUtils.ts';
import { loadPlanMembers } from './members';
import { REQUEST_COLUMNS, type PlanRequest } from '#lib/trainingPlanRequests.ts';
import type { PageLoad } from './$types';

/** The account's members (my_member_ids()): the dates they lead can be handed on */
async function myMemberIds(): Promise<number[]> {
  const { data, error } = await rpcRows<number>('my_member_ids');
  if (error) {
    console.error('Error loading the own members:', error);
    return [];
  }
  return data.map(Number).filter((id) => Number.isSafeInteger(id));
}

/**
 * Substitutes and swaps: every open request (a few at most), and the
 * confirmed ones of the year, for the hints on the rows. Without an answer
 * (the database before the migration) there are none
 */
async function loadRequests(from: string, to: string): Promise<PlanRequest[]> {
  const { data, error } = await supabaseClient
    .from('training_plan_requests')
    .select(REQUEST_COLUMNS)
    .or(
      `status.eq.open,and(status.eq.accepted,date.gte.${from},date.lte.${to}),` +
        `and(status.eq.accepted,other_date.gte.${from},other_date.lte.${to})`
    )
    .order('created_at')
    .returns<PlanRequest[]>();
  if (error) {
    console.error('Error loading the plan requests:', error);
    return [];
  }
  return data ?? [];
}

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

  const [plan, sessions, breaks, events, { all, own }, myIds, requests] = await Promise.all([
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
    access,
    myMemberIds(),
    loadRequests(from, to)
  ]);
  for (const r of [plan, sessions, breaks, events]) {
    if (r.error) throw err(500, r.error.message);
  }

  const trainings = (plan.data ?? []).map((p) => p.training).filter(Boolean);
  let members;
  try {
    members = await loadPlanMembers(trainings, [
      ...(sessions.data ?? []).flatMap((s) => (s.trainer_id ? [s.trainer_id] : [])),
      ...requests.flatMap((r) => [r.from_member_id, r.to_member_id])
    ]);
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
    // The account's members, and the requests to stand in or swap
    myMemberIds: myIds,
    requests,
    // The trainings whose dates this account edits; RLS stays the guard
    plannableIds: plannableTrainingIds(trainings, all, own)
  };
};
