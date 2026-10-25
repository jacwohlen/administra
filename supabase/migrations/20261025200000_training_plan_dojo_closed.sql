-- Trainingsplanung: holidays do not always drop the adult trainings.
--
-- As in the club's agenda, school holidays only drop the kids' trainings;
-- the adults train on, the holidays are shown for orientation. Only when the
-- dojo is closed (Christmas, public holidays, bridge days) are the planned
-- trainings in the period dropped, unless a session holds them
-- (training_plan_sessions.cancelled = false). When periods overlap
-- (Karfreitag within the Frühlingsferien), the closing one wins; see
-- docs/TRAINING_PLAN.md.

ALTER TABLE public.training_plan_breaks
  ADD COLUMN cancels_training boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.training_plan_breaks.cancels_training IS
  'Dojo closed: planned trainings are dropped. False: school holidays, the adults train on';
