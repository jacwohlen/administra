import type { DirectoryMember, Exam, ExamCandidateStatus, ExamProgram } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import dayjs from 'dayjs';

/**
 * A registration as members see it (get_my_exam_registrations): status and
 * call-up, never the sheet or the result. A passed exam shows up as the new
 * grade on the profile.
 */
export interface MemberRegistration {
  id: number;
  exam_id: number;
  member_id: number;
  section: string;
  grade: string;
  belt_length_cm: number | null;
  note: string | null;
  status: ExamCandidateStatus;
  group_name: string | null;
  call_time: string | null;
  /** Grading has started: the registration can no longer change */
  started: boolean;
  registered_at: string;
}

export interface MemberExams {
  /** Exam days from today on, in the sections the member trains in */
  upcoming: Exam[];
  /** The member's registrations for those exam days */
  registrations: MemberRegistration[];
  /** Grades with a program (not the program), to suggest one that is examined */
  programGrades: Pick<ExamProgram, 'section' | 'grade'>[];
}

/** What the club area shows about Q-Prüfungen on one of the account's own members. */
export async function loadMemberExams(member: DirectoryMember): Promise<MemberExams> {
  const today = dayjs().format('YYYY-MM-DD');
  const [examResult, registrationResult, gradeResult] = await Promise.all([
    supabaseClient.from('exams').select('*').gte('date', today).order('date').returns<Exam[]>(),
    supabaseClient.rpc('get_my_exam_registrations').eq('member_id', member.id),
    supabaseClient.rpc('get_exam_program_grades')
  ]);

  const exams = examResult.data ?? [];
  const registrations = ((registrationResult.data ?? []) as MemberRegistration[]).filter((r) =>
    exams.some((e) => e.id === r.exam_id)
  );
  return {
    // Members without recent attendance have no sections: show them every exam day
    upcoming: exams.filter(
      (e) =>
        member.sections.length === 0 ||
        member.sections.includes(e.section) ||
        registrations.some((r) => r.exam_id === e.id)
    ),
    registrations,
    programGrades: (gradeResult.data ?? []) as MemberExams['programGrades']
  };
}
