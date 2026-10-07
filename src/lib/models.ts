import type { Dayjs } from 'dayjs';

export type TrainerRole = 'attendee' | 'main_trainer' | 'assistant';

export type UserStatus = 'pending' | 'approved' | 'disabled';
export type UserRole = 'member' | 'viewer' | 'trainer' | 'admin';

export interface UserProfile {
  user_id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  status: UserStatus;
  role: UserRole;
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
  badgeProgress: BadgeProgress[];
  badgeDefinitions: BadgeDefinition[];
  currentGrades: MemberCurrentGrade[];
  gradeHistory: MemberGrade[];
  medals: MemberMedal[];
  gradeDefinitions: GradeDefinition[];
}

export interface Member {
  id: string;
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
  isDan: boolean;
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
