-- Trainingsplanung: the main trainer plans their own training.
--
-- Until now only the TK (is_exam_manager(): admins, or viewers and trainers
-- with exam_role 'manager') wrote the plan (20261025090000_training_plan.sql).
-- Now a trainer who is the main trainer of a planned training plans every
-- date of that training too: trainer or substitute, topic, notes and whether
-- it takes place (also holding a date in a closing break). "Main trainer"
-- means trainings."mainTrainerId" is one of the account's members, found as
-- everywhere else (my_member_ids(): the linked member, or one with the
-- account's e-mail); "trainer" means an account that writes (is_writer():
-- trainer or admin), so a viewer who is main trainer still only reads.
-- A main trainer of a training outside the plan gets nothing.
--
-- The TK keeps the rest: the holidays (training_plan_breaks), which trainings
-- are planned (training_plan_trainings) and the import through the
-- Daten-Assistent (ai_import_begin()). Reading stays as it is (all staff).
--
-- The app asks my_main_training_ids() which trainings the account may plan;
-- the policies below are the real guard.

CREATE OR REPLACE FUNCTION public.my_main_training_ids()
RETURNS SETOF smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pt.training_id
  FROM public.training_plan_trainings pt
  JOIN public.trainings t ON t.id = pt.training_id
  WHERE public.is_writer()
    AND t."mainTrainerId" IN (SELECT public.my_member_ids());
$$;

COMMENT ON FUNCTION public.my_main_training_ids() IS
  'The planned trainings (training_plan_trainings) whose main trainer is one of the '
  'caller''s members (my_member_ids()), for accounts that write (is_writer()); empty '
  'otherwise. Their main trainer plans their sessions (docs/TRAINING_PLAN.md).';

REVOKE EXECUTE ON FUNCTION public.my_main_training_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_main_training_ids() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sessions: the TK, or the main trainer for their own training. UPDATE checks
-- the new row as well, so a session cannot be moved to another training.
-- ---------------------------------------------------------------------------
ALTER POLICY training_plan_sessions_insert ON public.training_plan_sessions
  WITH CHECK ((SELECT public.is_exam_manager())
              OR training_id IN (SELECT public.my_main_training_ids()));
ALTER POLICY training_plan_sessions_update ON public.training_plan_sessions
  USING ((SELECT public.is_exam_manager())
         OR training_id IN (SELECT public.my_main_training_ids()))
  WITH CHECK ((SELECT public.is_exam_manager())
              OR training_id IN (SELECT public.my_main_training_ids()));
ALTER POLICY training_plan_sessions_delete ON public.training_plan_sessions
  USING ((SELECT public.is_exam_manager())
         OR training_id IN (SELECT public.my_main_training_ids()));
