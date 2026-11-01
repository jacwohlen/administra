-- Trainingsplanung: only the TK sets a training's main trainer, and changes
-- the e-mail of a member who is main trainer.
--
-- Since 20261107120000_main_trainer_plans_own_training.sql the main trainer
-- of a planned training (trainings."mainTrainerId" one of the account's
-- members, my_main_training_ids()) plans every date of it. Every trainer
-- edits trainings (trainings_update: is_writer()), so a trainer could make
-- themselves main trainer of any planned training and then plan it.
--
-- From now on only the TK (is_exam_manager(): admins, or viewers and
-- trainers with exam_role 'manager') sets, changes or clears the main
-- trainer. Everything else about trainings stays as it was: trainers and
-- admins write them (the policies are unchanged, so a viewer who is TK still
-- edits no training; the TK sets the main trainer with a trainer or admin
-- account).
--
-- A trigger, since a policy cannot compare the old row with the new one. For
-- an API caller who is not the TK it refuses an INSERT with a main trainer
-- and an UPDATE that changes it (IS DISTINCT FROM: the same value written
-- again passes, so a form that sends every field, like the edit page of the
-- previous release, still saves the rest). An upsert is both: its INSERT is
-- checked, then the UPDATE it may end in.
--
-- API callers are current_user 'authenticated' and 'anon', as in
-- guard_exam_grading(). Everyone else is not restricted:
--   * migrations, seeds (supabase/seed.sql, supabase/demo/seed.sql) and
--     the checks, run by the database owner (psql as postgres), and the
--     service role
--   * SECURITY DEFINER functions, where current_user is their owner:
--     merge_members() and merge_members_preview() move the main trainer of
--     a merged member to the kept one (merge_members_apply())
--   * ON DELETE SET NULL of trainings_main_trainer_id_fkey: Postgres runs a
--     referential action as the owner of the referencing table (trainings),
--     so deleting a member who is main trainer still clears it, whoever
--     may delete members (members_delete: is_writer())
-- Not SECURITY DEFINER: it needs the caller's role.
--
-- my_member_ids() also finds an account's members by e-mail, so the e-mail
-- of a main trainer is the TK's too: second part below.

CREATE OR REPLACE FUNCTION public.guard_training_main_trainer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."mainTrainerId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."mainTrainerId" IS NOT DISTINCT FROM OLD."mainTrainerId" THEN
    RETURN NEW;
  END IF;
  -- anon may not call is_exam_manager(); it is never the TK anyway
  IF current_user = 'authenticated' THEN
    IF public.is_exam_manager() THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'only the TK sets the main trainer of a training'
    USING ERRCODE = '42501',
          HINT = 'trainings."mainTrainerId" is set by the TK (is_exam_manager()); '
                 || 'the main trainer plans the training''s dates (docs/TRAINING_PLAN.md).';
END;
$$;

COMMENT ON FUNCTION public.guard_training_main_trainer() IS
  'Trigger: through the API only the TK (is_exam_manager()) sets, changes or clears '
  'trainings."mainTrainerId"; the owner, the service role, SECURITY DEFINER functions '
  '(merge_members()) and ON DELETE SET NULL are not restricted (docs/TRAINING_PLAN.md).';

CREATE TRIGGER trainings_guard_main_trainer
  BEFORE INSERT OR UPDATE ON public.trainings
  FOR EACH ROW EXECUTE FUNCTION public.guard_training_main_trainer();

REVOKE EXECUTE ON FUNCTION public.guard_training_main_trainer() FROM PUBLIC, anon, authenticated;

-----------------
-- The e-mail of a main trainer
-----------------

-- my_main_training_ids() counts the trainings whose main trainer is one of
-- my_member_ids(): the account's linked member (user_profiles.member_id, set
-- by admins) and every member whose e-mail is the account's (normalize_email(),
-- no trial record). Every trainer edits members (members_update: is_writer()),
-- the e-mail too unless a provider owns it (trigger_guard_provider_fields:
-- Webling-linked members only). So a trainer could point the e-mail of a
-- training's main trainer at their own account's address, or an
-- accomplice's, and plan that training without touching "mainTrainerId".
--
-- So through the API only the TK changes the e-mail of a member who is main
-- trainer of a training: of any training, not only planned ones, since the
-- TK may add one to the plan later. Not restricted: the same address
-- written again (compared like my_member_ids() does; the member form sends
-- every field), members who are main trainer of nothing, and, as above, the
-- owner (migrations, seeds, checks), the service role and SECURITY DEFINER
-- functions (the Webling sync through integration_apply(), merge_members()
-- filling the kept member's e-mail).
--
-- Left open: a trial record (has_trial_label()) carrying the account's
-- e-mail is not counted until its trial label is removed. That needs the TK
-- to have made a trial record main trainer, which the edit page does not
-- offer (trial candidates are not among its choices).
CREATE OR REPLACE FUNCTION public.guard_main_trainer_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.normalize_email(NEW.email) IS NOT DISTINCT FROM public.normalize_email(OLD.email) THEN
    RETURN NEW;
  END IF;
  -- Only writers update members, and they read every training
  -- (trainings_read: is_approved_user())
  IF NOT EXISTS (SELECT 1 FROM public.trainings WHERE "mainTrainerId" = OLD.id) THEN
    RETURN NEW;
  END IF;
  -- anon may not call is_exam_manager(); it is never the TK anyway
  IF current_user = 'authenticated' THEN
    IF public.is_exam_manager() THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'only the TK changes the e-mail of a main trainer'
    USING ERRCODE = '42501',
          HINT = 'member ' || OLD.id || ' is main trainer of a training; my_member_ids() finds '
                 || 'members by e-mail, so the TK (is_exam_manager()) changes it (docs/TRAINING_PLAN.md).';
END;
$$;

COMMENT ON FUNCTION public.guard_main_trainer_email() IS
  'Trigger: through the API only the TK (is_exam_manager()) changes the e-mail of a member who is '
  'main trainer of a training (my_member_ids() finds members by e-mail); the owner, the service role '
  'and SECURITY DEFINER functions (integration_apply(), merge_members()) are not restricted '
  '(docs/TRAINING_PLAN.md).';

CREATE TRIGGER members_guard_main_trainer_email
  BEFORE UPDATE OF email ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.guard_main_trainer_email();

REVOKE EXECUTE ON FUNCTION public.guard_main_trainer_email() FROM PUBLIC, anon, authenticated;
