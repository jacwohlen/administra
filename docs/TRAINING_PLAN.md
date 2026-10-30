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
rotation fair. _Drucken_ prints the shown list, _Kalender abonnieren_ puts
the plan into a calendar app (see _Kalender abonnieren (ICS)_). A row links
to the training's check-in for that date, which in turn shows the plan
(topic, trainer, or that the training is cancelled).

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

## Kalender abonnieren (ICS)

Every staff account (viewer, trainer, admin: `is_staff()`) can subscribe to
the plan in its calendar app. _Kalender abonnieren_ on the plan page shows
two feeds, each as a link to copy (Google "From URL", Outlook "Subscribe
from web"), to open in the device's calendar app (`webcal://`, Apple
Calendar, Outlook) or in Google Calendar:

- **Meine Trainings** – the dates the account's member leads: the planned
  trainer, else the training's main trainer (`trainerId` of `buildPlan()`).
  Cancelled dates the member would have led stay in. The member is found
  as for _Mein Profil_ (the linked member, or one with the account's
  e-mail: `my_member_ids()`); an account without one gets no link but a
  hint, and an admin links it in _Benutzer_.
- **Alle Trainings** – every date of every planned training.

Both hold what the plan page shows, computed the same way (`buildPlan()` in
`src/lib/trainingPlanUtils.ts`) from 8 weeks back to 12 months ahead
(Europe/Zurich): one event per date, no repeat rule, so trainer, topic and
cancellation can differ per date. Events of the club (Anlässe) are not in
the feeds.

- Title: in _Alle Trainings_ `Judo Randori: Uchi-mata – Anna Muster`
  (without a topic `Judo Randori – Anna Muster`, without a trainer _Trainer
  offen_), in _Meine Trainings_ `Judo Randori: Uchi-mata`.
- Cancelled dates stay visible, with `Fällt aus: ` in front and the reason
  in brackets: the note when the date itself is cancelled, else the holiday
  closing the dojo (`Fällt aus: Judo Randori (Weihnachten)`). They are not
  marked cancelled for the calendar app (`STATUS:CANCELLED`): Google hides
  such events. Instead they count as free time.
- Description: topic, trainer (_Leitung_), note, the holidays the date
  falls in when they do not drop it (`Ferien: Herbstferien`) and the link to
  the training's check-in for that date (also the event's URL).
- Time: the training's start and end (90 minutes without an end time),
  all day without a start time. _Meine Trainings_ shows held dates as busy,
  _Alle Trainings_ everything as free, so it does not block the calendar.
- Language: the app's language when the link was taken (feed `meine` /
  `alle` German, `mine` / `all` English); switching the language and
  copying again gives the other one. The calendar is named after the feed
  and the club name from the settings (_Alle Trainings (…)_).

Changes in the plan reach the calendar when the app fetches the feed
again. The feed asks for every 6 hours (`REFRESH-INTERVAL`,
`X-PUBLISHED-TTL`), but each app has its own schedule: Apple Calendar on
the Mac lets the user pick the interval, Outlook.com fetches about every 3
hours (at times more than a day later), Google every 8 to 24 hours or less
often, and neither can be pushed.

The link is secret: whoever has it sees the plan with the trainers' names,
without signing in. _Link erneuern_ (after a confirmation) gives the
account a new token, the old links stop working (404), and calendars
subscribed with them no longer update until they are subscribed again. A
disabled account, or one that is no longer staff, gets 404 too.

- `calendar_feeds` – one token per account (64 hex characters, user id as
  key); RLS without policies and no grants, so no API role reads it
- `calendar_feed_token(p_renew)` – the caller's token, created on first use
  and replaced with `p_renew`; staff only
- `calendar_feed(p_token)` – what a feed needs while the token's account is
  approved staff (else NULL): its member ids (the same rule as
  `my_member_ids()`), the planned trainings, their sessions and the
  holidays from 70 days back to 400 days ahead, and the trainers' names.
  Granted to `anon`, since calendar apps send no session; the token is the
  only key
- `/api/calendar/<token>/<feed>.ics`
  (`src/routes/api/calendar/[token]/[feed].ics/+server.ts`) builds the file
  with `src/lib/calendarFeed.ts` and `src/lib/ics.ts`: 404 for a malformed
  or unknown token and an unknown feed name, 503 when the database does not
  answer (never an empty calendar, which would wipe the trainings of every
  subscriber until the next fetch). Sentry reports get the token removed
  from the path (`docs/ERROR_MONITORING.md`)

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
