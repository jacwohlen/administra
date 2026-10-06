import type { PageLoad } from './$types';
import { error as err } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { TrialEmail, TrialMember, Training, TrainingActivity } from '$lib/models';

export const load = (async ({ depends }) => {
  depends('probetraining:list');

  const { data: trialMembers, error: trialErr } = await supabaseClient
    .from('view_trial_members')
    .select('*')
    .order('trialRegisteredAt', { ascending: false, nullsFirst: false })
    .order('lastname', { ascending: true })
    .returns<TrialMember[]>();

  if (trialErr) throw err(404, trialErr);

  const { data: trainings, error: trainingsErr } = await supabaseClient
    .from('trainings')
    .select('*')
    .returns<Training[]>();

  if (trainingsErr) throw err(404, trainingsErr);

  const { data: trainingActivity, error: activityErr } = await supabaseClient
    .from('view_training_activity')
    .select('*')
    .returns<TrainingActivity[]>();

  if (activityErr) throw err(404, activityErr);

  const memberIds = (trialMembers ?? []).map((m) => m.id);
  let assignments: { memberId: number; trainingId: number; trialStartDate: string | null }[] = [];
  let emails: TrialEmail[] = [];
  if (memberIds.length) {
    const { data: participantRows, error: partErr } = await supabaseClient
      .from('participants')
      .select('memberId, trainingId, trialStartDate')
      .in('memberId', memberIds);
    if (partErr) throw err(404, partErr);
    assignments = participantRows ?? [];

    const { data: emailRows, error: emailErr } = await supabaseClient
      .from('trial_emails')
      .select('id, member_id, kind, to_email, subject, status, error, created_at, sent_at')
      .in('member_id', memberIds)
      .order('created_at', { ascending: true })
      .returns<TrialEmail[]>();
    if (emailErr) throw err(404, emailErr);
    emails = emailRows ?? [];
  }

  return {
    trialMembers: trialMembers ?? [],
    trainings: trainings ?? [],
    trainingActivity: trainingActivity ?? [],
    assignments,
    emails
  };
}) satisfies PageLoad;
