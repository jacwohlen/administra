import type { Dayjs } from 'dayjs';

export type TrainerRole = 'attendee' | 'main_trainer' | 'assistant';

export interface Member {
  id: string;
  firstname: string;
  lastname: string;
  birthday?: string;
  mobile?: string;
  labels?: string[];
  img?: string;
  imgUploaded?: string | Dayjs;
}

export interface Training {
  id: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  weekday: string;
  section: string;
  participants: Member[];
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
}

export interface NewBadge {
  badgeId: string;
  emoji: string;
  category: string;
  earnedAt: string;
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
