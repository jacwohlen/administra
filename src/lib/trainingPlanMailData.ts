import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrainingPlanBreak, TrainingPlanSession } from './models';
import { addDays, zurichToday, type FeedTraining } from './calendarFeed';
import {
  MAIL_DAYS_AHEAD,
  type MailAddress,
  type MailMember,
  type MailPlanData,
  type MailScope,
  type PendingMail,
  type ToldDateRow,
  type ToldTrainingRow
} from './trainingPlanMail';

/**
 * What the plan mails compare (src/lib/trainingPlanMail.ts): the plan from
 * today (Europe/Zurich) on, what each trainer was last told, opt-outs, names,
 * addresses and mails still 'pending' in the log (outcome unknown). Works with the browser client (the dialog's preview) and
 * with the server's `locals.supabase` (the endpoint recomputes before it
 * sends); row-level security limits both to staff, the address lookup to
 * planners. The plan page's own load covers one calendar year, so this one
 * loads separately; session notes are never selected.
 */

// PostgREST returns at most 1000 rows per request
const PAGE = 1000;
// Ids per `in` filter, so the request URL stays short
const ID_CHUNK = 150;

interface Result<T> {
  data: T | null;
  error: unknown;
}

/** Which trainings the signed-in account plans: the TK all, a main trainer their own, else none */
export async function loadMailScope(supabase: SupabaseClient): Promise<MailScope | null> {
  const manager = await supabase.rpc('is_exam_manager');
  if (manager.error) throw manager.error;
  if (manager.data === true) return { all: true, trainingIds: [] };
  const own = await supabase.rpc('my_main_training_ids');
  if (own.error) throw own.error;
  const trainingIds = ((own.data ?? []) as unknown[])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return trainingIds.length > 0 ? { all: false, trainingIds } : null;
}

/** Every page of a query, `page(from, to)` building it anew each time */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<Result<T[]>>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

interface Abortable<Q> {
  abortSignal(signal: AbortSignal): Q;
}

interface Filterable<Q> {
  in(column: string, values: number[]): Q;
}

function checked<T>({ data, error }: Result<T>): T {
  if (error) throw error;
  return data as T;
}

/** The plan, the told state and the people involved, for the trainings of the scope */
export async function loadMailPlan(
  supabase: SupabaseClient,
  scope: MailScope,
  options: { now?: Date; signal?: AbortSignal } = {}
): Promise<MailPlanData> {
  const today = zurichToday(options.now ?? new Date());
  const to = addDays(today, MAIL_DAYS_AHEAD);
  const empty: MailPlanData = {
    today,
    to,
    trainings: [],
    sessions: [],
    breaks: [],
    toldTrainings: [],
    toldDates: [],
    optOuts: [],
    ownMemberIds: [],
    members: [],
    addresses: [],
    pendingMails: []
  };
  if (!scope.all && scope.trainingIds.length === 0) return empty;

  const { signal } = options;
  // Both return the query builder they are given (typed loosely: the
  // builders' own generics are too deep for a structural constraint)
  const abortable = <Q>(query: Q): Q =>
    signal ? (query as unknown as Abortable<Q>).abortSignal(signal) : query;
  // A main trainer only reads what concerns their own trainings
  const own = <Q>(query: Q): Q =>
    scope.all ? query : (query as unknown as Filterable<Q>).in('training_id', scope.trainingIds);

  const [plan, sessions, breaks, toldTrainings, toldDates, optOuts, ownIds] = await Promise.all([
    abortable(
      supabase
        .from('training_plan_trainings')
        .select('training:trainings (id, title, weekday, dateFrom, dateTo, section, mainTrainerId)')
    ).returns<{ training: FeedTraining | null }[]>(),
    allPages((from, last) =>
      abortable(
        own(
          supabase
            .from('training_plan_sessions')
            .select('id, training_id, date, trainer_id, topic, cancelled')
            .gte('date', today)
            .lte('date', to)
        )
          .order('training_id')
          .order('date')
          .range(from, last)
      ).returns<Omit<TrainingPlanSession, 'notes' | 'updated_at'>[]>()
    ),
    abortable(
      supabase
        .from('training_plan_breaks')
        .select('id, title, date_from, date_to, cancels_training')
        .gte('date_to', today)
        .lte('date_from', to)
        .order('date_from')
    ).returns<TrainingPlanBreak[]>(),
    allPages((from, last) =>
      abortable(
        own(
          supabase
            .from('training_plan_told_trainings')
            .select('member_id, training_id, is_main, title, weekday, time_from, time_to, told_at')
        )
          .order('member_id')
          .order('training_id')
          .range(from, last)
      ).returns<ToldTrainingRow[]>()
    ),
    allPages((from, last) =>
      abortable(
        own(
          supabase
            .from('training_plan_told')
            .select('member_id, training_id, date, state')
            .gte('date', today)
        )
          .order('member_id')
          .order('training_id')
          .order('date')
          .range(from, last)
      ).returns<ToldDateRow[]>()
    ),
    abortable(supabase.from('training_plan_mail_optouts').select('member_id')).returns<
      { member_id: number }[]
    >(),
    abortable(supabase.rpc('my_member_ids'))
  ]);

  const trainings = (checked(plan) ?? []).flatMap((p) => (p.training ? [p.training] : []));
  const inScope = (id: number) => scope.all || scope.trainingIds.includes(id);
  const planned = new Set(trainings.filter((t) => inScope(t.id)).map((t) => t.id));

  // Everyone the comparison may name: main trainers, planned trainers and
  // members told before (computeNotices() looks at the same)
  const ids = new Set<number>();
  for (const t of trainings) {
    if (planned.has(t.id) && t.mainTrainerId != null) ids.add(t.mainTrainerId);
  }
  for (const s of sessions) {
    if (planned.has(s.training_id) && s.trainer_id != null) ids.add(s.trainer_id);
  }
  for (const t of toldTrainings) if (inScope(t.training_id)) ids.add(t.member_id);
  const memberIds = [...ids].sort((a, b) => a - b);

  const chunks: number[][] = [];
  for (let i = 0; i < memberIds.length; i += ID_CHUNK) {
    chunks.push(memberIds.slice(i, i + ID_CHUNK));
  }
  const [members, addresses, pending] = memberIds.length
    ? await Promise.all([
        Promise.all(
          chunks.map(async (chunk) =>
            checked(
              await abortable(
                supabase.from('members').select('id, firstname, lastname').in('id', chunk)
              ).returns<MailMember[]>()
            )
          )
        ).then((lists) => lists.flatMap((list) => list ?? [])),
        abortable(supabase.rpc('training_plan_mail_addresses', { p_member_ids: memberIds })).then(
          (result) => (checked(result) ?? []) as MailAddress[]
        ),
        // Rare (a send cut off, or under way): newest first, so a capped
        // answer still has each member's newest
        Promise.all(
          chunks.map(async (chunk) =>
            checked(
              await abortable(
                supabase
                  .from('training_plan_mails')
                  .select('member_id, created_at')
                  .eq('status', 'pending')
                  .in('member_id', chunk)
                  .order('created_at', { ascending: false })
              ).returns<PendingMail[]>()
            )
          )
        ).then((lists) => lists.flatMap((list) => list ?? []))
      ])
    : [[], [], []];

  // The newest pending row per member
  const pendingMails: PendingMail[] = [];
  const seen = new Set<number>();
  for (const row of pending) {
    if (seen.has(row.member_id)) continue;
    seen.add(row.member_id);
    pendingMails.push({ member_id: row.member_id, created_at: row.created_at });
  }

  return {
    today,
    to,
    trainings,
    sessions: sessions.map((s) => ({ ...s, notes: null, updated_at: '' })),
    breaks: checked(breaks) ?? [],
    toldTrainings,
    toldDates,
    optOuts: (checked(optOuts) ?? []).map((o) => o.member_id),
    ownMemberIds: ((checked(ownIds) ?? []) as unknown[])
      .map(Number)
      .filter((id) => Number.isSafeInteger(id)),
    members,
    addresses,
    pendingMails
  };
}
