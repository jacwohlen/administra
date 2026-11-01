# Trainingsplanung (training plan)

The TK (technical committee) plans the adult trainings for the year: which
trainer leads which training, which topic is on, and which dates are dropped
for holidays or club events. A trainer who is a planned training's main
trainer plans that training's dates themselves (see _Roles_). Until now this
lived in a Google Sheet (one row per day: KW, Tag, Datum, Trainingstyp, Von,
Bis, Leiter, Thema, Info / Bemerkung), which the Daten-Assistent can read in
(see _Import_).

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
the plan into a calendar app (see _Kalender abonnieren (ICS)_), and
_Trainer informieren_ mails the trainers what changed for them (see
_Trainer informieren (E-Mail)_). A row links
to the training's check-in for that date, which in turn shows the plan
(topic, trainer, or that the training is cancelled).

That is the view _Übersicht_; _Pro Training_ shows the plan as a table to
fill in (see _Planning_).

## Planning

The TK edits everything below; a main trainer plans the dates of their own
trainings with steps 2 to 6 (see _Roles_):

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
6. **Pro Training** – the view to fill in like a spreadsheet: a row per
   date with trainer, topic, note and _Fällt aus_, and every cell saves on
   its own. Enter and the arrow keys move down a column; a column copied
   from Excel or Google Sheets fills the rows below when pasted. The chips
   above pick the trainings, several at once: Monday and Friday give one
   table Mo, Fr, Mo, Fr, … (by date and start time, as in the overview),
   and each row then names its training, so two trainings on the same day
   (Friday kids and adults) stay apart. The last picked training cannot be
   unpicked. The choice stays for the next visit in this browser, and
   picking keeps what is being typed. Leaving the table, or opening
   _Rotation_, saves it and reloads the plan; until the reload is in, the
   table is read-only and the rotation does not apply, so neither writes
   back the plan from before. Viewers and trainers see the table read-only;
   a main trainer edits the rows of their own trainings, the other trainings'
   rows show a lock, and Enter, the arrow keys and pasting skip them.

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

## Trainer informieren (E-Mail)

Planners tell the trainers about changes by e-mail, by hand: _Trainer
informieren_ on the plan page, for the TK (every training) and for main
trainers (their own trainings), only while mails can be sent (SMTP
configured; outside production, e.g. on Dev and in the demo, sending is
simulated). A banner above the buttons says how many trainers have changes
they were not told yet; the dialog lists them with the lines of their mail.

What counts as a change, for each trainer against what they were last
told:

- a date they now lead (`Neu: Mo 10.11.2026 – du leitest`, with the topic
  when there is one) or no longer lead
  (`Nicht mehr bei dir: Mo 17.11.2026 – übernimmt Max Muster`, or
  `– Trainer offen`, `– fällt aus`, or nothing when the date no longer
  exists)
- a date they lead is dropped (`Fällt aus: Mo 24.11.2026 (Herbstferien)`,
  the holiday closing the dojo as the reason; a date cancelled on its own
  has none, since notes are never mailed) or takes place again
  (`Findet wieder statt: Mo 1.12.2026 – du leitest`)
- becoming or no longer being a training's main trainer; the new main
  trainer gets an overview (leads every date, except the dates someone else
  leads or that are dropped, every one of them listed anew, also dates they
  heard of as a substitute)
- a training's weekday or time
  (`Neu am Mittwoch 18:30–20:00 (bisher Montag 18:00–19:30).`): for the
  main trainer the dates move with it, a substitute's dates on the old
  weekday each get `Nicht mehr bei dir`
- a training taken out of the plan, or deleted
  (`Dieses Training ist nicht mehr im Trainingsplan.`)

Not a change: the topic alone (it is only added to dates listed anyway),
notes (never in a mail, not even loaded for it), past dates, and whether a
date someone else leads is cancelled. More than 6 lines of one kind per
training become one line that still names every date
(`Neu: du leitest 14 Termine: 3.11., 17.11., …`: for a trainer without the
app the mail is all they have), two or more dates dropped by the same
holiday one line (`Fällt aus (Herbstferien): 6.10., 13.10.2026`; more than 6
weekly dates without a gap as `8 Termine vom 6.10.2026 bis 24.11.2026`).
A mail has every line: what it left out would be stored as told all the
same.

There is no change log and no trigger on the plan. Per member the database
keeps what they were last told, and `src/lib/trainingPlanMail.ts` compares
it with the plan as it is now, by the rules of the plan page and the feeds
(`buildPlan()`): per training whether they were told as its main trainer or
for single dates, with the weekday and times they were told
(`training_plan_told_trainings`), and per date only the exceptions
(`training_plan_told`): a main trainer's dates that someone else leads
(`not_lead`) or that are dropped (`cancelled`), a substitute's dates they
lead (`lead`, or `cancelled` when dropped). A main trainer's ordinary weekly
dates need no row, so a new year costs nothing. Dates from today
(Europe/Zurich) up to 400 days ahead are compared; one planned further
ahead shows up once it is inside. Typing in the table, changes that cancel
each other out, holidays from Webling, a new main trainer, a member deleted
or merged: all of it comes out of the same comparison. A trainer told
nothing yet gets the overview of their dates the first time (subject
_Übersicht_), worded as an overview, not as news: `Du bist Haupttrainer/in
und leitest alle Termine`, `Du leitest: Di 10.11.2026`.

- **Who sends**: the TK for every training, also for trainings taken out of
  the plan; a main trainer for their own planned trainings (their dialog,
  and what they write, covers only those). The sender's own members
  (`my_member_ids()`: the linked member, and members with the account's
  e-mail, e.g. a parent's children) are never mailed; what they were told is
  updated silently with each mail or marking. Viewers and other trainers do
  not see it.
- **Addresses**: the sign-in address of the approved account linked to the
  member (_Benutzer_), else the member's e-mail (from Webling); a member
  whose own address is a test address (`*.invalid`) keeps it even with a
  linked account, so they are never mailed, not even at that account's
  real address. Members sharing an address (a family) get one mail with a
  section each. Not
  mailed, and listed under _Nicht per Mail_ with the reason: no address, a
  test address (`*.invalid`, the anonymized addresses of databases other
  than production) and trainers who want no mails. The TK switches mails
  off per trainer in the dialog (_Keine Mails_). These trainers stay
  pending, in the banner too, until someone tells them in person and marks
  them.
- **The dialog**: opening it lets the table save what is being typed and
  reloads the plan first, as the rotation does, so the preview has it. One
  card per address with the lines (_Mail ansehen_ shows the whole mail),
  checked by default for sending. _Mails senden_ sends the checked cards
  one after the other, one request per address (a Netlify function's time
  limit; the mailer opens one connection per mail). Marking without a mail,
  for trainers told in person or informed otherwise, is a separate choice:
  _Ohne Mail als mitgeteilt markieren_ on a mail card marks that card, and
  _Als mitgeteilt markieren_ in the footer marks the ticked cards under
  _Nicht per Mail_ and mails that left but were not saved as told, never a
  mail card that was not sent. While nobody has been told yet, the dialog
  says that sending gives everyone an overview, and _Alle als mitgeteilt
  markieren_ (after a confirmation) takes the plan as known instead (e.g.
  when the trainers have it as a spreadsheet): from then on only changes go
  out. Each card shows its status: _Gesendet_, _Fehlgeschlagen_ (with the
  SMTP error), _Unklar, ob
  gesendet_ (the request timed out or the connection dropped, so the mail
  may have left: the card stays in view, unchecked, and the toast names
  whom to ask), _Gesendet, aber nicht als mitgeteilt gespeichert_ (then
  mark it). Such a mail's log row stays `pending`, and the dialog reads the
  newest one per trainer: a `pending` row newer than what they were last
  told leaves their card unchecked, with the time of that mail, also when
  the dialog is opened again later, until they are sent to on purpose or
  marked. _Letzte Mails_ shows the last 20 entries of the log.
- **The server** (`/api/training-plan/notify`): runs with the signed-in
  user's session, so row-level security decides. Nothing the mail says comes
  from the browser: the endpoint loads the plan and the told state again
  (`src/lib/trainingPlanMailData.ts`), recomputes the lines with the same
  code, looks up the address, and compares a fingerprint of the lines and
  the address with the preview's. A mismatch (the plan changed meanwhile)
  is a 409, and the dialog loads its preview again; so is an address or
  opt-out that changed since (400 `unreachable`, `several_addresses`). Only
  members with pending lines can be mailed, so the endpoint sends nothing
  else, and once mailed they are told. The log row is written before
  sending (`pending`) and then gets the result; after a mail went out (or
  was simulated) `training_plan_set_told()` replaces what the members were
  told, in one transaction. A mail cut off in between (Netlify ends the
  function, the connection drops) may have left without being stored as
  told; its `pending` row is part of the fingerprint, so a preview from
  before it (another planner's) is stale, and the dialog shows it (above)
  instead of sending it again by itself. `GET` says whether mails leave
  (`smtp`), are simulated (`demo`, `test`) or are off.
- **The mail**: plain text in the sender's app language (German or English,
  `src/lib/trainingPlanMailText.ts`), from the club's SMTP sender
  (`PRIVATE_SMTP_FROM`, `docs/TRIAL_EMAILS.md`), with `Reply-To` the
  sender's sign-in address, so questions go to the planner. Subject
  `{club} – Trainingsplan: Änderungen für Max`; per training its title and
  time, then the lines; at the end that the plan in the app is binding
  (with the link), that subscribed calendars show changes only after a few
  hours, and that a reply goes to the sender.
- **Production only**: plan mails leave only under `PUBLIC_MODE=PROD`, as
  JAC Wohlen's production and every club instance run
  (`planMailMode()` in `src/lib/server/mailer.ts`). The demo
  (`PUBLIC_MODE=DEMO`, the mailer never sends there) and, with SMTP set,
  every other build, such as Dev (main.admin.jacwohlen.ch, `PUBLIC_MODE=DEV`,
  which has the club's SMTP server for the trial mails), simulate: the
  dialog and the banner say so, the told state is saved and the log says
  _Nicht gesendet_, so the whole flow can be tried. Dev's members are
  anonymized (`*.invalid`), but an account an admin links to one there has
  a real sign-in address: simulating, and the test address winning over
  the account's, both keep it silent. Deploy previews and local development
  have no `PRIVATE_SMTP_*`: no button, no banner. To try real sending
  locally, run with `PUBLIC_MODE=PROD` and an SMTP sink such as Mailpit
  (sign in with the e-mail code, as `PROD` has no password form).
- **Limits**: one trainer per date, so co-trainers written in the note are
  not told; sending is by hand only (nothing scheduled); no WhatsApp or SMS;
  trainers answer only by replying to the mail.

## Roles

| Who                           | Read | Edit                                  | Sets main trainers (and their e-mail) | Trainer informieren           |
| ----------------------------- | ---- | ------------------------------------- | ------------------------------------- | ----------------------------- |
| Admin                         | yes  | yes                                   | yes                                   | every training, sets opt-outs |
| TK (`exam_role=manager`)      | yes  | yes                                   | yes                                   | every training, sets opt-outs |
| Main trainer (role `trainer`) | yes  | every date of their planned trainings | –                                     | their planned trainings       |
| Other trainers, viewers       | yes  | –                                     | –                                     | –                             |
| Member                        | –    | –                                     | –                                     | –                             |

The TK is the same exam role as in the Q-Prüfungen (`docs/Q_EXAMS.md`), set
by admins in _Benutzer_. In the database the policies use
`is_exam_manager()`, in the app `canPlanTrainings` (`src/lib/roles.ts`).

A main trainer is an account with a writing role (`is_writer()`: trainer;
admins plan everything anyway) whose member is the main trainer of a
training in the plan (`trainings."mainTrainerId"`, the member found as for
_Mein Profil_: `my_member_ids()`). They plan every date of that training:
trainer or substitute, topic, note, _Fällt aus_ and _Findet statt_ (also a
date in a closing break), with the pencil, several dates at once, the
rotation and the table; a note on the plan page names their trainings.
Holidays, which trainings are planned (_Trainings & Ferien_) and the import
stay with the TK. A viewer who is main trainer only reads, and so does the
main trainer of a training not in the plan.

Since the main trainer decides who plans a training, only the TK sets,
changes or clears it (_Trainings → Bearbeiten → Haupttrainer/in_). Other
trainers see the field read-only with a note that the TK sets it, and the
form leaves it out, so their other changes to the training still save; a
new training starts without main trainer. Everything else about trainings
stays with trainers and admins (`is_writer()`), so the TK sets main trainers
with a trainer or admin account (a viewer who is TK edits no trainings).

In the database the trigger `trainings_guard_main_trainer`
(`guard_training_main_trainer()`, migration `20261108120000`) refuses, for
an API caller (`authenticated`, `anon`) who is not `is_exam_manager()`, an
insert with a main trainer and an update that changes it (`42501`, "only
the TK sets the main trainer of a training"); an upsert is checked as both,
so one that sends a main trainer is refused even when the value does not
change; a plain update that writes the same value again passes (the
previous release's edit page sends every field). Not restricted, as in the
other guards: migrations, seeds and checks (the owner), the service role,
`merge_members()` (SECURITY DEFINER: moves the main trainer to the kept
member) and deleting a member, which clears it (`ON DELETE SET NULL` runs
as the owner of `trainings`), whoever may delete members. The app shows the
field editable for `canPlanTrainings`; the trigger stays the guard
(`supabase/checks/training_plan.sql`, section R).

`my_member_ids()` also finds an account's members by e-mail, so the e-mail
of a main trainer decides as much as the main trainer: a trainer who pointed
it at their own account's address, or an accomplice's, would plan that
training. So the e-mail of a member who is main trainer of a training (any
training, since the TK may plan it later) is changed only by the TK too;
for a Webling member it is read-only in the app anyway (`field_policy`).
The trigger `members_guard_main_trainer_email` (`guard_main_trainer_email()`,
same migration) refuses it for an API caller who is not
`is_exam_manager()` (`42501`, "only the TK changes the e-mail of a main
trainer"; the member page says so). The same address written again passes
(compared as `my_member_ids()` does, ignoring case and spaces), and so does
the e-mail of a member who is main trainer of nothing. Not restricted, as
above: the owner, the service role, the Webling sync (`integration_apply()`)
and `merge_members()` filling the kept member's e-mail. Left open, as
practically harmless: a trial record carrying an account's e-mail counts
once its trial label is removed; that matters only if the TK made a trial
record main trainer, which the edit page does not offer.

In the database `my_main_training_ids()` returns the planned trainings
whose main trainer is one of the account's members, and nothing without a
writing role; the insert, update and delete policies of
`training_plan_sessions` allow `is_exam_manager()` or a `training_id` in
it (an update in both `USING` and `WITH CHECK`, so a date cannot be moved
to another training). Holidays and the planned trainings stay
`is_exam_manager()` only. The plan page asks for it once per load
(`plannableIds` in `+page.ts`, only for trainers who are not TK; TK: all
trainings) and shows the edit controls per training; RLS stays the guard.

Plan mails (_Trainer informieren_) follow the same split. All staff read
what was told and the opt-outs, as they read the plan; the told state is
written by the TK for every training (also one no longer planned) and by a
main trainer for `training_id IN my_main_training_ids()`; only the TK sets
opt-outs. The mail log is read by the TK and by whoever wrote the row
(`is_staff()` and `is_exam_manager()` or `created_by`); a planner inserts
only rows of their own (`pending` or `marked`) and only moves their own
`pending` rows to `sent`, `failed` or `skipped`. The TK may be a viewer with
the exam role, so nothing here asks for `is_writer()`.
`training_plan_mail_addresses()` answers planners only, for the members
involved in what they plan. `supabase/checks/training_plan_mail.sql` checks
it per role.

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
- `training_plan_told_trainings` – per member and training, what they were
  last told (_Trainer informieren_): as main trainer (`is_main`) or for
  single dates, with the title, weekday and times told. No foreign key to
  `trainings`, so a deleted training still gives "nicht mehr im
  Trainingsplan"
- `training_plan_told` – per member, training and date, only the exceptions
  from today on (`lead`, `cancelled`, `not_lead`); they go with their
  training row (delete, merge)
- `training_plan_mail_optouts` – trainers who get no plan mails
- `training_plan_mails` – the log: one row per member per mail or marking
  (`pending`, `sent`, `failed`, `skipped`, `marked`), with address, subject,
  text and error
- `training_plan_mail_addresses(p_member_ids)` – where a trainer gets mail:
  the sign-in address of the linked approved account, else `members.email`;
  a `*.invalid` `members.email` wins over the account's.
  SECURITY DEFINER, as `user_profiles` is for admins only; it answers
  planners only, and only for members involved in what they plan (main
  trainers of the planned trainings, trainers of dates from today on,
  members with a told state). Listed with its guard in
  `supabase/checks/member_data.sql`
- `training_plan_set_told(p_states)` – replaces what the given members were
  told about the given trainings, in one transaction and under row-level
  security (one refused row fails the whole call); dates before today are
  dropped. Merging two members moves their told state, opt-out and log to
  the kept one (`docs/INTEGRATIONS.md`)

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
