import type {
  Badge,
  BadgeDefinition,
  BadgeProgress,
  DirectoryMember,
  GradeDefinition,
  MemberCurrentGrade,
  MemberGrade,
  MemberMedal
} from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { getBadgeDefinitions, getGradeDefinitions } from '$lib/referenceData';
import { blobToDataUrl } from '$lib/imageUtils';
import dayjs from 'dayjs';

/** Contact details only the member themselves (and staff) may read */
export interface PrivateDetails {
  birthday?: string | null;
  mobile?: string | null;
  email?: string | null;
}

export interface MemberProfileData {
  member: DirectoryMember;
  /** Full-size photo if one was uploaded, else the thumbnail */
  photo: string | null;
  details: PrivateDetails | null;
  badges: Badge[];
  badgeProgress: BadgeProgress[];
  badgeDefinitions: BadgeDefinition[];
  currentGrades: MemberCurrentGrade[];
  gradeHistory: MemberGrade[];
  medals: MemberMedal[];
  gradeDefinitions: GradeDefinition[];
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
    .download(member.id + '_' + dayjs(member.imgUploaded).valueOf() + '.webp');
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
 */
export async function loadMemberProfile(memberId: number): Promise<MemberProfileData | null> {
  const { data: member } = await supabaseClient
    .rpc('get_member_directory')
    .eq('id', memberId)
    .maybeSingle<DirectoryMember>();
  if (!member) return null;

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
    supabaseClient.rpc('get_member_badge_progress', { p_member_id: memberId }),
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
    badgeProgress: list<BadgeProgress>(progressResult),
    badgeDefinitions,
    currentGrades: list<MemberCurrentGrade>(currentGradeResult),
    gradeHistory: list<MemberGrade>(gradeHistoryResult),
    medals: list<MemberMedal>(medalResult),
    gradeDefinitions
  };
}
