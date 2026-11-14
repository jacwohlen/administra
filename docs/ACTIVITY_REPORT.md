# Einsätze (activity report)

Admins open _Einsätze_ in the avatar menu (`/dashboard/reports`). For a
period (from / to, presets for this year, last year and the half years) it
shows per person:

- **Trainings als Trainer** – dates checked in as main trainer
  (`logs."trainerRole" = 'main_trainer'`)
- **Trainings als Hilfstrainer** – dates checked in as assistant
- **Coaching-Tage** – days coached at events (`event_logs."isCoach"`)

and downloads it as a **PDF** (`src/lib/pdf.ts`, a small writer with the
standard Helvetica fonts): the summary, the dates to check, every training
with its trainers and every coaching assignment. It replaced the trainer
download of the statistics page, whose button now opens the report for the
year shown. The wording stays neutral: what the club does with the numbers
is not the app's business.

## What counts

- **Trainings** count from the check-in, once per person, training and
  date. Whoever is checked in as trainer trained, so a _Vertretung_ or a
  _Tausch_ (`training_plan_requests`) counts for the person who actually
  came, not for the one first planned.
- **Coaching days**: every day of an event within the period (a camp from
  Friday to Sunday is three days, clipped to the period) at which the
  person is checked in as coach. A half day (`event_logs."coachDay" =
'half'`) counts 0.5 per day; without that column every day is full. Two
  events on the same day count once (the larger share).
- **Zu prüfen**: planned dates (`buildPlan()`, trainings in
  `training_plan_trainings`) up to today, not cancelled, whose check-in has
  no main trainer: held without one marked, or with a plan entry but no
  check-in at all. They do not count; the list names the trainer the plan
  has (after substitutes and swaps) so an admin can add them in the
  check-in.

Everything is computed in the browser under RLS
(`src/lib/activityReport.ts`, load in
`src/routes/dashboard/reports/+page.ts`); there is no migration.
