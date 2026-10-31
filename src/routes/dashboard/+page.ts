import dayjs from 'dayjs';
import utils from '$lib/utils';
import { loadDayOverview } from './dayOverview';
import type { PageLoad } from './$types';

// Today's trainings and events, asked while the layouts still load (the page
// would otherwise only ask once it is shown, docs/PERFORMANCE.md)
export const load: PageLoad = async () => {
  const date = utils.getMostRecentDateByWeekday(dayjs().day());
  return { date: date.format('YYYY-MM-DD'), day: await loadDayOverview(date) };
};
