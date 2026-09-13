-- Performance: RLS init-plan rewrite + missing indexes on hot tables.
--
-- 1. RLS policies from 20260906130000_add_user_management.sql call
--    is_approved_user()/is_writer()/is_admin() directly. These are
--    SECURITY DEFINER functions, so Postgres cannot inline them and
--    evaluates them once PER ROW — on logs (~18k rows) that is ~18k
--    subqueries against user_profiles for a single select. Wrapping the
--    call in a scalar subselect turns it into an InitPlan that runs once
--    per statement (see Supabase RLS performance recommendations).
--
-- 2. logs lost its useful access paths when the primary key became
--    (date, "trainingId", "memberId"): queries by "trainingId" (checklist,
--    streaks, stats) and by "memberId" (member attendance log, badges)
--    cannot use an index. Both are also unindexed foreign keys flagged by
--    the Supabase performance advisor, as are participants."memberId" and
--    lesson_plans.created_by.

-----------------
-- 1. Rewrite RLS policies to evaluate role checks once per statement
-----------------

-- user_profiles
ALTER POLICY user_profiles_select_own   ON public.user_profiles USING (user_id = (SELECT auth.uid()));
ALTER POLICY user_profiles_select_admin ON public.user_profiles USING ((SELECT public.is_admin()));
ALTER POLICY user_profiles_update_admin ON public.user_profiles
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- members
ALTER POLICY members_read   ON public.members USING ((SELECT public.is_approved_user()));
ALTER POLICY members_insert ON public.members WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY members_update ON public.members
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY members_delete ON public.members USING ((SELECT public.is_writer()));

-- trainings
ALTER POLICY trainings_read   ON public.trainings USING ((SELECT public.is_approved_user()));
ALTER POLICY trainings_insert ON public.trainings WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY trainings_update ON public.trainings
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY trainings_delete ON public.trainings USING ((SELECT public.is_writer()));

-- logs
ALTER POLICY logs_read   ON public.logs USING ((SELECT public.is_approved_user()));
ALTER POLICY logs_insert ON public.logs WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY logs_update ON public.logs
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY logs_delete ON public.logs USING ((SELECT public.is_writer()));

-- participants
ALTER POLICY participants_read   ON public.participants USING ((SELECT public.is_approved_user()));
ALTER POLICY participants_insert ON public.participants WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY participants_update ON public.participants
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY participants_delete ON public.participants USING ((SELECT public.is_writer()));

-- lesson_plans
ALTER POLICY lesson_plans_read   ON public.lesson_plans USING ((SELECT public.is_approved_user()));
ALTER POLICY lesson_plans_insert ON public.lesson_plans WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY lesson_plans_update ON public.lesson_plans
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY lesson_plans_delete ON public.lesson_plans USING ((SELECT public.is_writer()));

-- events
ALTER POLICY events_read   ON public.events USING ((SELECT public.is_approved_user()));
ALTER POLICY events_insert ON public.events WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY events_update ON public.events
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY events_delete ON public.events USING ((SELECT public.is_writer()));

-- event_participants
ALTER POLICY event_participants_read   ON public.event_participants USING ((SELECT public.is_approved_user()));
ALTER POLICY event_participants_insert ON public.event_participants WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY event_participants_update ON public.event_participants
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY event_participants_delete ON public.event_participants USING ((SELECT public.is_writer()));

-- event_logs
ALTER POLICY event_logs_read   ON public.event_logs USING ((SELECT public.is_approved_user()));
ALTER POLICY event_logs_insert ON public.event_logs WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY event_logs_update ON public.event_logs
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY event_logs_delete ON public.event_logs USING ((SELECT public.is_writer()));

-- badges
ALTER POLICY badge_definitions_read ON public.badge_definitions USING ((SELECT public.is_approved_user()));
ALTER POLICY member_badges_read     ON public.member_badges     USING ((SELECT public.is_approved_user()));
ALTER POLICY member_badges_insert   ON public.member_badges     WITH CHECK ((SELECT public.is_writer()));
ALTER POLICY member_badges_delete   ON public.member_badges     USING ((SELECT public.is_writer()));

-- storage: avatars
ALTER POLICY avatars_read   ON storage.objects USING (bucket_id = 'avatars' AND (SELECT public.is_approved_user()));
ALTER POLICY avatars_insert ON storage.objects WITH CHECK (bucket_id = 'avatars' AND (SELECT public.is_writer()));
ALTER POLICY avatars_update ON storage.objects
  USING (bucket_id = 'avatars' AND (SELECT public.is_writer()))
  WITH CHECK (bucket_id = 'avatars' AND (SELECT public.is_writer()));
ALTER POLICY avatars_delete ON storage.objects USING (bucket_id = 'avatars' AND (SELECT public.is_writer()));

-- storage: lesson-plans
ALTER POLICY lesson_plans_storage_read   ON storage.objects USING (bucket_id = 'lesson-plans' AND (SELECT public.is_approved_user()));
ALTER POLICY lesson_plans_storage_insert ON storage.objects WITH CHECK (bucket_id = 'lesson-plans' AND (SELECT public.is_writer()));
ALTER POLICY lesson_plans_storage_update ON storage.objects
  USING (bucket_id = 'lesson-plans' AND (SELECT public.is_writer()))
  WITH CHECK (bucket_id = 'lesson-plans' AND (SELECT public.is_writer()));
ALTER POLICY lesson_plans_storage_delete ON storage.objects USING (bucket_id = 'lesson-plans' AND (SELECT public.is_writer()));

-----------------
-- 2. Indexes for the hot query paths on logs (and advisor-flagged FKs)
-----------------

-- Checklist, streaks and per-training stats filter logs by "trainingId"
-- (often together with date); also covers logs_training_id_fkey.
CREATE INDEX IF NOT EXISTS idx_logs_training_date ON public.logs ("trainingId", date);

-- Member attendance log, badge/streak computations filter logs by
-- "memberId" (often ordered/ranged by date); also covers logs_member_id_fkey.
CREATE INDEX IF NOT EXISTS idx_logs_member_date ON public.logs ("memberId", date);

-- Advisor-flagged unindexed foreign keys.
CREATE INDEX IF NOT EXISTS idx_participants_member ON public.participants ("memberId");
CREATE INDEX IF NOT EXISTS idx_lesson_plans_created_by ON public.lesson_plans (created_by);
