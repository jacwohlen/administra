import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Member } from '$lib/models';

export async function load({ params, parent }) {
  const { event } = await parent();

  // Get event participants with member details
  const { error: participantsError, data: participantsData } = await supabaseClient
    .from('event_participants')
    .select(
      `
      *,
      members:memberId (
        id,
        firstname,
        lastname,
        labels,
        img
      )
    `
    )
    .eq('eventId', params.eventId);

  if (participantsError) {
    throw err(404, participantsError);
  }

  // Get event logs (attendance records)
  const { error: logsError, data: logsData } = await supabaseClient
    .from('event_logs')
    .select(
      `
      *,
      members:memberId (
        id,
        firstname,
        lastname
      )
    `
    )
    .eq('eventId', params.eventId);

  if (logsError) {
    throw err(404, logsError);
  }

  // Get all members for adding new participants
  const { error: membersError, data: membersData } = await supabaseClient
    .from('members')
    .select('*')
    .order('lastname', { ascending: true });

  if (membersError) {
    throw err(404, membersError);
  }

  return {
    event,
    participants: participantsData || [],
    logs: logsData || [],
    allMembers: (membersData as Member[]) || []
  };
}
