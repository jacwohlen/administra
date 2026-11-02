import { error as err } from '@sveltejs/kit';
import type { Athletes } from '#lib/models.ts';
import { rpcRows } from '#lib/supabase.ts';
import { resolveYearForRpc } from '#lib/statsUtils.ts';

export async function load({ params }) {
  const year = resolveYearForRpc(params.year);

  const category = params.category?.toLowerCase();
  switch (category) {
    case 'athletes': {
      const { error: athletesError, data: athletesData } = await rpcRows<Athletes>(
        'get_top_athletes_from_section',
        {
          sect: params.section,
          year: year
        }
      );

      if (athletesError) {
        throw err(404, athletesError.message);
      }
      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: athletesData
      };
    }

    case 'trainers': {
      const { error: trainersError, data: trainersData } = await rpcRows<Athletes>(
        'get_top_trainers_from_section',
        {
          sect: params.section,
          year: year
        }
      );

      if (trainersError) {
        throw err(404, trainersError.message);
      }

      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: trainersData
      };
    }

    case 'events': {
      const { error: eventsError, data: eventsData } = await rpcRows<Athletes>(
        'get_top_event_participants',
        {
          year_param: year || null,
          section_param: params.section
        }
      );

      if (eventsError) {
        throw err(404, eventsError.message);
      }

      return {
        year: params.year,
        section: params.section,
        category: params.category,
        athletes: eventsData
      };
    }

    case 'coaches': {
      const { error: coachesError, data: coachesData } = await rpcRows<Athletes>(
        'get_top_event_coaches_from_section',
        {
          sect: params.section,
          year: year
        }
      );

      if (coachesError) {
        throw err(404, coachesError.message);
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
