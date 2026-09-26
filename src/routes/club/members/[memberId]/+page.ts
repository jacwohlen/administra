import { error } from '@sveltejs/kit';
import { loadMemberProfile } from '../../memberProfile';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  const profile = await loadMemberProfile(Number(params.memberId));
  if (!profile) error(404, 'Member not found');
  return { profile };
};
