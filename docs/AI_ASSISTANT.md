# Daten-Assistent (AI import)

Getting a club into Administra means typing in years of paper: kyu
gradings from Judo passes, attendance lists, the training plan, lesson
plans, club dates. The _Daten-Assistent_ reads a photo, a PDF or pasted
text with Claude (Anthropic) and turns it into a proposal; the user checks,
completes and corrects it, and only then is it saved.

| Kind                       | Where                                   | Saved to                                         | Who                            |
| -------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------ |
| **Judo-Pass einlesen**     | member page → _Graduierungen_           | `member_grades`                                  | trainers, admins (`is_writer`) |
| **Präsenzliste einlesen**  | check-in page of a training and date    | `logs` (`set_attendance`), `participants`        | trainers, admins               |
| **Trainingsplan einlesen** | _Trainingsplanung → Trainings & Ferien_ | `training_plan_sessions`, `training_plan_breaks` | the TK (`is_exam_manager`)     |
| **Lektionsplan einlesen**  | check-in page → _Lektionsplan_          | `lesson_plans`                                   | trainers, admins               |
| **Termine einlesen**       | _Anlässe_                               | `events`                                         | trainers, admins               |

On these pages the assistant is the small wand attached to the page's own
create button (_Prüfung erfassen_, _Event erstellen_, _Lektionsplan
erstellen_ or _Bearbeiten_), so it takes no extra room. Where there is no
create button it stays out of the way: a quiet _Liste einlesen_ next to
the attendance count on the check-in page. The training plan has no manual
import, so there the assistant is a labelled button, _Trainingsplan
einlesen_ under _Bestehenden Plan einlesen_. Without the API key only the
create buttons show, and the training plan has no import. The overview
`/dashboard/assistant` (avatar menu → _Daten-Assistent_) explains the steps
and leads to these pages: pick a member or a training and date there, and
the target page opens the assistant right away (`?assistant=<kind>`).

## How it is used

1. **Upload**: up to 4 photos (on a phone _Foto aufnehmen_ opens the
   camera; the button only shows on touch screens), a PDF, pasted text or a
   `.txt`/`.csv` file, plus an optional hint ("the second column is the
   leader"), folded away behind _Hinweis für die Auswertung_. Photos are
   scaled down to 2000 px and re-encoded as JPEG in the browser, which also
   drops EXIF data such as the location. Text can also be **dictated** with
   the microphone beside the text field (see _Dictation_). The form is
   narrow; the dialog widens for the review tables.
2. **Auswerten**: the server sends it to Claude, which answers with a
   proposal in a fixed format. This takes 10 to 40 seconds.
3. **Review**: every row with its status (_Neu_, _Schon erfasst_,
   _Abweichend_, _Unvollständig_, _Doppelt_). Values the model was unsure
   about are marked with its remark; names are matched to members in the
   browser (see _Name matching_), unclear matches are left for the user to
   confirm or pick. Missing values
   can be filled in and wrong ones corrected right there; contradictions
   with what Administra already has (another date for a grading, a
   different trainer on a planned date, an event that already exists) are
   shown side by side and never overwritten without an explicit tick.
4. **Übernehmen**: only now is anything written, by the browser, through
   the same tables and with the same permissions as the manual forms. If
   some rows fail, the review stays open with them marked, so they can be
   retried without a new reading.

### Dictation

_Diktieren_ turns speech into text in the dialog's text field, e.g.
"Anwesend: Lena Müller, Tim Weber; Leitung Beni Keller" or "5. Kyu am 12.
Juni 2019". The text can be read and corrected there and is then read
like pasted text; the prompt tells the model that dictated text may spell
out numbers and dates and spell names by ear.

The language follows the app's: Swiss Standard German (`de-CH`, no
dialect) or English, and the dialog names it while listening. Names from
another language are written by ear («Hunter» can come out as «unter»);
name matching then preselects the closest member (here Alexander Hunter)
for the user to confirm.

Chrome on Android (up to version 157) sends every guess of the speech so
far as a final result without confidence («unter», «unter alexander»,
«Hunter Alexander ist», …), and later guesses revise earlier words. So
`dictationSession()` keeps a session's whole text: separate phrases (desktop
Chrome, Edge, Safari) are joined as they come, a guess replaces the
previous one. The field shows that text live and is read-only while the
microphone is on, so a replaced guess never overwrites typing.

The Claude API takes no audio, so the speech recognition is the browser's
own (Web Speech API, `src/lib/assistant/dictation.ts`): no key and no cost,
but Chrome and Edge send the audio to Google or Microsoft, Safari
recognises on the device or with Apple; the dialog says so while
listening. Firefox has none, the button is hidden there. On phones the
keyboard's own microphone works in the text field too. The microphone is
allowed for the app's own pages only (`Permissions-Policy:
microphone=(self)`, docs/SECURITY_HEADERS.md), and the browser asks before
the first use.

### Name matching

A member is taken without asking only when the name on the document is
exactly theirs: last name and first name as recorded (ignoring case,
accents and ü/ue), or, for someone on the training's roster or a plan
trainer, the exact last name with the first name's initial ("L. Müller").
Everything else is a suggestion the user confirms (one click, or all
roster suggestions at once): a similar last name ("Meier" for Meierhans or
Maier), a short or similar first name ("Beni" for Benjamin, "Jan" for
Janine, "Martin" for Marcel — it may be a guest sibling), a last-name
initial ("Lena M."), a first name alone. Two members with the same name
are never chosen automatically; the one on the roster is suggested first.

## Per kind

**Judo-Pass** (member page, _Graduierungen_). Each grading of the pass is
mapped to the section's grade ladder: the model's grade if it is on the
ladder, else the number or belt colour as written ("5 Kyu", "Gelbgurt",
"weiss-gelb" is _5.5 Kyu_, "Shodan"); anything unclear is picked by hand.
Compared with the member's gradings (one per section and grade): _Neu_ is
saved by default, _Schon erfasst_ is skipped, _Abweichend_ (recorded with
another date) is only corrected when ticked. A date the pass only shows in
part (2015) has to be completed. Warnings for a date before the birthday,
an unusual order of the grades, and a Dan grade (it becomes the current
belt and awards the _Schwarzgurt_ badge, unless the member already holds
it). When the name printed in the pass is not exactly the member's first
and last name, or the birthday differs, saving needs an explicit "yes, this
is X's pass". A pass whose section is unclear is reviewed on the Judo
ladder; the section can be changed at the top. The member record itself is never changed: names and birthdays
come from Webling. Note: _Judo-Pass_ plus the examiner.

**Präsenzliste** (check-in page). A list of one session goes to the date
written on it when that is a valid date of the training, otherwise to the
page's date (the review says so when it differs from the page); a grid
with several dates gets one column per date, each checked: impossible and future dates are left out, a date on another
weekday than the training only when ticked, a cancelled date is flagged.
Names are matched against the club's members, the training's roster first;
a clear match is preselected, a probable one must be confirmed, the rest is
picked, created as a new member (marked _new_, like on the check-in page)
or left out. Former members and trial candidates not on the roster always
need a confirmation. People not on the roster are added to it. Existing
check-ins are never removed, and a different role is only overwritten when
ticked.

**Trainingsplan** (_Trainingsplanung → Trainings & Ferien_). It replaces the
former Google Sheet import: a copied sheet (one row per day: KW, Tag, Datum,
Trainingstyp, Von, Bis, Leiter, Thema, Info / Bemerkung) is pasted like any
table, one month at a time, and the prompt carries the sheet's rules (rows
on weekdays without a planned training are left out and counted in the
warnings, «kein Training» as _Trainingstyp_ is a cancellation with the
leader and the info as note, another training type is the topic, holidays
in the info go to the holidays). A table of more than about two months is
read only for its first two, with a warning, so a pasted year does not run
into the time limit. Every session
is checked against the planned trainings (right weekday) and compared with
the plan: _Neu_ and sessions that only fill empty fields are saved,
_Schon erfasst_ is skipped, sessions that would replace a planned trainer,
topic, note or cancellation only when ticked. A training the model could
not name but that is the only one on that weekday has to be confirmed, and
a row whose training the document names wins its date. Leaders are matched
to members (see _Name matching_); an unmatched name stays in the note and
the trainer stays open. Holidays can be taken over with or without _Dojo
zu_; ones that overlap recorded holidays are not preselected, and a closed
period over recorded school holidays is flagged. Recorded holidays are read
again right before saving, so a retry never adds one twice.

**Lektionsplan** (check-in page, _Lektionsplan_). The plan is turned into
the editor's format (`## Aufwärmen`, `- Übung`) and can be edited before
saving. An existing text plan is extended by default and replaced only
when the user picks _ersetzen_; an attached file is only replaced after an
explicit tick, and deleted from
storage only once the text is saved. A document with another date than the
page needs a tick too.

**Termine** (_Anlässe_). One event per date, with section, times and place;
a multi-day event gets its last day (`date_to`); an end time before the
start time is only a warning (overnight events). Events similar to an existing event
within a day (also ones synced from Webling) are marked _Doppelt_ and not
created unless ticked; the review loads the existing events of the period
itself and saves only once they are loaded.

## Safety

The assistant is built so that the model cannot do anything but propose
values:

- **No tools, no database.** The model gets the material and a task, and
  can only answer with JSON in the schema of that kind
  (`src/lib/server/assistant/schemas.ts`, structured outputs). It has no
  tools, cannot call anything and never sees the Supabase session.
- **Text in the material is data.** The system prompt
  (`src/lib/server/assistant/prompts.ts`) says so; text in a photo that
  tries to give instructions ends up as a warning in the review at most.
  The user's hint is passed in its own tag and cannot change the task.
- **Every answer is checked again** on the server
  (`src/lib/assistant/proposals.ts`): unknown fields are dropped, strings
  are cleaned and capped, invisible and bidi control characters and
  spreadsheet formula prefixes (= + - @) removed — the CSV downloads of
  the statistics defuse them too (`src/lib/csv.ts`) — dates and times must be real, list
  lengths are capped, and training keys are only accepted from the list the
  server gave the model. The review checks once more against the data the
  user can see. Model text is only ever shown as text, never as HTML or a
  link.
- **The model never picks a member.** It sees no member data at all: no
  names, no birthdays, no roster. Names on a list are matched to members in
  the browser (`src/lib/assistant/nameMatch.ts`) against the members the
  user may read; only clear matches are preselected.
- **Nothing is written by the server.** `/api/assistant` only returns the
  proposal. The browser saves what the user confirmed, under row-level
  security, with an explicit column list per table, so the assistant can
  never do more than the user could do by hand.
- **Role check and limits before every call.** `ai_import_begin(kind)`
  checks the same predicate as the target tables' RLS (`is_writer()`, or
  `is_exam_manager()` for the training plan) and allows 60 extractions per
  account and 300 for the whole club within 24 hours (constants in
  `ai_import_limits()`; change them with a new migration). Each request is
  logged in `ai_imports` (who, kind, outcome, tokens — no content).
- **Uploads are checked** on the server: at most 4 files of 3.5 MB
  together, only JPEG, PNG, WebP, GIF and PDF, recognised by their bytes,
  not their name, and at most 30,000 characters of text. A request with a
  PDF is counted first (free) and refused above 100,000 input tokens,
  about 30 to 60 pages, so a long rulebook cannot run up the bill.
- **No content in logs or Sentry.** The endpoint logs error codes only;
  Sentry is told not to collect request bodies, AI prompts and answers or
  local variables (`dataCollection` in `src/lib/sentry.ts`, see
  `docs/ERROR_MONITORING.md`).

## Privacy

The uploads (and with them names, birthdays and photos, often of children)
are sent to Anthropic's API in the US to be read. Under Anthropic's
commercial terms, API data is not used to train models and is deleted after
a limited retention period. Nothing from Administra's database is sent
except the reference data the model needs: the grade ladder, training
titles with weekday and time, and the club's sections. Dictation is
recognised by the browser's speech service (Google, Microsoft or Apple, see
_Dictation_) before the text reaches Anthropic. Mention the assistant in
the club's privacy notice before using it with members' data.

## Setup (Netlify)

Set for the **Production** and branch (`main`) deploy contexts — leave it
out of Deploy Previews, the repo is public and previews have no real data:

| Variable                       | Value                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `PRIVATE_ANTHROPIC_API_KEY`    | API key from console.anthropic.com (a workspace with a spend limit); mark as **secret** |
| `PRIVATE_ASSISTANT_MODEL`      | optional, default `claude-opus-5-5`                                                     |
| `PRIVATE_ASSISTANT_EFFORT`     | optional, `low` (default), `medium` or `high`: more careful reading, but slower         |
| `PRIVATE_ASSISTANT_TIMEOUT_MS` | optional, default `50000`; must stay below the Netlify function limit                   |

Without the key the assistant is simply not offered (buttons hidden, the
overview says it is not set up). The variables are read at runtime and take
effect with the next deploy.

**Function time limit.** Netlify documents 60 seconds for synchronous
functions, but older sites have been seen capped at 10 or 26 seconds. A
reading usually takes 10 to 40 seconds; if they fail with _hat zu lange
gedauert_, check the function log for "Task timed out" and ask Netlify
support to raise the limit, or lower `PRIVATE_ASSISTANT_TIMEOUT_MS` below
it so the user gets a clean error. Large plans are best read month by
month.

**Cost.** Claude Opus 5.5 costs $4 per million input and $20 per million
output tokens; a photo is about 2,000–5,000 input tokens, an answer a few
thousand output tokens, so a reading costs a few cents, a PDF of 30 pages
up to about 40 cents (the token limit above). Usage per account:

```sql
select user_id, kind, status, count(*), sum(input_tokens), sum(output_tokens)
from ai_imports
where created_at > now() - interval '30 days'
group by 1, 2, 3;
```

## Code

- `src/routes/api/assistant/+server.ts`: the endpoint (GET: configured and
  extractions left; POST: proposal)
- `src/lib/server/assistant/`: request checks (`request.ts`), reference data
  (`context.ts`), prompts and schemas, the Claude call (`claude.ts`)
- `src/lib/assistant/`: shared types, answer checks (`proposals.ts`), name
  matching, upload preparation, the browser client, and the review logic
  per kind (`grades.ts`, `attendance.ts`, `trainingPlan.ts`,
  `lessonPlan.ts`, `events.ts`)
- `src/lib/components/assistant/`: the dialog, the button and the review
  per kind (the training plan's next to its page,
  `src/routes/dashboard/training-plan/settings/TrainingPlanReview.svelte`,
  as it uses the plan's trainer picker)
- `src/routes/dashboard/assistant/`: the overview
- `supabase/migrations/20261026090000_ai_assistant.sql`: `ai_imports`,
  `ai_import_begin()`, `ai_import_finish()`, `ai_import_remaining()`
