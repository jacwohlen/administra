import type { PageLoad } from './$types';
import type { MMember } from './types';
import type { TrainerRole } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';

interface ChecklistMemberData {
  memberId: string;
  firstname: string;
  lastname: string;
  labels: string[];
  img: string;
  date: string | null;
  trainerRole: TrainerRole;
}

export const load = (async ({ params }) => {
  async function getMembersWithPresentStatus(): Promise<MMember[]> {
    const { error, data } = await supabaseClient
      .rpc('get_checklist_members', {
        d: params.date,
        tid: params.trainingId
      })
      .order('lastname', { ascending: true })
      .order('firstname', { ascending: true });

    if (error) {
      throw err(404, error);
    }
    return data.map(
      (item: ChecklistMemberData) =>
        ({
          id: item.memberId,
          firstname: item.firstname,
          lastname: item.lastname,
          labels: item.labels,
          img: item.img,
          isPresent: item.date ? true : false,
          trainerRole: item.trainerRole || 'attendee'
        } as MMember)
    );
  }

  return {
    trainingId: params.trainingId,
    date: params.date,
    participants: await getMembersWithPresentStatus()
  };
}) satisfies PageLoad;
