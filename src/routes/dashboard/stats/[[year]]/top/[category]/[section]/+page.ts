import { error as err } from '@sveltejs/kit';
import type { Athletes } from '$lib/models';
import { supabaseClient } from '$lib/supabase';

export async function load({ params }) {
  let year: string;

  if (!params.year || params.year === 'ALL') {
    year = '';
  } else {
    year = params.year;
  }

  const category = params.category?.toLowerCase();
  switch (category) {
    case 'athletes': {
      const { error: athletesError, data: athletesData } = await supabaseClient
        .rpc('get_top_athletes_from_section', {
          sect: params.section,
          year: year
        })
        .returns<Athletes[]>();

      if (athletesError) {
        throw err(404, athletesError);
      }
      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: athletesData
      };
    }

    case 'trainers': {
      const { error: trainersError, data: trainersData } = await supabaseClient
        .rpc('get_top_trainers_from_section', {
          sect: params.section,
          year: year
        })
        .returns<Athletes[]>();

      if (trainersError) {
        throw err(404, trainersError);
      }

      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: trainersData
      };
    }

    case 'events': {
      const { error: eventsError, data: eventsData } = await supabaseClient
        .rpc('get_top_event_participants', {
          year_param: year || null,
          section_param: params.section
        })
        .returns<Athletes[]>();

      if (eventsError) {
        throw err(404, eventsError);
      }

      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: eventsData
      };
    }

    case 'coaches': {
      const { error: coachesError, data: coachesData } = await supabaseClient
        .rpc('get_top_event_coaches_from_section', {
          sect: params.section,
          year: year
        })
        .returns<Athletes[]>();

      if (coachesError) {
        throw err(404, coachesError);
      }

      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: coachesData
      };
    }

    default:
      throw err(404, 'No valid Category');
  }
}
