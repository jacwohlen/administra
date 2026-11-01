import type { PageLoad } from './$types';
import { loadMemberProfile, loadMyMembers } from './memberProfile';
import { loadMemberExams } from './memberExams';

export const load: PageLoad = async ({ url, depends }) => {
  depends('app:club-exams');
  const myMembers = await loadMyMembers();
  // A parent's email is often on file for several children: ?m= picks one.
  const requested = Number(url.searchParams.get('m'));
  const selected = myMembers.find((m) => m.id === requested) ?? myMembers[0];

  const [profile, exams] = selected
    ? await Promise.all([loadMemberProfile(selected), loadMemberExams(selected)])
    : [null, null];

  return { myMembers, profile, exams };
};
