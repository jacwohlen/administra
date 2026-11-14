import { error, redirect } from '@sveltejs/kit';
import dayjs from 'dayjs';
import { supabaseClient } from '#lib/supabase.ts';
import { fetchAllRows } from '#lib/assistant/attendance.ts';
import { isAdmin } from '#lib/roles.ts';
import { endsOnOrAfter } from '#lib/eventUtils.ts';
import type { TrainingPlanBreak, TrainingPlanSession } from '#lib/models.ts';
import type { PlanTraining } from '#lib/trainingPlanUtils.ts';
import {
  buildActivityReport,
  reportPeriod,
  type ReportCoachLog,
  type ReportEvent,
  type ReportHeldSession,
  type ReportPerson,
  type ReportTrainerLog,
  type ReportTraining
} from '#lib/activityReport.ts';
import type { PageLoad } from './$types';

/** Ids per .in() filter, so the request URL stays short */
const ID_CHUNK = 200;

async function byIds<T>(
  ids: number[],
  query: (chunk: number[]) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await query(ids.slice(i, i + ID_CHUNK));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

// Einsätze (activity report): admins only
export const load: PageLoad = async ({ parent, url }) => {
  const { userProfile } = await parent();
  if (!isAdmin(userProfile)) redirect(303, '/dashboard');

  const today = dayjs().format('YYYY-MM-DD');
  const { from, to } = reportPeriod(url.searchParams, today);

  try {
    const [trainerLogs, held, events, trainings, planned, sessions, breaks] = await Promise.all([
      fetchAllRows<ReportTrainerLog>((a, b) =>
        supabaseClient
          .from('logs')
          .select('date, trainingId, memberId, trainerRole')
          .in('trainerRole', ['main_trainer', 'assistant'])
          .gte('date', from)
          .lte('date', to)
          .not('memberId', 'is', null)
          .order('date')
          .order('trainingId')
          .order('memberId')
          .range(a, b)
          .returns<ReportTrainerLog[]>()
      ),
      fetchAllRows<ReportHeldSession>((a, b) =>
        supabaseClient
          .from('view_logs_summary')
          .select('date, trainingId, count, mainTrainerCount')
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('trainingId')
          .range(a, b)
          .returns<ReportHeldSession[]>()
      ),
      fetchAllRows<ReportEvent>((a, b) =>
        supabaseClient
          .from('events')
          .select('id, title, date, date_to, section')
          .lte('date', to)
          .or(endsOnOrAfter(from))
          .order('date')
          .order('id')
          .range(a, b)
          .returns<ReportEvent[]>()
      ),
      fetchAllRows<ReportTraining & PlanTraining>((a, b) =>
        supabaseClient
          .from('trainings')
          .select('id, title, section, weekday, dateFrom, mainTrainerId')
          .order('id')
          .range(a, b)
          .returns<(ReportTraining & PlanTraining)[]>()
      ),
      supabaseClient
        .from('training_plan_trainings')
        .select('training_id')
        .returns<{ training_id: number }[]>(),
      fetchAllRows<TrainingPlanSession>((a, b) =>
        supabaseClient
          .from('training_plan_sessions')
          .select('*')
          .gte('date', from)
          .lte('date', to)
          .order('id')
          .range(a, b)
          .returns<TrainingPlanSession[]>()
      ),
      supabaseClient
        .from('training_plan_breaks')
        .select('id, title, date_from, date_to, cancels_training')
        .lte('date_from', to)
        .gte('date_to', from)
        .order('date_from')
        .returns<TrainingPlanBreak[]>()
    ]);
    if (planned.error) throw planned.error;
    if (breaks.error) throw breaks.error;

    // Coaches: '*' so the half-day column ("coachDay") comes along where the
    // database has it, and nothing breaks where it does not yet
    const coachLogs = await byIds<ReportCoachLog>(
      events.map((e) => e.id),
      (chunk) =>
        supabaseClient
          .from('event_logs')
          .select('*')
          .eq('isCoach', true)
          .in('eventId', chunk)
          .returns<ReportCoachLog[]>()
    );

    const plannedIds = new Set((planned.data ?? []).map((p) => p.training_id));
    const planTrainings = trainings.filter((t) => plannedIds.has(t.id));
    const memberIds = [
      ...new Set([
        ...trainerLogs.map((l) => l.memberId),
        ...coachLogs.map((c) => c.memberId),
        ...sessions.flatMap((s) => (s.trainer_id != null ? [s.trainer_id] : [])),
        ...planTrainings.flatMap((t) => (t.mainTrainerId != null ? [t.mainTrainerId] : []))
      ])
    ];
    const members = await byIds<ReportPerson>(memberIds, (chunk) =>
      supabaseClient
        .from('members')
        .select('id, firstname, lastname')
        .in('id', chunk)
        .returns<ReportPerson[]>()
    );

    const report = buildActivityReport({
      from,
      to,
      today,
      members,
      trainings,
      trainerLogs,
      held,
      events,
      coachLogs,
      plan: { trainings: planTrainings, sessions, breaks: breaks.data ?? [] }
    });
    return { from, to, report };
  } catch (e) {
    console.error('Error loading the activity report:', e);
    error(500, (e as { message?: string }).message ?? 'Error loading the report');
  }
};
