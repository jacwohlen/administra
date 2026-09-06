import type { PageLoad } from './$types';
import { error as err } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { TrialMember, Training } from '$lib/models';

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

  const memberIds = (trialMembers ?? []).map((m) => m.id);
  let assignments: { memberId: number; trainingId: number }[] = [];
  if (memberIds.length) {
    const { data: participantRows, error: partErr } = await supabaseClient
      .from('participants')
      .select('memberId, trainingId')
      .in('memberId', memberIds);
    if (partErr) throw err(404, partErr);
    assignments = participantRows ?? [];
  }

  return {
    trialMembers: trialMembers ?? [],
    trainings: trainings ?? [],
    assignments
  };
}) satisfies PageLoad;
