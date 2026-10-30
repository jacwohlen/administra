import type { Dayjs } from 'dayjs';

export type TrainerRole = 'attendee' | 'main_trainer' | 'assistant';

export type UserStatus = 'pending' | 'approved' | 'disabled';
export type UserRole = 'member' | 'viewer' | 'trainer' | 'admin';
/** Q-Prüfungen on top of a staff role: examiners grade, the TK (manager) also runs exam days and programs */
export type ExamRole = 'examiner' | 'manager';

export interface UserProfile {
  user_id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  status: UserStatus;
  role: UserRole;
  exam_role?: ExamRole | null;
  member_id?: number;
  approved_at?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

/** A row of the member directory (get_member_directory): what every club member may see */
export interface DirectoryMember {
  id: number;
  firstname: string;
  lastname: string;
  /** Small thumbnail as data URL */
  img?: string | null;
  imgUploaded?: string | null;
  sections: string[];
  /** One of the signed-in account's own members */
  isMine: boolean;
}

/** Contact details only the member themselves (and staff) may read */
export interface PrivateDetails {
  birthday?: string | null;
  mobile?: string | null;
  email?: string | null;
}

/** Grades, medals and badges shown on every member profile */
export interface MemberAchievements {
  badges: Badge[];
  /** null when not shown: other members' progress is attendance (club area) */
  badgeProgress: BadgeProgress[] | null;
  badgeDefinitions: BadgeDefinition[];
  currentGrades: MemberCurrentGrade[];
  gradeHistory: MemberGrade[];
  medals: MemberMedal[];
  gradeDefinitions: GradeDefinition[];
}

/** members.membership_status, derived from the labels in the database */
export type MembershipStatus = 'trial' | 'active' | 'passive' | 'non_member' | 'left';

/**
 * Why a member record does or does not let its account in
 * (member_access_status() in SQL): the status, or 'trial' / 'archived' for
 * an active or passive record that does not count
 */
export type MemberAccessStatus = MembershipStatus | 'archived';

/**
 * my_access(): whether the signed-in account may use Adsumus now
 * (is_approved_user(), the check RLS uses) and the reason per member record
 */
export interface MyAccess {
  has_access: boolean;
  member_statuses: MemberAccessStatus[];
}

/**
 * member_access_report(): a member account (approved or waiting) none of
 * whose member records is an active or passive membership
 */
export interface MemberAccessReportRow {
  user_id: string;
  email: string;
  full_name: string | null;
  member_ids: number[];
  statuses: MemberAccessStatus[];
}

/** Rows of one reference a merge moved to the kept member, folded into its own, or removed */
export interface MergeCount {
  moved: number;
  merged: number;
  removed?: number;
}

/**
 * A contact field of the kept member after a merge: 'same' (nothing to take
 * over), 'from_drop', 'kept_differs' (both had one), or not copied because
 * the kept member is in Webling or the value came from the trial form
 */
export type MergeFieldDecision =
  'same' | 'from_drop' | 'kept_differs' | 'not_copied_provider' | 'not_copied_trial';

/** A row both members had and which one stayed ('keep' or 'drop': whose row it was) */
export type MergeConflict =
  | {
      ref: 'member_grades.memberId';
      section: string;
      grade: string;
      kept: 'keep' | 'drop';
      /** 'exam': the grade a Q-Prüfung recorded stays */
      reason: 'exam' | 'keep';
    }
  | {
      ref: 'member_medals.memberId';
      competition: string;
      date: string;
      keptMedal: string;
      droppedMedal: string;
      kept: 'keep' | 'drop';
    }
  | {
      ref: 'exam_candidates.member_id';
      title: string;
      date: string;
      kept: 'keep' | 'drop';
      /** 'sheet': the one with a started exam sheet stays */
      reason: 'sheet' | 'status';
      /** The registration removed, as it was (the one that stays has its notes too) */
      removed: {
        status: string;
        grade: string;
        trainer: string | null;
        note: string | null;
        staffNote: string | null;
      };
    };

/**
 * An account linked to either member or matching either e-mail: whether it
 * gets in (is_approved_user) and finds the person (my_member_ids: approved,
 * the link or the e-mail of a row without trial label, for a member account
 * only a record that counts) before and after the merge
 */
export interface MergeAccount {
  userId: string;
  email: string | null;
  role: UserRole;
  before: boolean;
  after: boolean;
  findsBefore: boolean;
  findsAfter: boolean;
}

/**
 * merge_members() / merge_members_preview(): what moves from the dropped to
 * the kept member, per reference ('logs.memberId', … see
 * merge_member_references() in SQL), and what happens to the kept row.
 */
export interface MemberMergeResult {
  keep: number;
  drop: number;
  keepInProvider: boolean;
  /** membership_status of the kept member before and after */
  status: { before: MembershipStatus | null; after: MembershipStatus | null };
  moved: Record<string, MergeCount>;
  conflicts: MergeConflict[];
  fields: {
    birthday: MergeFieldDecision;
    mobile: MergeFieldDecision;
    email: MergeFieldDecision;
    notes: 'same' | 'joined';
    photo: 'none' | 'kept' | 'from_drop' | 'kept_both';
    /** imgUploaded of the dropped member's photo: its file is avatars/<drop>_<ms>.webp */
    dropPhotoUploaded: string | null;
    archived: 'not_archived' | 'archived' | 'unarchived';
    labelsNotCarried: string[];
    trial: 'none' | 'keep' | 'from_drop';
    trialStatus: string | null;
  };
  accounts: MergeAccount[];
  warnings: (string | { code: string; accounts?: number })[];
  /** Badges of the kept member as 'badgeId:season:context', after recomputing */
  badges: { added: string[]; removed: string[]; othersChanged: number };
  /** member_merges.id, only after a merge */
  mergeId?: number;
}

export interface Member {
  id: string;
  membership_status?: MembershipStatus;
  firstname: string;
  lastname: string;
  birthday?: string;
  mobile?: string;
  email?: string;
  notes?: string;
  trialSection?: string;
  trialRegisteredAt?: string;
  labels?: string[];
  img?: string;
  imgUploaded?: string | Dayjs;
  /** Archived trial candidates are hidden from member lists and searches. */
  archivedAt?: string | null;
}

export interface Training {
  id: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  weekday: string;
  section: string;
  ageFrom?: number;
  ageTo?: number;
  /** Member who usually leads the training; empty when the trainers rotate. */
  mainTrainerId?: number | null;
  /** Embedded where loaded with `mainTrainer:members!trainings_main_trainer_id_fkey(...)`. */
  mainTrainer?: TrainerContact | null;
  participants: Member[];
}

/** A training's main trainer, as named to trial candidates. */
export interface TrainerContact {
  id: number;
  firstname: string;
  lastname: string;
  mobile?: string | null;
  email?: string | null;
}

/** A trial candidate's training, with the first session picked when it was assigned. */
export type AssignedTraining = Training & { startDate: string | null };

/** Where a trial candidate stands in the club's intake process (members."trialStatus"). */
export type TrialStatus = 'new' | 'waitlist' | 'assigned' | 'cancelled';

export interface TrialMember {
  id: number;
  firstname: string;
  lastname: string;
  birthday?: string;
  email?: string;
  mobile?: string;
  notes?: string;
  labels: string[];
  trialSection?: string;
  trialRegisteredAt?: string;
  attendedCount: number;
  trialStatus: TrialStatus;
  trialStatusChangedAt?: string;
  /** Language the candidate registered in; mails go out in it. */
  trialLocale?: 'de' | 'en' | null;
  /** Key of the candidate's public status page, /probetraining/status/<token>. */
  trialToken?: string | null;
  /** Cancelled through the status page rather than by staff. */
  trialSelfCancelled?: boolean;
  /** Date (YYYY-MM-DD) of the last attended session, null when never attended. */
  lastAttendedAt?: string | null;
  /** Set when the candidate was archived: hidden from member lists and searches. */
  archivedAt?: string | null;
}

/** Row of trial_emails: one mail to a trial candidate. */
export interface TrialEmail {
  id: number;
  member_id: number;
  kind: 'welcome' | 'waitlist' | 'assigned';
  to_email: string;
  subject: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** Row of view_training_activity: how full a training is. */
export interface TrainingActivity {
  trainingId: number;
  /** Distinct attendees over the training's last 8 sessions */
  activeCount: number;
  participantCount: number;
  /** Trial candidates on the participant list */
  trialCount: number;
}

export interface Log {
  date: string;
  trainingId: Training;
  memberId: Member;
  trainerRole: TrainerRole;
}

export interface Athletes {
  section: string;
  memberId: number;
  lastname: string;
  firstname: string;
  count: number;
  rank: number;
}

export interface LessonPlan {
  id: string;
  trainingId: number;
  date: string;
  title?: string;
  content?: string; // Optional for backward compatibility
  fileName?: string; // Original filename
  filePath?: string; // Storage path
  fileType?: string; // MIME type
  fileSize?: number; // File size in bytes
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  date: string;
  /** Last day of a multi-day event (inclusive), null for one day */
  date_to?: string | null;
  /** The whole day (or days): no times */
  all_day?: boolean;
  timeFrom?: string;
  timeTo?: string;
  location?: string;
  section: string;
  maxParticipants?: number;
  registrationDeadline?: string;
  createdAt: string;
  updatedAt: string;
  participants?: Member[];
}

/**
 * The provider an event comes from while the provider still has it
 * (event_links without gone_at, docs/INTEGRATIONS.md). Its fields are the
 * provider's: the database refuses edits and deletes (MANAGED_BY_PROVIDER).
 */
export interface EventLink {
  connection: string;
  /** The event in the provider (Webling portal link) */
  url: string | null;
}

export interface EventParticipant {
  id: string;
  eventId: string;
  memberId: string;
  registeredAt: string;
  attendanceStatus: 'registered' | 'attended' | 'absent' | 'cancelled';
  notes?: string;
}

export interface EventLog {
  id: number;
  eventId: string;
  memberId: string;
  attendedAt: string;
  isOrganizer: boolean;
  notes?: string;
}

export interface EventStats {
  section: string;
  memberId: number;
  lastname: string;
  firstname: string;
  count: number;
  rank: number;
}

export interface Badge {
  badgeId: string;
  category: string;
  emoji: string;
  sortOrder: number;
  earnedAt: string;
  /** Calendar year for season badges, 0 for lifetime badges */
  season: number;
  /** Section for per-section season badges, empty otherwise */
  context: string;
}

export interface BadgeDefinition {
  id: string;
  category: string;
  emoji: string;
  threshold: number | null;
  sortOrder: number;
  scope: string;
}

export interface BadgeLeaderboardEntry {
  memberId: number;
  lastname: string;
  firstname: string;
  badgeCount: number;
  topBadgeEmoji: string;
}

export interface MemberTopBadge {
  memberId: number;
  emoji: string;
  badgeId: string;
}

export interface BadgeProgress {
  category: string;
  current_count: number;
  next_badge_id: string;
  next_badge_emoji: string;
  next_threshold: number;
}

export interface RecentAchievement {
  memberId: number;
  lastname: string;
  firstname: string;
  badgeId: string;
  emoji: string;
  category: string;
  earnedAt: string;
  season: number;
  context: string;
}

export type Medal = 'gold' | 'silver' | 'bronze';

/** One rung of a section's grade ladder */
export interface GradeDefinition {
  section: string;
  grade: string;
  gradeRank: number;
  beltColor: string;
  /** Second colour of a two-coloured (half) belt */
  beltColor2?: string | null;
  isDan: boolean;
}

/** One grading a member passed */
export interface MemberGrade {
  id: number;
  memberId: number;
  section: string;
  grade: string;
  examDate: string;
  note?: string | null;
}

/** A member's current (highest) grade in one section */
export interface MemberCurrentGrade {
  section: string;
  grade: string;
  gradeRank: number;
  beltColor: string;
  beltColor2?: string | null;
  isDan: boolean;
  examDate: string;
  nextGrade: string | null;
}

/** Current grade per member and section, for list views */
export interface MemberSectionGrade {
  memberId: number;
  section: string;
  grade: string;
  gradeRank: number;
  beltColor: string;
  beltColor2?: string | null;
  isDan: boolean;
}

/** One task on an exam sheet, e.g. a throw */
export interface ExamItem {
  /** Stable within the program; scores are stored under it */
  key: string;
  name: string;
  description?: string;
  /** 2: left and right are scored separately, 1: one score */
  sides: 1 | 2;
}

/** A block of an exam sheet, e.g. Nage-waza */
export interface ExamPart {
  key: string;
  title: string;
  subtitle?: string;
  /** Points needed in this part, on top of the overall minimum */
  minPoints?: number;
  items: ExamItem[];
}

/** Row of exam_programs: what a candidate shows for a grade */
export interface ExamProgram {
  id: number;
  section: string;
  grade: string;
  /** Belt name, e.g. "Gelbgurt" */
  title: string;
  min_points: number;
  parts: ExamPart[];
  updated_at: string;
}

/** Row of exams: an exam day */
export interface Exam {
  id: number;
  section: string;
  title: string;
  date: string;
  location?: string | null;
  registration_deadline?: string | null;
  /** Shown to members with the registration (fee, what to bring) */
  notes?: string | null;
  event_id?: number | null;
  created_at: string;
}

export type ExamCandidateStatus = 'registered' | 'invited' | 'withdrawn';
export type ExamResult = 'passed' | 'failed';

/** Row of exam_examiners */
export interface ExamExaminer {
  candidate_id: number;
  user_id: string;
  name: string;
}

/** Row of exam_candidates: one member on one exam day */
export interface ExamCandidate {
  id: number;
  exam_id: number;
  member_id: number;
  section: string;
  grade: string;
  belt_length_cm?: number | null;
  trainer?: string | null;
  /** The member's remark at registration; the member sees it */
  note?: string | null;
  /** Internal note of trainers and the TK; never shown to the member */
  staff_note?: string | null;
  status: ExamCandidateStatus;
  group_name?: string | null;
  call_time?: string | null;
  /** Snapshot of the program, taken when grading starts (only loaded for sheets) */
  program?: ExamPart[] | null;
  min_points: number | null;
  started_at: string | null;
  result: ExamResult | null;
  /** Computed by the database when the result is set */
  total_points: number | null;
  max_points: number | null;
  completed_at: string | null;
  registered_at: string;
  /** Embedded where loaded with `member:members(...)` */
  member?: ExamCandidateMember;
  /** Embedded where loaded with `examiners:exam_examiners(...)` */
  examiners?: ExamExaminer[];
}

export interface ExamCandidateMember {
  id: number;
  firstname: string;
  lastname: string;
  birthday?: string | null;
  img?: string | null;
}

/** Row of exam_scores: the points for one item (or the feedback, FEEDBACK_KEY) */
export interface ExamScore {
  candidate_id: number;
  item_key: string;
  left_points: number | null;
  right_points: number | null;
  points: number | null;
  note: string | null;
}

export interface MemberMedal {
  id: number;
  memberId: number;
  eventId: number | null;
  competition: string;
  date: string;
  section?: string | null;
  medal: Medal;
  category?: string | null;
}

/** A past event a medal can be linked to */
export interface PastEvent {
  id: number;
  title: string;
  date: string;
  section: string | null;
}

export interface MedalCounts {
  memberId: number;
  gold: number;
  silver: number;
  bronze: number;
}

export interface TrainerTrackingRecord {
  date: string;
  trainingId: number;
  trainingTitle: string;
  section: string;
  memberId: number;
  lastname: string;
  firstname: string;
  trainerRole: TrainerRole;
  attendeeCount: number;
}

/** Row of training_plan_sessions: the TK's plan for one training on one date */
export interface TrainingPlanSession {
  id: number;
  training_id: number;
  date: string;
  /** Member who leads the training; null while open */
  trainer_id: number | null;
  topic: string | null;
  notes: string | null;
  /** null follows the breaks, true drops the training, false holds it when the dojo is closed */
  cancelled: boolean | null;
  updated_at: string;
}

/** Row of training_plan_breaks: holidays, or days the dojo is closed */
export interface TrainingPlanBreak {
  id: number;
  title: string;
  date_from: string;
  date_to: string;
  /** Dojo closed: planned trainings are dropped. False: holidays, the adults train on */
  cancels_training: boolean;
  /**
   * The provider the holiday comes from (integration_connections, e.g.
   * Webling's "Ferien und Feiertage"), null for the TK's own: such a
   * holiday is read-only but for "Dojo zu"
   */
  connection?: string | null;
}
