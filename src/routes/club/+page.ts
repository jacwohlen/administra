import type { PageLoad } from './$types';
import { loadMemberProfile, loadMyMembers } from './memberProfile';

export const load: PageLoad = async ({ url }) => {
  const myMembers = await loadMyMembers();
  // A parent's email is often on file for several children: ?m= picks one.
  const requested = Number(url.searchParams.get('m'));
  const selected = myMembers.find((m) => m.id === requested) ?? myMembers[0];

  return {
    myMembers,
    profile: selected ? await loadMemberProfile(selected.id) : null
  };
};
