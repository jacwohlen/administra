import type {
  Badge,
  BadgeProgress,
  DirectoryMember,
  MemberAchievements,
  MemberCurrentGrade,
  MemberGrade,
  MemberMedal,
  PrivateDetails
} from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { getBadgeDefinitions, getGradeDefinitions } from '$lib/referenceData';
import { blobToDataUrl } from '$lib/imageUtils';
import { avatarPath } from '$lib/memberMerge';

export interface MemberProfileData extends MemberAchievements {
  member: DirectoryMember;
  /** Full-size photo if one was uploaded, else the thumbnail */
  photo: string | null;
  details: PrivateDetails | null;
}

/** The signed-in account's own members (a parent may have several). */
export async function loadMyMembers(): Promise<DirectoryMember[]> {
  const { data } = await supabaseClient.rpc('get_member_directory').eq('isMine', true);
  return (data ?? []) as DirectoryMember[];
}

async function loadPhoto(member: DirectoryMember): Promise<string | null> {
  if (!member.img || !member.imgUploaded) return member.img ?? null;
  const { data } = await supabaseClient.storage
    .from('avatars')
    .download(avatarPath(member.id, member.imgUploaded));
  return data ? await blobToDataUrl(data) : member.img;
}

async function loadDetails(member: DirectoryMember): Promise<PrivateDetails | null> {
  if (!member.isMine) return null;
  const { data } = await supabaseClient
    .from('members')
    .select('birthday, mobile, email')
    .eq('id', member.id)
    .maybeSingle<PrivateDetails>();
  return data;
}

/**
 * Everything the club area shows about one member. Returns null when the
 * member is not in the directory (inactive, trial candidate or unknown id).
 * Pass the directory row when the caller already has it (the account's own
 * members): that saves asking the directory for it a second time.
 */
export async function loadMemberProfile(
  memberOrId: number | DirectoryMember
): Promise<MemberProfileData | null> {
  const member =
    typeof memberOrId === 'number'
      ? (
          await supabaseClient
            .rpc('get_member_directory')
            .eq('id', memberOrId)
            .maybeSingle<DirectoryMember>()
        ).data
      : memberOrId;
  if (!member) return null;
  const memberId = member.id;

  const [
    photo,
    details,
    badgeResult,
    progressResult,
    badgeDefinitions,
    currentGradeResult,
    gradeHistoryResult,
    medalResult,
    gradeDefinitions
  ] = await Promise.all([
    loadPhoto(member),
    loadDetails(member),
    supabaseClient.rpc('get_member_badges', { p_member_id: memberId }),
    // Training, event and streak counts are attendance: own members only
    // (get_member_badge_progress refuses the others)
    member.isMine
      ? supabaseClient.rpc('get_member_badge_progress', { p_member_id: memberId })
      : null,
    getBadgeDefinitions(),
    supabaseClient.rpc('get_member_current_grades', { p_member_id: memberId }),
    supabaseClient
      .from('member_grades')
      .select('*')
      .eq('memberId', memberId)
      .order('examDate', { ascending: false }),
    supabaseClient
      .from('member_medals')
      .select('*')
      .eq('memberId', memberId)
      .order('date', { ascending: false }),
    getGradeDefinitions()
  ]);

  const list = <T>(result: { data: unknown }): T[] =>
    (Array.isArray(result.data) ? result.data : []) as T[];

  return {
    member,
    photo,
    details,
    badges: list<Badge>(badgeResult),
    badgeProgress: progressResult ? list<BadgeProgress>(progressResult) : null,
    badgeDefinitions,
    currentGrades: list<MemberCurrentGrade>(currentGradeResult),
    gradeHistory: list<MemberGrade>(gradeHistoryResult),
    medals: list<MemberMedal>(medalResult),
    gradeDefinitions
  };
}
