# Trainingsplanung (training plan)

The TK (technical committee) plans the adult trainings for the year: which
trainer leads which training, which topic is on, and which dates are dropped
for holidays or club events. Until now this lived in a shared Google Doc.

Under _Trainings → Trainingsplanung_ (`/dashboard/training-plan`) the plan
shows one calendar year (arrows switch the year), grouped by month:

- every date of every planned training, with trainer, topic and note
- holidays and breaks (orange band) and the trainings they drop
- Webling events (Anlässe) on the same day, and event days without training

Filters show single trainings or only dates whose trainer is still open;
_Einsätze pro Trainer_ counts the sessions each trainer leads, to keep the
rotation fair. _Drucken_ prints the shown list. A row links to the training's
check-in for that date, which in turn shows the plan (topic, trainer, or that
the training is cancelled).

## Planning

Only the TK edits (see _Roles_):

1. **Trainings & Ferien** – pick the trainings that are planned (usually the
   adult trainings) and enter the holidays and other breaks: a period with a
   name, or a single day (public holiday, big event) with the same from and
   to date. Every planned training in a break is dropped.
2. **Rotation** – fills a training's trainers in turn over a period. The
   order is a list of positions, each a trainer, _Trainer offen_ or _Kein
   Training_:
   - Monday, a different trainer every other week: `A, B`
   - Friday, only every other week: `A, Kein Training`, or
     `Trainer offen, Kein Training` when the trainer changes
   - each trainer for a month: `A, B` with _Termine pro Position_ 4

   _Ausfälle überspringen_ (default) continues with the next person after the
   holidays; without it the rotation follows the calendar weeks. Dates that
   already have a trainer or are cancelled stay as they are unless
   _Bestehende Einteilung überschreiben_ is ticked. The preview shows each
   date before anything is saved.

3. **Single dates** – the pencil edits trainer, topic, note and whether the
   training takes place. By default it follows the breaks; _Findet statt_
   holds a training even in the holidays (e.g. a training camp week), _Fällt
   aus_ drops it (e.g. the day of the club championship). Earlier topics are
   offered as suggestions.
4. **Several dates** – tick the rows and tap _Bearbeiten_ to set the trainer,
   a topic (e.g. a four-week block "Ne-waza") or the status for all of them;
   fields left on _unverändert_ stay as they are per date.

## Roles

| Who                      | Read | Edit |
| ------------------------ | ---- | ---- |
| Admin                    | yes  | yes  |
| TK (`exam_role=manager`) | yes  | yes  |
| Trainer, viewer          | yes  | –    |
| Member                   | –    | –    |

The TK is the same exam role as in the Q-Prüfungen (`docs/Q_EXAMS.md`), set
by admins in _Benutzer_. In the database the policies use
`is_exam_manager()`, in the app `canPlanTrainings` (`src/lib/roles.ts`).

## Data

- `training_plan_trainings` – the planned trainings
- `training_plan_sessions` – one row per training and date that has a plan
  (`trainer_id` → `members`, `topic`, `notes`, `cancelled`); dates without a
  row are simply "takes place, trainer open". `cancelled` is three-valued:
  `null` follows the breaks, `true` drops, `false` holds within a break.
  A row that ends up empty is deleted.
- `training_plan_breaks` – holidays and breaks (`date_from`–`date_to`,
  inclusive)

The trainings' dates are computed from their weekday
(`src/lib/trainingPlanUtils.ts`, also the rotation); nothing is generated in
the database, so a new year starts empty and changing a training's weekday
moves its dates. Trainers offered first are members labelled
_Erwachsenentrainer_ in Webling, main trainers of the planned trainings in
the last year and everyone already planned.
