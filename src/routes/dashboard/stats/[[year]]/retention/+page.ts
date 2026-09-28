import { redirect } from '@sveltejs/kit';
import { resolveYearParam } from '$lib/statsUtils';
import type { PageLoad } from './$types';

export const load = (({ params }) => {
  const { year, yearmode } = resolveYearParam(params.year);
  // Retention compares two consecutive years, so it needs a single year
  if (yearmode === 'ALL') redirect(307, `/dashboard/stats/${year}/retention`);
  return { year };
}) satisfies PageLoad;
