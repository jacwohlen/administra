-- Main trainer per training: some trainings (e.g. the kids' trainings) are
-- always led by the same trainer, others rotate and leave it empty. When a
-- trial candidate is assigned to a training with a main trainer, the
-- "training assigned" mail names that trainer with phone and e-mail, since
-- from then on the candidate deals with them directly.
--
-- Trainers are members; the contact details come from their member record.
-- Not part of get_trial_status(), so the public status page does not show
-- them.

ALTER TABLE public.trainings
  ADD COLUMN "mainTrainerId" integer
  CONSTRAINT trainings_main_trainer_id_fkey REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX trainings_main_trainer_id_idx ON public.trainings ("mainTrainerId");
