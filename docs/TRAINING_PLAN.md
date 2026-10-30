# Trainingsplanung (training plan)

The TK (technical committee) plans the adult trainings for the year: which
trainer leads which training, which topic is on, and which dates are dropped
for holidays or club events. Until now this lived in a Google Sheet (one row
per day: KW, Tag, Datum, Trainingstyp, Von, Bis, Leiter, Thema, Info /
Bemerkung), which the Daten-Assistent can read in (see _Import_).

Under _Trainings → Trainingsplanung_ (`/dashboard/training-plan`) the plan
shows one calendar year (arrows switch the year), grouped by month:

- every date of every planned training, with trainer, topic and note; a
  training with a main trainer (e.g. Wednesday Randori) shows them unless
  someone else is planned
- holidays: grey band for school holidays (the adults train on), orange band
  when the dojo is closed and the trainings it drops
- Webling events (Anlässe) on the same day, and event days without training;
  a multi-day event (camp, course weekend) is a band from its first day and
  shows on every training it covers, also one that began in December of the
  year before

Filters show single trainings or only dates whose trainer is still open;
_Einsätze pro Trainer_ counts the sessions each trainer leads, to keep the
rotation fair. _Drucken_ prints the shown list. A row links to the training's
check-in for that date, which in turn shows the plan (topic, trainer, or that
the training is cancelled).

## Planning

Only the TK edits (see _Roles_):

1. **Trainings & Ferien** – pick the trainings that are planned (usually the
   adult trainings) and enter the holidays: a period with a name, or a single
   day (public holiday, bridge day) with the same from and to date. As in the
   club's agenda, school holidays only drop the kids' trainings; tick _Dojo
   geschlossen_ for Christmas and public holidays, which drops every planned
   training in the period. Holidays from Webling (see _Data_) are listed with
   their source: only _Dojo zu_ can be changed, they cannot be deleted.
2. **Rotation → Trainer** – fills a training's trainers in turn over a
   period. The order is a list of positions, each a trainer, _Trainer offen_
   or _Kein Training_:
   - Monday, a different trainer every week: `A, B, C, D`
   - only every other week: `A, Kein Training`
   - each trainer for a month: `A, B` with _Termine pro Position_ 4
3. **Rotation → Themen** – the same for topics: Friday one technique for two
   dates (`Seoi-Nage, Uchi-Mata, …` with _Termine pro Position_ 2 and _Teile
   nummerieren_: "Seoi-Nage, Teil 1", "Seoi-Nage, Teil 2"), Monday a topic
   for four weeks (_Termine pro Position_ 4, without numbers). Trainers and
   cancellations stay as they are.

   In both, _Ausfälle überspringen_ (default) continues with the next
   position after a dropped date; without it the rotation follows the
   calendar weeks. Dates that already have a trainer (or a topic) or are
   cancelled stay as they are unless _Bestehende Einteilung überschreiben_ is
   ticked. The preview shows each date before anything is saved.

4. **Single dates** – the pencil edits trainer, topic, note and whether the
   training takes place. By default it follows the holidays; _Findet statt_
   holds a training even when the dojo is closed, _Fällt aus_ drops it (e.g.
   GV, trainers' meeting, the day of the club championship). Earlier topics
   are offered as suggestions.
5. **Several dates** – tick the rows and tap _Bearbeiten_ to set the trainer,
   a topic or the status for all of them; fields left on _unverändert_ stay
   as they are per date.

## Import

_Trainings & Ferien → Bestehenden Plan einlesen → Trainingsplan einlesen_
opens the Daten-Assistent (`docs/AI_ASSISTANT.md`, kind `training_plan`):
a photo, a PDF or a table of the plan, also rows copied straight from the
Google Sheet. Read it **one month at a time** (copy that month's rows with
the header row): a whole year is too long for one reading, which has to
finish within the function's time limit. Claude reads it into a proposal,
the review shows every session and holiday against what is planned, and
only what the TK confirms is saved:

- each row goes to the planned training of its weekday (by the type's name
  when a weekday has several); rows on weekdays without a planned training
  are left out, and the warnings say how many
- _Leiter_ are matched to members by name ("Beni Muster" also finds Benjamin
  Muster, to confirm); names without a member (guest trainer, "Gesamt
  Trainersitzung") stay in the note
- _Thema_ becomes the topic; another training type than the training's own
  ("freies Training", "Heimkampf") becomes the topic too, with the _Thema_
  after a colon
- "kein Training" or an empty _Trainingstyp_ cancels the training; the info
  says why (Karfreitag, Brückentag nach Auffahrt, GV JACW). "kein Training"
  as _Leiter_ only means no leader
- holidays in the info (… ferien, Weihnachten) are offered as holidays, with
  or without _Dojo zu_; a holiday Webling already brings (same dates, or the
  same name over overlapping dates) is shown as _Synchronisiert_ and never
  added again

Unlike the former sheet import, what is already planned is not replaced
without asking: a session that contradicts the plan is only written when
ticked. Without `PRIVATE_ANTHROPIC_API_KEY` there is no import; the plan is
then entered in the table.

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
  row simply take place with the training's main trainer (or trainer open).
  `cancelled` is three-valued: `null` follows the holidays, `true` drops,
  `false` holds even when the dojo is closed. A row that ends up empty is
  deleted.
- `training_plan_breaks` – holidays (`date_from`–`date_to`, inclusive);
  `cancels_training` marks the dojo closed. When periods overlap (Karfreitag
  within the Frühlingsferien), the closing one wins.

The trainings' dates are computed from their weekday
(`src/lib/trainingPlanUtils.ts`, also the rotation); nothing is generated in
the database, so a new year starts empty and changing a training's weekday
moves its dates. Trainers offered first are members labelled
_Erwachsenentrainer_ in Webling, main trainers of the planned trainings in
the last year and everyone already planned.

Webling holds the holidays too (calendar "Ferien und Feiertage"). Since
integrations phase 4 (`docs/INTEGRATIONS.md`, "End dates and holidays")
the Webling sync on the integration layer brings them as holidays
(`connection`, `external_id`): a period of up to three days closes the dojo,
a longer one is school holidays, and a TK entry with the same name and
dates is taken over. Their title and dates are Webling's (read-only, no
delete); "Dojo zu" stays the TK's and later runs never change it.
