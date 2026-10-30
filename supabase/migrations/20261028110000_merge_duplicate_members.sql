-- Phase 1c: merge a duplicate member into the record that stays
-- (docs/INTEGRATIONS.md, "Merging duplicates").
--
-- Duplicates come from a trial candidate (app row, label 'probetraining')
-- who later appears as a new Webling member, or from two app rows for one
-- person. Deleting one of them is not an option: the foreign keys to
-- members cascade or set null, which threw away grades, medals, badges and
-- event attendance in the old webling-sync/src/duplicates.py merge.
--
-- merge_members(keep, drop) moves every reference to the dropped member to
-- the kept one in one transaction, then deletes the dropped row:
--
--   * merge_member_references() is the reviewed list of every reference
--     and what happens to it. The merge refuses to start while a foreign
--     key to members exists that the list does not name, checks after
--     moving that nothing points at the dropped row any more, and
--     supabase/checks/merge_members.sql compares the list with the schema.
--   * merge_members_preview(keep, drop) runs the same code and rolls it
--     back: its counts are exactly what the merge will do.
--   * member_merges logs every merge: who, when, the dropped row as it was,
--     and what moved.
--
-- Only admins merge (a merge cannot be undone). Refused (P0001, message
-- prefix): SAME_MEMBER, MEMBER_NOT_FOUND, BOTH_IN_PROVIDER (merge in
-- Webling first), KEEP_PROVIDER_ROW (the row Webling has must stay, or the
-- next sync creates it again), ACCOUNT_CONFLICT (both linked to an
-- account), EXAM_CONFLICT (both examined on the same exam day),
-- UNHANDLED_REFERENCE (a reference this migration does not know);
-- NOT_ALLOWED (42501) for everybody but admins.
--
-- Badge triggers are paused with set_config(..., true) inside the function,
-- not with a SET clause on it: hosted Supabase and the CLI run migrations as
-- a postgres that is no superuser, and only a superuser may attach a custom
-- setting to a function (the check script fails on any such function).

-----------------------------------------------------------------------
-- 1. The log
-----------------------------------------------------------------------

CREATE TABLE public.member_merges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Deleting the kept member deletes its merge history (and the snapshot
  -- of the dropped row) with it
  kept_id integer NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  dropped_id integer NOT NULL,
  -- The dropped row as it was, without photo data and trial token, and its
  -- provider links
  dropped jsonb NOT NULL,
  -- What merge_members() returned: per reference what moved, the
  -- conflicts and how they were resolved, field decisions, accounts, badge
  -- changes
  result jsonb NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  merged_by uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.member_merges IS
  'One merge of a duplicate member (merge_members): kept and dropped id, the dropped row as it was, what moved. Admins only.';

CREATE INDEX member_merges_kept_idx ON public.member_merges (kept_id);

ALTER TABLE public.member_merges ENABLE ROW LEVEL SECURITY;

-- Only admins read it; rows are only written by merge_members(), so no API
-- role (the sync's service key included) gets more than SELECT
CREATE POLICY member_merges_read ON public.member_merges
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON public.member_merges FROM anon, authenticated, service_role;
GRANT SELECT ON public.member_merges TO authenticated, service_role;

-----------------------------------------------------------------------
-- 2. Every reference to a member and what the merge does with it
-----------------------------------------------------------------------

-- kind 'fk': a foreign key to members(id), as '<table>.<column>'; the merge
-- refuses to run while the schema has one that is not listed here.
-- kind 'other': references without a foreign key.
CREATE FUNCTION public.merge_member_references()
RETURNS TABLE (ref text, kind text, rule text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('logs.memberId', 'fk',
     'Moved. Same training and date under both: one attendance with the higher trainer role (main trainer > assistant > attendee).'),
    ('participants.memberId', 'fk',
     'Moved. Same training under both: one assignment, with the dropped one''s trial start date when the kept one has none.'),
    ('event_participants.memberId', 'fk',
     'Moved. Same event under both: one registration with the furthest status (attended > absent > cancelled > registered), the earliest registration time; one entered in the app wins over a Webling import, so the sync never removes it.'),
    ('event_logs.memberId', 'fk',
     'Moved. Same event under both: one attendance, coach if either was, notes of both.'),
    ('member_badges.memberId', 'fk',
     'Moved with the earliest earn date, then every badge of the kept member is recomputed, and the section season badges of every section and year the dropped member trained in (and the year after).'),
    ('member_grades.memberId', 'fk',
     'Moved. Same grade under both: the one an exam sheet recorded stays, otherwise the kept one; notes of both.'),
    ('member_medals.memberId', 'fk',
     'Moved. Same competition (event) under both: the better medal stays and takes category and section from the other where it has none. Without an event: exact duplicates are removed.'),
    ('exam_candidates.member_id', 'fk',
     'Moved. Same exam day under both: the one with a sheet stays (both with a sheet: EXAM_CONFLICT), otherwise the one with the furthest status (invited > registered > withdrawn). It takes the furthest status of both, the notes and staff notes of both and empty fields from the other; the removed registration (status, grade, trainer, notes) is kept in the conflict entry.'),
    ('trial_emails.member_id', 'fk', 'Moved.'),
    ('training_plan_sessions.trainer_id', 'fk', 'Moved (the admin shows as last editor of those plan entries).'),
    ('trainings.mainTrainerId', 'fk', 'Moved.'),
    ('user_profiles.member_id', 'fk',
     'Moved when only the dropped member is linked to an account; both linked: ACCOUNT_CONFLICT.'),
    ('member_links.member_id', 'fk',
     'Active link on the dropped member: refused (BOTH_IN_PROVIDER or KEEP_PROVIDER_ROW). A gone link is removed with the dropped row; the kept member''s link is untouched.'),
    ('member_merges.kept_id', 'fk', 'Earlier merges into the dropped member now name the kept one.'),
    ('members', 'other',
     'Kept row: name, labels and status stay. Birthday, mobile, e-mail only filled where empty and only on a row not in Webling, e-mail never from a trial registration. Notes of both. Photo of the dropped row when the kept one has none. Archived only if both were. Trial history and status link of the dropped row when the kept one has neither.'),
    ('storage avatars/<id>_<ms>.webp', 'other',
     'Not reachable from SQL: the browser copies the dropped member''s file (fields.dropPhotoUploaded) when the kept member takes over its photo (fields.photo = from_drop), and removes the dropped one''s file afterwards only once the kept one''s exists, the photo was not taken or the file is missing (src/lib/memberMerge.ts, mergeWithPhoto).'),
    ('accounts', 'other',
     'Accounts linked to either member or matching either e-mail: whether they get in (is_approved_user) and find the member (my_member_ids), before and after (accounts); ACCOUNT_LOSES_ACCESS when a member account loses its access. Nothing is linked automatically.');
$$;

COMMENT ON FUNCTION public.merge_member_references() IS
  'The reviewed list of references merge_members() handles; supabase/checks/merge_members.sql compares it with the foreign keys to members.';

-- Notes of both rows: b appended to a unless empty or already in a
CREATE FUNCTION public.merge_members_join_text(p_a text, p_b text, p_sep text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN nullif(btrim(p_b), '') IS NULL THEN p_a
    WHEN nullif(btrim(p_a), '') IS NULL THEN p_b
    WHEN strpos(p_a, btrim(p_b)) > 0 THEN p_a
    ELSE p_a || p_sep || p_b
  END;
$$;

-- A contact field of the kept row: 'same' (nothing to take over),
-- 'from_drop' (the kept row's is empty), 'kept_differs', or not copied
-- because the kept row is in Webling ('not_copied_provider') or the value
-- came from the trial form ('not_copied_trial')
CREATE FUNCTION public.merge_members_field_rule(p_keep text, p_drop text, p_keep_in_provider boolean, p_drop_untrusted boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN nullif(btrim(p_drop), '') IS NULL OR lower(btrim(p_drop)) = lower(btrim(coalesce(p_keep, ''))) THEN 'same'
    WHEN p_keep_in_provider THEN 'not_copied_provider'
    WHEN nullif(btrim(p_keep), '') IS NOT NULL THEN 'kept_differs'
    WHEN p_drop_untrusted THEN 'not_copied_trial'
    ELSE 'from_drop'
  END;
$$;

-- An exam candidate whose sheet was opened: started, a result, scores or an
-- examiner. A merge never deletes such a row.
CREATE FUNCTION public.exam_candidate_has_sheet(p_candidate_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.exam_candidates c
           WHERE c.id = p_candidate_id AND (c.started_at IS NOT NULL OR c.result IS NOT NULL)
         )
      OR EXISTS (SELECT 1 FROM public.exam_scores s WHERE s.candidate_id = p_candidate_id)
      OR EXISTS (SELECT 1 FROM public.exam_examiners e WHERE e.candidate_id = p_candidate_id);
$$;

-- Whether an account finds this member record, by the rule of
-- my_member_ids() (20261027120000_member_access_requires_membership.sql):
-- an approved account, linked to it or with its e-mail (not on a trial
-- row), and for a member account only while the record counts. Linked or
-- matched alone would miss a parent who keeps access through one child
-- and loses another whose record stops counting.
CREATE FUNCTION public.merge_members_account_finds(p public.user_profiles, m public.members)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    p.status = 'approved'
    AND (p.member_id = m.id
         OR (m.email IS NOT NULL AND NOT public.has_trial_label(m.labels)
             AND public.normalize_email(p.email) = public.normalize_email(m.email)))
    AND (p.role <> 'member' OR public.member_grants_access(m.membership_status, m."archivedAt", m.labels)),
    false);
$$;

-----------------------------------------------------------------------
-- 3. The merge
-----------------------------------------------------------------------

-- Not callable through the API: only merge_members() and
-- merge_members_preview() run it, as their owner. Returns the result
-- object plus 'dropped' (the snapshot for member_merges).
CREATE FUNCTION public.merge_members_apply(p_keep integer, p_drop integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  k public.members;            -- the kept row, locked
  d public.members;            -- the dropped row as it was before anything moved
  v_keep_in boolean;           -- in Webling: active link, or no link and a Webling id
  v_drop_in boolean;
  v_drop_trial boolean;        -- the dropped row came from the trial form
  v_skip text := current_setting('app.skip_badge_refresh', true);
  v_unhandled text;
  v_moved jsonb := '{}';
  v_conflicts jsonb := '[]';
  v_warnings jsonb := '[]';
  v_fields jsonb := '{}';
  v_dropped jsonb;
  v_accounts_before jsonb;     -- {user_id: {access, finds}} before anything moved
  v_accounts jsonb;
  v_status_after text;
  v_n integer;
  v_m integer;
  v_r integer;
  v_rec record;
  v_fk record;
  v_left boolean;
  v_seasons jsonb;             -- [{section, year}] of the dropped member's attendance
  v_badges_before text[];
  v_badges_after text[];
  v_others_before text[];
  v_others_after text[];
  v_has_trainings boolean;
  v_trial_from_drop boolean;
  v_trial_status text;
  v_email text;
  v_drop_wins boolean;
  v_removed jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501', HINT = 'Only admins merge members.';
  END IF;
  IF p_keep IS NULL OR p_drop IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF p_keep = p_drop THEN
    RAISE EXCEPTION 'SAME_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  -- Fail closed: a foreign key to members this function does not know
  -- would cascade the dropped member's data away
  SELECT string_agg(r, ', ' ORDER BY r) INTO v_unhandled
  FROM (
    SELECT c.conrelid::regclass::text || '.' || a.attname AS r
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.members'::regclass
    EXCEPT
    SELECT ref FROM public.merge_member_references() WHERE kind = 'fk'
  ) x;
  IF v_unhandled IS NOT NULL THEN
    RAISE EXCEPTION 'UNHANDLED_REFERENCE: %', v_unhandled USING ERRCODE = 'P0001',
      HINT = 'Extend merge_members_apply() and merge_member_references() in a migration first.';
  END IF;

  -- Lock both rows (in id order, so two merges cannot deadlock). A check-in
  -- or registration for the dropped member waits and then fails cleanly.
  PERFORM 1 FROM public.members WHERE id IN (p_keep, p_drop) ORDER BY id FOR UPDATE;
  SELECT * INTO k FROM public.members WHERE id = p_keep;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: %', p_keep USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO d FROM public.members WHERE id = p_drop;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: %', p_drop USING ERRCODE = 'P0001';
  END IF;
  -- And the dropped row's links: the nightly sync cannot bring a gone link
  -- back between the check below and the delete
  PERFORM 1 FROM public.member_links WHERE member_id = p_drop FOR UPDATE;

  -- The row Webling has must stay: the sync upserts members and links by
  -- the Webling id and would create a dropped one again. Same rule as
  -- trigger_set_membership_status() for a row without a link yet.
  v_keep_in := coalesce(public.provider_link_state(p_keep) = 'active', p_keep >= 1000 AND p_keep < 10000000);
  v_drop_in := coalesce(public.provider_link_state(p_drop) = 'active', p_drop >= 1000 AND p_drop < 10000000);
  IF v_keep_in AND v_drop_in THEN
    RAISE EXCEPTION 'BOTH_IN_PROVIDER' USING ERRCODE = 'P0001',
      HINT = 'Both members are in Webling: merge them there first.';
  END IF;
  IF v_drop_in THEN
    RAISE EXCEPTION 'KEEP_PROVIDER_ROW' USING ERRCODE = 'P0001',
      HINT = 'Keep the member that is in Webling.';
  END IF;

  IF (SELECT count(*) FROM public.user_profiles WHERE member_id IN (p_keep, p_drop)) > 1 THEN
    RAISE EXCEPTION 'ACCOUNT_CONFLICT' USING ERRCODE = 'P0001',
      HINT = 'Both members are linked to an account: unlink one under Benutzer first.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.exam_candidates x
    JOIN public.exam_candidates l ON l.exam_id = x.exam_id AND l.member_id = p_keep
    WHERE x.member_id = p_drop
      AND public.exam_candidate_has_sheet(x.id) AND public.exam_candidate_has_sheet(l.id)
  ) THEN
    RAISE EXCEPTION 'EXAM_CONFLICT' USING ERRCODE = 'P0001',
      HINT = 'Both members were examined on the same exam day.';
  END IF;

  v_drop_trial := public.has_trial_label(d.labels) OR d."trialRegisteredAt" IS NOT NULL;

  v_dropped := jsonb_build_object(
    'member', to_jsonb(d) - 'img' - 'trialToken'
              || jsonb_build_object('hasPhoto', d.img IS NOT NULL, 'hadTrialLink', d."trialToken" IS NOT NULL),
    'links', coalesce((
      SELECT jsonb_agg(jsonb_build_object('connection', connection, 'external_id', external_id,
                                          'last_seen_at', last_seen_at, 'gone_at', gone_at))
      FROM public.member_links WHERE member_id = p_drop), '[]'));

  -- Sign-in accounts linked to either row or matching either e-mail: do
  -- they get in (is_approved_user()), and do they find the person
  -- (my_member_ids(): for a member account only a record that counts)?
  -- Compared with the same after the merge, so the preview names who loses
  -- or gains access or the person instead of guessing from e-mails: staff
  -- get in by their role either way.
  SELECT coalesce(jsonb_object_agg(p.user_id::text, jsonb_build_object(
           'access', p.status = 'approved'
                     AND (p.role <> 'member' OR public.member_account_has_access(p.member_id, p.email)),
           'finds', public.merge_members_account_finds(p, k) OR public.merge_members_account_finds(p, d))), '{}')
    INTO v_accounts_before
  FROM public.user_profiles p
  WHERE p.member_id IN (p_keep, p_drop)
     OR public.normalize_email(p.email) IN (public.normalize_email(k.email), public.normalize_email(d.email));

  -- Where the dropped member trained: those section seasons are recomputed
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('section', t.section, 'year', left(l.date, 4)::int)), '[]')
  INTO v_seasons
  FROM public.logs l
  JOIN public.trainings t ON t.id = l."trainingId"
  WHERE l."memberId" = p_drop AND t.section IS NOT NULL AND l.date ~ '^\d{4}-';

  v_badges_before := ARRAY(
    SELECT "badgeId" || ':' || season || ':' || context FROM public.member_badges
    WHERE "memberId" = p_keep ORDER BY 1);
  v_others_before := ARRAY(
    SELECT b."memberId" || ':' || b."badgeId" || ':' || b.season || ':' || b.context
    FROM public.member_badges b
    JOIN jsonb_array_elements(v_seasons) s(e)
      ON b.season IN ((s.e->>'year')::int, (s.e->>'year')::int + 1)
     AND lower(b.context) = lower(s.e->>'section')
    WHERE b."memberId" NOT IN (p_keep, p_drop) ORDER BY 1);

  -- Badges are recomputed once at the end instead of per moved row; the
  -- previous value comes back before returning (also on the preview's
  -- rollback)
  PERFORM set_config('app.skip_badge_refresh', 'true', true);

  ---------------------------------------------------------------------
  -- logs.memberId (trainer_role sorts attendee, main_trainer, assistant:
  -- ranked explicitly)
  ---------------------------------------------------------------------
  UPDATE public.logs l
     SET "trainerRole" = CASE
           WHEN array_position(ARRAY['attendee', 'assistant', 'main_trainer']::public.trainer_role[], x."trainerRole")
              > array_position(ARRAY['attendee', 'assistant', 'main_trainer']::public.trainer_role[], l."trainerRole")
           THEN x."trainerRole" ELSE l."trainerRole" END,
         "isMainTrainer" = l."isMainTrainer" OR x."isMainTrainer"
    FROM public.logs x
   WHERE l."memberId" = p_keep AND x."memberId" = p_drop
     AND x.date = l.date AND x."trainingId" = l."trainingId";
  DELETE FROM public.logs x
   USING public.logs l
   WHERE x."memberId" = p_drop AND l."memberId" = p_keep
     AND l.date = x.date AND l."trainingId" = x."trainingId";
  GET DIAGNOSTICS v_m = ROW_COUNT;
  UPDATE public.logs SET "memberId" = p_keep WHERE "memberId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('logs.memberId', jsonb_build_object('moved', v_n, 'merged', v_m));

  ---------------------------------------------------------------------
  -- participants.memberId (the trial status trigger only fires on insert
  -- and delete; deleting the dropped duplicates only touches the dropped row)
  ---------------------------------------------------------------------
  UPDATE public.participants p
     SET "trialStartDate" = coalesce(p."trialStartDate", x."trialStartDate")
    FROM public.participants x
   WHERE p."memberId" = p_keep AND x."memberId" = p_drop AND x."trainingId" = p."trainingId";
  DELETE FROM public.participants x
   USING public.participants p
   WHERE x."memberId" = p_drop AND p."memberId" = p_keep AND p."trainingId" = x."trainingId";
  GET DIAGNOSTICS v_m = ROW_COUNT;
  UPDATE public.participants SET "memberId" = p_keep WHERE "memberId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('participants.memberId', jsonb_build_object('moved', v_n, 'merged', v_m));

  ---------------------------------------------------------------------
  -- event_participants.memberId. A registration entered in the app must
  -- not end up with a note starting with 'Imported from Webling': the sync
  -- removes such rows when Webling no longer lists the member
  -- (webling-sync/src/sync_rules.py, plan_participants).
  ---------------------------------------------------------------------
  UPDATE public.event_participants p
     SET "attendanceStatus" = CASE
           WHEN coalesce(array_position(ARRAY['registered', 'cancelled', 'absent', 'attended'], x."attendanceStatus"), 0)
              > coalesce(array_position(ARRAY['registered', 'cancelled', 'absent', 'attended'], p."attendanceStatus"), 0)
           THEN x."attendanceStatus" ELSE p."attendanceStatus" END,
         "registeredAt" = least(p."registeredAt", x."registeredAt"),
         notes = CASE
           WHEN coalesce(p.notes, '') LIKE 'Imported from Webling%' AND coalesce(x.notes, '') NOT LIKE 'Imported from Webling%'
             THEN x.notes
           WHEN coalesce(x.notes, '') LIKE 'Imported from Webling%'
             THEN p.notes
           ELSE public.merge_members_join_text(p.notes, x.notes, ' / ')
         END
    FROM public.event_participants x
   WHERE p."memberId" = p_keep AND x."memberId" = p_drop AND x."eventId" = p."eventId";
  DELETE FROM public.event_participants x
   USING public.event_participants p
   WHERE x."memberId" = p_drop AND p."memberId" = p_keep AND p."eventId" = x."eventId";
  GET DIAGNOSTICS v_m = ROW_COUNT;
  UPDATE public.event_participants SET "memberId" = p_keep WHERE "memberId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('event_participants.memberId', jsonb_build_object('moved', v_n, 'merged', v_m));

  ---------------------------------------------------------------------
  -- event_logs.memberId (no unique key: folded into the kept member's
  -- first row of the event, else event badges would count twice)
  ---------------------------------------------------------------------
  UPDATE public.event_logs l
     SET "isCoach" = l."isCoach" OR x.coach,
         "attendedAt" = least(l."attendedAt", x.attended),
         notes = public.merge_members_join_text(l.notes, x.notes, ' / ')
    FROM (
      SELECT "eventId", bool_or("isCoach") AS coach, min("attendedAt") AS attended,
             string_agg(DISTINCT nullif(btrim(notes), ''), ' / ') AS notes
      FROM public.event_logs WHERE "memberId" = p_drop GROUP BY "eventId"
    ) x
   WHERE l.id IN (SELECT min(id) FROM public.event_logs WHERE "memberId" = p_keep GROUP BY "eventId")
     AND l."eventId" = x."eventId";
  DELETE FROM public.event_logs x
   WHERE x."memberId" = p_drop
     AND EXISTS (SELECT 1 FROM public.event_logs l WHERE l."memberId" = p_keep AND l."eventId" = x."eventId");
  GET DIAGNOSTICS v_m = ROW_COUNT;
  UPDATE public.event_logs SET "memberId" = p_keep WHERE "memberId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('event_logs.memberId', jsonb_build_object('moved', v_n, 'merged', v_m));

  ---------------------------------------------------------------------
  -- member_badges.memberId (recomputed below; moving keeps the earn date)
  ---------------------------------------------------------------------
  SELECT count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.member_badges l
           WHERE l."memberId" = p_keep AND l."badgeId" = x."badgeId"
             AND l.season = x.season AND l.context = x.context)),
         count(*)
    INTO v_m, v_n
    FROM public.member_badges x WHERE x."memberId" = p_drop;
  INSERT INTO public.member_badges ("memberId", "badgeId", "earnedAt", season, context)
  SELECT p_keep, "badgeId", "earnedAt", season, context
    FROM public.member_badges WHERE "memberId" = p_drop
  ON CONFLICT ("memberId", "badgeId", season, context)
  DO UPDATE SET "earnedAt" = least(member_badges."earnedAt", EXCLUDED."earnedAt");
  DELETE FROM public.member_badges WHERE "memberId" = p_drop;
  v_moved := v_moved || jsonb_build_object('member_badges.memberId', jsonb_build_object('moved', v_n - v_m, 'merged', v_m));

  ---------------------------------------------------------------------
  -- member_grades.memberId. exam_candidates.member_grade_id points at the
  -- grade an exam recorded; reopening that sheet deletes it
  -- (remove_exam_candidate_grade), so a sheet never gets pointed at
  -- another row: the loser's pointer becomes NULL (foreign key), as when
  -- the grade existed before the exam (sync_exam_candidate_result).
  ---------------------------------------------------------------------
  v_m := 0;
  FOR v_rec IN
    SELECT x.id AS drop_id, l.id AS keep_id, x.section, x.grade,
           x."examDate" AS drop_date, l."examDate" AS keep_date, x.note AS drop_note, l.note AS keep_note,
           EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.member_grade_id = x.id) AS drop_exam,
           EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.member_grade_id = l.id) AS keep_exam
    FROM public.member_grades x
    JOIN public.member_grades l ON l."memberId" = p_keep AND l.section = x.section AND l.grade = x.grade
    WHERE x."memberId" = p_drop
    ORDER BY x.id
  LOOP
    v_m := v_m + 1;
    IF v_rec.drop_exam AND NOT v_rec.keep_exam THEN
      DELETE FROM public.member_grades WHERE id = v_rec.keep_id;
      UPDATE public.member_grades
         SET "memberId" = p_keep, note = public.merge_members_join_text(v_rec.drop_note, v_rec.keep_note, ' / ')
       WHERE id = v_rec.drop_id;
    ELSE
      UPDATE public.member_grades
         SET note = public.merge_members_join_text(v_rec.keep_note, v_rec.drop_note, ' / ')
       WHERE id = v_rec.keep_id;
      DELETE FROM public.member_grades WHERE id = v_rec.drop_id;
    END IF;
    v_conflicts := v_conflicts || jsonb_build_object(
      'ref', 'member_grades.memberId', 'section', v_rec.section, 'grade', v_rec.grade,
      'kept', CASE WHEN v_rec.drop_exam AND NOT v_rec.keep_exam THEN 'drop' ELSE 'keep' END,
      'reason', CASE WHEN v_rec.drop_exam OR v_rec.keep_exam THEN 'exam' ELSE 'keep' END,
      'keepExamDate', v_rec.keep_date, 'dropExamDate', v_rec.drop_date);
  END LOOP;
  UPDATE public.member_grades SET "memberId" = p_keep WHERE "memberId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('member_grades.memberId', jsonb_build_object('moved', v_n, 'merged', v_m));

  ---------------------------------------------------------------------
  -- member_medals.memberId: per event the better medal (the kept member's
  -- on a tie), with category and section of the other where it has none
  ---------------------------------------------------------------------
  v_m := 0;
  FOR v_rec IN
    SELECT x.id AS drop_id, l.id AS keep_id, l.competition, l.date, x.medal AS drop_medal, l.medal AS keep_medal,
           array_position(ARRAY['bronze', 'silver', 'gold'], x.medal)
             > array_position(ARRAY['bronze', 'silver', 'gold'], l.medal) AS drop_wins
    FROM public.member_medals x
    JOIN public.member_medals l ON l."memberId" = p_keep AND l."eventId" = x."eventId"
    WHERE x."memberId" = p_drop
    ORDER BY x.id
  LOOP
    v_m := v_m + 1;
    UPDATE public.member_medals w
       SET category = coalesce(nullif(btrim(w.category), ''), o.category),
           section = coalesce(nullif(btrim(w.section), ''), o.section)
      FROM public.member_medals o
     WHERE w.id = CASE WHEN v_rec.drop_wins THEN v_rec.drop_id ELSE v_rec.keep_id END
       AND o.id = CASE WHEN v_rec.drop_wins THEN v_rec.keep_id ELSE v_rec.drop_id END;
    IF v_rec.drop_wins THEN
      DELETE FROM public.member_medals WHERE id = v_rec.keep_id;
      UPDATE public.member_medals SET "memberId" = p_keep WHERE id = v_rec.drop_id;
    ELSE
      DELETE FROM public.member_medals WHERE id = v_rec.drop_id;
    END IF;
    v_conflicts := v_conflicts || jsonb_build_object(
      'ref', 'member_medals.memberId', 'competition', v_rec.competition, 'date', v_rec.date,
      'keptMedal', CASE WHEN v_rec.drop_wins THEN v_rec.drop_medal ELSE v_rec.keep_medal END,
      'droppedMedal', CASE WHEN v_rec.drop_wins THEN v_rec.keep_medal ELSE v_rec.drop_medal END,
      'kept', CASE WHEN v_rec.drop_wins THEN 'drop' ELSE 'keep' END);
  END LOOP;
  DELETE FROM public.member_medals x
   USING public.member_medals l
   WHERE x."memberId" = p_drop AND x."eventId" IS NULL
     AND l."memberId" = p_keep AND l."eventId" IS NULL
     AND l.competition = x.competition AND l.date = x.date AND l.medal = x.medal
     AND l.category IS NOT DISTINCT FROM x.category AND l.section IS NOT DISTINCT FROM x.section;
  GET DIAGNOSTICS v_r = ROW_COUNT;
  UPDATE public.member_medals SET "memberId" = p_keep WHERE "memberId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('member_medals.memberId', jsonb_build_object('moved', v_n, 'merged', v_m + v_r));

  ---------------------------------------------------------------------
  -- exam_candidates.member_id (EXAM_CONFLICT checked above). The row with
  -- a sheet, or else the further one, stays. It takes the further status
  -- of both (invited > registered > withdrawn), also when its sheet won: a
  -- status only moves up here, which guard_exam_grading() allows on a
  -- sheet too (calling up a graded candidate, or back from withdrawn
  -- before a result). Notes and staff notes of both are joined, empty
  -- fields come from the other. The other has no sheet, so no scores or
  -- examiners go with it; its registration as it was (status, grade,
  -- trainer, notes) goes into the conflict entry, so member_merges keeps
  -- what the stayed row does not show.
  ---------------------------------------------------------------------
  v_m := 0;
  FOR v_rec IN
    SELECT x.id AS drop_id, l.id AS keep_id, e.title, e.date, x.status AS drop_status, l.status AS keep_status,
           public.exam_candidate_has_sheet(x.id) AS drop_sheet,
           public.exam_candidate_has_sheet(l.id) AS keep_sheet,
           coalesce(array_position(ARRAY['withdrawn', 'registered', 'invited'], x.status), 0)
             > coalesce(array_position(ARRAY['withdrawn', 'registered', 'invited'], l.status), 0) AS drop_further
    FROM public.exam_candidates x
    JOIN public.exam_candidates l ON l.exam_id = x.exam_id AND l.member_id = p_keep
    JOIN public.exams e ON e.id = x.exam_id
    WHERE x.member_id = p_drop
    ORDER BY x.id
  LOOP
    v_m := v_m + 1;
    v_drop_wins := v_rec.drop_sheet OR (NOT v_rec.keep_sheet AND v_rec.drop_further);
    -- w stays, o goes. The staff note keeps to its 2000 characters
    -- (column check); the conflict entry has the removed one in full.
    UPDATE public.exam_candidates w
       SET status = CASE WHEN v_rec.drop_further THEN v_rec.drop_status ELSE v_rec.keep_status END,
           belt_length_cm = coalesce(w.belt_length_cm, o.belt_length_cm),
           trainer = coalesce(nullif(btrim(w.trainer), ''), o.trainer),
           note = public.merge_members_join_text(w.note, o.note, ' / '),
           staff_note = left(public.merge_members_join_text(w.staff_note, o.staff_note, ' / '), 2000),
           group_name = coalesce(nullif(btrim(w.group_name), ''), o.group_name),
           call_time = coalesce(w.call_time, o.call_time)
      FROM public.exam_candidates o
     WHERE w.id = CASE WHEN v_drop_wins THEN v_rec.drop_id ELSE v_rec.keep_id END
       AND o.id = CASE WHEN v_drop_wins THEN v_rec.keep_id ELSE v_rec.drop_id END
    RETURNING jsonb_build_object('status', o.status, 'grade', o.grade, 'trainer', o.trainer,
                                 'note', o.note, 'staffNote', o.staff_note)
      INTO v_removed;
    IF v_drop_wins THEN
      DELETE FROM public.exam_candidates WHERE id = v_rec.keep_id;
      UPDATE public.exam_candidates SET member_id = p_keep WHERE id = v_rec.drop_id;
    ELSE
      DELETE FROM public.exam_candidates WHERE id = v_rec.drop_id;
    END IF;
    v_conflicts := v_conflicts || jsonb_build_object(
      'ref', 'exam_candidates.member_id', 'title', v_rec.title, 'date', v_rec.date,
      'kept', CASE WHEN v_drop_wins THEN 'drop' ELSE 'keep' END,
      'reason', CASE WHEN v_rec.drop_sheet OR v_rec.keep_sheet THEN 'sheet' ELSE 'status' END,
      'removed', v_removed);
  END LOOP;
  UPDATE public.exam_candidates SET member_id = p_keep WHERE member_id = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('exam_candidates.member_id', jsonb_build_object('moved', v_n, 'merged', v_m));

  ---------------------------------------------------------------------
  -- trial_emails.member_id, training_plan_sessions.trainer_id,
  -- trainings.mainTrainerId: no unique keys involved
  ---------------------------------------------------------------------
  UPDATE public.trial_emails SET member_id = p_keep WHERE member_id = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('trial_emails.member_id', jsonb_build_object('moved', v_n, 'merged', 0));

  UPDATE public.training_plan_sessions SET trainer_id = p_keep WHERE trainer_id = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('training_plan_sessions.trainer_id', jsonb_build_object('moved', v_n, 'merged', 0));

  UPDATE public.trainings SET "mainTrainerId" = p_keep WHERE "mainTrainerId" = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('trainings.mainTrainerId', jsonb_build_object('moved', v_n, 'merged', 0));

  ---------------------------------------------------------------------
  -- user_profiles.member_id (ACCOUNT_CONFLICT checked above). Only an
  -- existing link moves: linking an account found by e-mail would pick a
  -- trainer's or a parent's account as easily as the member's own.
  ---------------------------------------------------------------------
  UPDATE public.user_profiles SET member_id = p_keep WHERE member_id = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('user_profiles.member_id', jsonb_build_object('moved', v_n, 'merged', 0));

  ---------------------------------------------------------------------
  -- member_merges.kept_id
  ---------------------------------------------------------------------
  UPDATE public.member_merges SET kept_id = p_keep WHERE kept_id = p_drop;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('member_merges.kept_id', jsonb_build_object('moved', v_n, 'merged', 0));

  ---------------------------------------------------------------------
  -- member_links.member_id: only gone links can be left (active ones were
  -- refused). They go with the dropped row, below: deleting them first
  -- would make the dropped row count as a member again for a moment
  -- (trigger_link_changed_status) and could approve a waiting account.
  ---------------------------------------------------------------------
  SELECT count(*) INTO v_n FROM public.member_links WHERE member_id = p_drop;
  v_moved := v_moved || jsonb_build_object('member_links.member_id', jsonb_build_object('moved', 0, 'merged', 0, 'removed', v_n));

  -- Nothing may point at the dropped row any more but its gone links
  FOR v_fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.members'::regclass
      AND c.conrelid <> 'public.member_links'::regclass
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tbl, v_fk.col)
      INTO v_left USING p_drop;
    IF v_left THEN
      RAISE EXCEPTION 'UNHANDLED_REFERENCE: %.% still points at member %', v_fk.tbl, v_fk.col, p_drop
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.member_links WHERE member_id = p_drop AND gone_at IS NULL) THEN
    RAISE EXCEPTION 'UNHANDLED_REFERENCE: member_links.member_id still active for member %', p_drop
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.members WHERE id = p_drop;

  ---------------------------------------------------------------------
  -- members: the kept row
  ---------------------------------------------------------------------
  -- Contact fields: what is decided is what is written below
  v_fields := jsonb_build_object(
    'birthday', public.merge_members_field_rule(k.birthday, d.birthday, v_keep_in, false),
    'mobile', public.merge_members_field_rule(k.mobile, d.mobile, v_keep_in, false),
    -- The trial form accepts any address: copied onto a member it could let
    -- a stranger sign in as that member
    'email', public.merge_members_field_rule(k.email, d.email, v_keep_in, v_drop_trial),
    'notes', CASE WHEN nullif(btrim(d.notes), '') IS NULL THEN 'same' ELSE 'joined' END,
    'photo', CASE WHEN k.img IS NOT NULL AND d.img IS NOT NULL THEN 'kept_both'
                  WHEN k.img IS NOT NULL THEN 'kept'
                  WHEN d.img IS NOT NULL THEN 'from_drop'
                  ELSE 'none' END,
    -- The dropped member's photo file is avatars/<drop>_<this in ms>.webp:
    -- the browser copies and removes it by the database's value, not by a
    -- member row it loaded earlier
    'dropPhotoUploaded', CASE WHEN d.img IS NOT NULL THEN d."imgUploaded" END,
    'archived', CASE WHEN k."archivedAt" IS NOT NULL AND d."archivedAt" IS NULL THEN 'unarchived'
                     WHEN k."archivedAt" IS NOT NULL THEN 'archived' ELSE 'not_archived' END,
    -- Labels and status stay the kept row's; these of the dropped row are not carried over
    'labelsNotCarried', coalesce((
      SELECT jsonb_agg(l ORDER BY l) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(d.labels) = 'array' THEN d.labels ELSE '[]' END) l
      WHERE NOT coalesce(k.labels, '[]') ? l), '[]'));
  v_email := CASE WHEN v_fields->>'email' = 'from_drop' THEN d.email ELSE k.email END;

  UPDATE public.members m
     SET birthday = CASE WHEN v_fields->>'birthday' = 'from_drop' THEN d.birthday ELSE k.birthday END,
         mobile = CASE WHEN v_fields->>'mobile' = 'from_drop' THEN d.mobile ELSE k.mobile END,
         email = v_email,
         notes = public.merge_members_join_text(k.notes, d.notes, E'\n\n'),
         img = CASE WHEN v_fields->>'photo' = 'from_drop' THEN d.img ELSE k.img END,
         "imgUploaded" = CASE WHEN v_fields->>'photo' = 'from_drop' THEN d."imgUploaded" ELSE k."imgUploaded" END,
         "archivedAt" = CASE WHEN d."archivedAt" IS NOT NULL THEN k."archivedAt" END
   WHERE m.id = p_keep;

  -- Trial history: the dropped row's when the kept row has none and no
  -- status link of its own (a link already sent out must keep working),
  -- with its status link (trialToken). The status follows the trainings
  -- like assigning one does (trigger_sync_trial_status_on_participants):
  -- with trainings 'assigned', which also keeps a 'cancelled' from removing
  -- them (trigger_trial_cancelled).
  v_trial_from_drop := k."trialStatus" IS NULL AND k."trialRegisteredAt" IS NULL AND k."trialToken" IS NULL
                       AND (d."trialStatus" IS NOT NULL OR d."trialRegisteredAt" IS NOT NULL);
  v_trial_status := CASE WHEN v_trial_from_drop THEN d."trialStatus" ELSE k."trialStatus" END;
  SELECT EXISTS (SELECT 1 FROM public.participants WHERE "memberId" = p_keep) INTO v_has_trainings;
  IF v_trial_status IS NOT NULL AND v_trial_status <> 'assigned' AND v_has_trainings THEN
    v_trial_status := 'assigned';
  END IF;
  IF v_trial_from_drop THEN
    UPDATE public.members
       SET "trialRegisteredAt" = d."trialRegisteredAt",
           "trialSection" = d."trialSection",
           "trialLocale" = d."trialLocale",
           "trialToken" = d."trialToken",
           "trialSelfCancelled" = d."trialSelfCancelled",
           "trialStatus" = v_trial_status
     WHERE id = p_keep;
    -- The trigger stamped now(); the history keeps its own date unless the
    -- status changed here
    IF v_trial_status IS NOT DISTINCT FROM d."trialStatus" THEN
      UPDATE public.members SET "trialStatusChangedAt" = d."trialStatusChangedAt" WHERE id = p_keep;
    END IF;
  ELSIF v_trial_status IS DISTINCT FROM k."trialStatus" THEN
    UPDATE public.members SET "trialStatus" = v_trial_status WHERE id = p_keep;
  END IF;
  v_fields := v_fields || jsonb_build_object(
    'trial', CASE WHEN v_trial_from_drop THEN 'from_drop'
                  WHEN k."trialStatus" IS NOT NULL OR k."trialRegisteredAt" IS NOT NULL OR k."trialToken" IS NOT NULL THEN 'keep'
                  ELSE 'none' END,
    'trialStatus', v_trial_status);

  SELECT membership_status INTO v_status_after FROM public.members WHERE id = p_keep;

  -- The accounts from the start, now: the account link moved, the kept row
  -- may have taken an e-mail, and grant_member_access_on_member_change may
  -- have approved a waiting account
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'userId', p.user_id,
           'email', p.email,
           'role', p.role,
           'before', (b.value->>'access')::boolean,
           'after', p.status = 'approved'
                    AND (p.role <> 'member' OR public.member_account_has_access(p.member_id, p.email)),
           'findsBefore', (b.value->>'finds')::boolean,
           'findsAfter', public.merge_members_account_finds(p, m))
           ORDER BY p.email, p.user_id), '[]')
    INTO v_accounts
  FROM jsonb_each(v_accounts_before) AS b(user_id, value)
  JOIN public.user_profiles p ON p.user_id = b.user_id::uuid
  JOIN public.members m ON m.id = p_keep;

  IF d."trialToken" IS NOT NULL AND NOT v_trial_from_drop THEN
    v_warnings := v_warnings || '"TRIAL_LINK_ENDS"'::jsonb;
  END IF;
  IF v_fields->>'email' NOT IN ('same', 'from_drop') THEN
    v_warnings := v_warnings || to_jsonb('EMAIL_NOT_COPIED'::text);
  END IF;
  SELECT count(*) INTO v_n
  FROM jsonb_array_elements(v_accounts) a
  WHERE (a->>'before')::boolean AND NOT (a->>'after')::boolean;
  IF v_n > 0 THEN
    v_warnings := v_warnings || jsonb_build_object('code', 'ACCOUNT_LOSES_ACCESS', 'accounts', v_n);
  END IF;
  IF v_fields->>'photo' = 'kept_both' THEN
    v_warnings := v_warnings || to_jsonb('PHOTO_NOT_TAKEN'::text);
  END IF;

  ---------------------------------------------------------------------
  -- Derived data: badges of the kept member, and the section season
  -- badges (top 3, most improved, coach of the year) of every section and
  -- year the dropped member trained in and the year after (most improved
  -- compares with the year before). Other members' streaks do not change:
  -- no training date was added or removed.
  ---------------------------------------------------------------------
  PERFORM set_config('app.skip_badge_refresh', coalesce(v_skip, ''), true);
  PERFORM public.refresh_member_badges(p_keep);
  PERFORM public.refresh_member_grade_medal_badges(p_keep);
  FOR v_rec IN
    SELECT DISTINCT y FROM (
      SELECT left(date, 4)::int AS y FROM public.logs WHERE "memberId" = p_keep AND date ~ '^\d{4}-'
      UNION
      SELECT season FROM public.member_badges WHERE "memberId" = p_keep AND "badgeId" = 'season_regular'
    ) s
  LOOP
    PERFORM public.refresh_member_season_badges(p_keep, v_rec.y);
  END LOOP;
  FOR v_rec IN
    SELECT DISTINCT s.e->>'section' AS section, v.y
    FROM jsonb_array_elements(v_seasons) AS s(e),
         LATERAL (VALUES ((s.e->>'year')::int), ((s.e->>'year')::int + 1)) AS v(y)
    WHERE v.y <= extract(year FROM now())::int
  LOOP
    PERFORM public.refresh_section_season_badges(v_rec.section, v_rec.y);
  END LOOP;

  v_badges_after := ARRAY(
    SELECT "badgeId" || ':' || season || ':' || context FROM public.member_badges
    WHERE "memberId" = p_keep ORDER BY 1);
  v_others_after := ARRAY(
    SELECT b."memberId" || ':' || b."badgeId" || ':' || b.season || ':' || b.context
    FROM public.member_badges b
    JOIN jsonb_array_elements(v_seasons) s(e)
      ON b.season IN ((s.e->>'year')::int, (s.e->>'year')::int + 1)
     AND lower(b.context) = lower(s.e->>'section')
    WHERE b."memberId" <> p_keep ORDER BY 1);

  RETURN jsonb_build_object(
    'keep', p_keep,
    'drop', p_drop,
    'keepInProvider', v_keep_in,
    'status', jsonb_build_object('before', k.membership_status, 'after', v_status_after),
    'moved', v_moved,
    'conflicts', v_conflicts,
    'fields', v_fields,
    'accounts', v_accounts,
    'warnings', v_warnings,
    'badges', jsonb_build_object(
      'added', to_jsonb(ARRAY(SELECT unnest(v_badges_after) EXCEPT SELECT unnest(v_badges_before) ORDER BY 1)),
      'removed', to_jsonb(ARRAY(SELECT unnest(v_badges_before) EXCEPT SELECT unnest(v_badges_after) ORDER BY 1)),
      'othersChanged', (
        SELECT count(*) FROM (
          (SELECT unnest(v_others_after) EXCEPT SELECT unnest(v_others_before))
          UNION ALL
          (SELECT unnest(v_others_before) EXCEPT SELECT unnest(v_others_after))
        ) c)),
    'dropped', v_dropped);
END;
$$;

COMMENT ON FUNCTION public.merge_members_apply(integer, integer) IS
  'Moves every reference from p_drop to p_keep (merge_member_references) and deletes p_drop. Internal: called by merge_members() and merge_members_preview().';

-- What merge_members(keep, drop) would do, without doing it: the same code,
-- rolled back. Raises the same refusals.
CREATE FUNCTION public.merge_members_preview(p_keep integer, p_drop integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501', HINT = 'Only admins merge members.';
  END IF;
  BEGIN
    v_result := public.merge_members_apply(p_keep, p_drop);
    -- Undo everything since BEGIN; the variable keeps the result
    RAISE EXCEPTION 'merge preview' USING ERRCODE = 'MMPRV';
  EXCEPTION WHEN SQLSTATE 'MMPRV' THEN
    NULL;
  END;
  RETURN v_result - 'dropped';
END;
$$;

COMMENT ON FUNCTION public.merge_members_preview(integer, integer) IS
  'Admins: what merge_members(p_keep, p_drop) would move, computed by running it and rolling back.';

-- Merge p_drop into p_keep and log it. Cannot be undone.
CREATE FUNCTION public.merge_members(p_keep integer, p_drop integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_id bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501', HINT = 'Only admins merge members.';
  END IF;
  v_result := public.merge_members_apply(p_keep, p_drop);
  INSERT INTO public.member_merges (kept_id, dropped_id, dropped, result)
  VALUES (p_keep, p_drop, v_result->'dropped', v_result - 'dropped')
  RETURNING id INTO v_id;
  RETURN (v_result - 'dropped') || jsonb_build_object('mergeId', v_id);
END;
$$;

COMMENT ON FUNCTION public.merge_members(integer, integer) IS
  'Admins: merge member p_drop into p_keep (every reference moved, p_drop deleted) and log it in member_merges. Cannot be undone.';

-- Internal helpers: never through the API (Supabase grants EXECUTE on new
-- functions to the API roles by default)
REVOKE EXECUTE ON FUNCTION public.merge_member_references() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.merge_members_join_text(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.merge_members_field_rule(text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.exam_candidate_has_sheet(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.merge_members_account_finds(public.user_profiles, public.members) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.merge_members_apply(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
-- Signed-in accounts reach the wrappers, which let admins only; preview
-- branches grant nothing on functions, so grant explicitly
REVOKE EXECUTE ON FUNCTION public.merge_members_preview(integer, integer) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.merge_members(integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.merge_members_preview(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_members(integer, integer) TO authenticated;
