import type { DirectoryMember, Exam, ExamCandidate, ExamProgram } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import dayjs from 'dayjs';

export type ProgramLink = Pick<ExamProgram, 'id' | 'section' | 'grade' | 'title'>;
export type MemberRegistration = ExamCandidate & { exam: Exam | null };

export interface MemberExams {
  /** Exam days from today on, in the sections the member trains in */
  upcoming: Exam[];
  /** The member's registrations and results, newest first */
  registrations: MemberRegistration[];
  programs: ProgramLink[];
}

const REGISTRATION_COLUMNS =
  'id, exam_id, member_id, section, grade, belt_length_cm, note, status, group_name, call_time, ' +
  'started_at, result, total_points, max_points, completed_at, registered_at, exam:exams(*)';

/** What the club area shows about Q-Prüfungen on one of the account's own members. */
export async function loadMemberExams(member: DirectoryMember): Promise<MemberExams> {
  const today = dayjs().format('YYYY-MM-DD');
  const [examResult, registrationResult, programResult] = await Promise.all([
    supabaseClient.from('exams').select('*').gte('date', today).order('date').returns<Exam[]>(),
    supabaseClient
      .from('exam_candidates')
      .select(REGISTRATION_COLUMNS)
      .eq('member_id', member.id)
      .order('registered_at', { ascending: false })
      .returns<MemberRegistration[]>(),
    supabaseClient
      .from('exam_programs')
      .select('id, section, grade, title')
      .returns<ProgramLink[]>()
  ]);

  const exams = examResult.data ?? [];
  const registrations = registrationResult.data ?? [];
  return {
    // Members without recent attendance have no sections: show them every exam day
    upcoming: exams.filter(
      (e) =>
        member.sections.length === 0 ||
        member.sections.includes(e.section) ||
        registrations.some((r) => r.exam_id === e.id)
    ),
    registrations: registrations.sort((a, b) =>
      (b.exam?.date ?? '').localeCompare(a.exam?.date ?? '')
    ),
    programs: programResult.data ?? []
  };
}
