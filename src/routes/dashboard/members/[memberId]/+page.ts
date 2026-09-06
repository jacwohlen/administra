import type { PageLoad } from './$types';
import { error as err } from '@sveltejs/kit';
import type {
  Member,
  Badge,
  BadgeDefinition,
  BadgeProgress,
  GradeDefinition,
  MemberCurrentGrade,
  MemberGrade,
  MemberMedal,
  PastEvent
} from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { blobToURL } from 'image-resize-compress';
import dayjs from 'dayjs';

export const load = (async ({ params, depends }) => {
  // Register a dependency on this key, so we can invalidate it after edits
  depends('app:member:' + params.memberId);
  const { data: memberData, error: memberError } = await supabaseClient
    .from('members')
    .select()
    .eq('id', params.memberId)
    .single<Member>();

  if (memberError) {
    throw err(404, memberError);
  }
  if (memberData.img && memberData.imgUploaded) {
    memberData.imgUploaded = dayjs(memberData.imgUploaded); // cast to dayjs for easier handling

    const { data: avatarData, error: avatarError } = await supabaseClient.storage
      .from('avatars')
      .download(memberData.id + '_' + memberData.imgUploaded.valueOf() + '.webp');

    if (avatarData) {
      memberData.img = await blobToURL(avatarData);
    }
    if (avatarError) {
      throw err(404, avatarError);
    }
  }

  const memberId = parseInt(params.memberId);
  const today = dayjs().format('YYYY-MM-DD');

  const [
    badgeResult,
    progressResult,
    definitionResult,
    currentGradeResult,
    gradeHistoryResult,
    medalResult,
    gradeDefinitionResult,
    eventResult
  ] = await Promise.all([
    supabaseClient.rpc('get_member_badges', { p_member_id: memberId }),
    supabaseClient.rpc('get_member_badge_progress', { p_member_id: memberId }),
    supabaseClient.from('badge_definitions').select('*'),
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
    supabaseClient.from('grade_definitions').select('*'),
    supabaseClient
      .from('events')
      .select('id, title, date, section')
      .lte('date', today)
      .order('date', { ascending: false })
      .limit(100)
  ]);

  const list = <T>(result: { data: unknown }): T[] =>
    (Array.isArray(result.data) ? result.data : []) as T[];

  return {
    ...memberData,
    badges: list<Badge>(badgeResult),
    badgeProgress: list<BadgeProgress>(progressResult),
    badgeDefinitions: list<BadgeDefinition>(definitionResult),
    currentGrades: list<MemberCurrentGrade>(currentGradeResult),
    gradeHistory: list<MemberGrade>(gradeHistoryResult),
    medals: list<MemberMedal>(medalResult),
    gradeDefinitions: list<GradeDefinition>(gradeDefinitionResult),
    pastEvents: list<PastEvent>(eventResult)
  };
}) satisfies PageLoad;
