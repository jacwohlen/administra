import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Member, MemberMedal } from '$lib/models';

export async function load({ params, parent }) {
  const { event } = await parent();

  const [
    { error: participantsError, data: participantsData },
    { error: logsError, data: logsData },
    { data: medalsData },
    { error: membersError, data: membersData }
  ] = await Promise.all([
    // Event participants with member details
    supabaseClient
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
      .eq('eventId', params.eventId),
    // Event logs (attendance records)
    supabaseClient
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
      .eq('eventId', params.eventId),
    // Medals recorded for this event (tournament placements)
    supabaseClient.from('member_medals').select('*').eq('eventId', params.eventId),
    // All members for adding new participants
    supabaseClient.from('members').select('*').order('lastname', { ascending: true })
  ]);

  if (participantsError) {
    throw err(404, participantsError);
  }
  if (logsError) {
    throw err(404, logsError);
  }
  if (membersError) {
    throw err(404, membersError);
  }

  return {
    event,
    participants: participantsData || [],
    logs: logsData || [],
    medals: (medalsData as MemberMedal[]) || [],
    allMembers: (membersData as Member[]) || []
  };
}
