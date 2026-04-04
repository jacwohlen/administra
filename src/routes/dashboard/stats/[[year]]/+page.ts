import { supabaseClient } from '$lib/supabase';
import type { PageLoad } from './$types';
import { error as err } from '@sveltejs/kit';
import type { Athletes } from '$lib/models';
import { groupBySection, resolveYearParam } from '$lib/statsUtils';

export const load = (async ({ params }) => {
  const { year, yearmode } = resolveYearParam(params.year);

  async function getTopAthletes(mode: 'YEAR' | 'ALL', y: number | '') {
    if (mode === 'ALL') y = '';
    const { error, data } = await supabaseClient
      .rpc('get_top_athletes_by_section', {
        year: y
      })
      .returns<Athletes[]>();

    if (error) {
      throw err(404, error);
    }

    return groupBySection(data);
  }

  return {
    yearmode,
    year,
    topAthletes: await getTopAthletes(yearmode, year)
  };
}) satisfies PageLoad;
