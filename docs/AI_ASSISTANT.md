# Daten-Assistent (AI import)

Getting a club into Administra means typing in years of paper: kyu
gradings from Judo passes, attendance lists, the training plan, lesson
plans, club dates. The _Daten-Assistent_ reads a photo, a PDF or pasted
text with Claude (Anthropic) and turns it into a proposal; the user checks,
completes and corrects it, and only then is it saved.

| Kind                       | Where                                   | Saved to                                         | Who                            |
| -------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------ |
| **Judo-Pass einlesen**     | member page → _Graduierungen_           | `member_grades`                                  | trainers, admins (`is_writer`) |
| **Teilnehmerliste**        | check-in page of a training and date    | `logs` (`set_attendance`), `participants`        | trainers, admins               |
| **Trainingsplan einlesen** | _Trainingsplanung → Trainings & Ferien_ | `training_plan_sessions`, `training_plan_breaks` | the TK (`is_exam_manager`)     |
| **Lektionsplan einlesen**  | check-in page → _Lektionsplan_          | `lesson_plans`                                   | trainers, admins               |
| **Termine einlesen**       | _Anlässe_                               | `events`                                         | trainers, admins               |

The overview `/dashboard/assistant` (avatar menu → _Daten-Assistent_)
explains the steps and leads to these pages: pick a member or a training
and date there, and the target page opens the assistant right away
(`?assistant=<kind>`).

## How it is used

1. **Upload**: up to 4 photos (or the camera on a phone), a PDF, pasted
   text or a `.txt`/`.csv` file, plus an optional hint ("the second column
   is the leader"). Photos are scaled down to 2000 px and re-encoded as
   JPEG in the browser, which also drops EXIF data such as the location.
2. **Auswerten**: the server sends it to Claude, which answers with a
   proposal in a fixed format. This takes 10 to 40 seconds.
3. **Review**: every row with its status (_Neu_, _Schon erfasst_,
   _Abweichend_, _Unvollständig_, _Doppelt_). Values the model was unsure
   about are marked with its remark; names are matched to members in the
   browser, unclear matches are left for the user to pick. Missing values
   can be filled in and wrong ones corrected right there; contradictions
   with what Administra already has (another date for a grading, a
   different trainer on a planned date, an event that already exists) are
   shown side by side and never overwritten without an explicit tick.
4. **Übernehmen**: only now is anything written, by the browser, through
   the same tables and with the same permissions as the manual forms.

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
  spreadsheet formula prefixes removed, dates and times must be real, list
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
  not their name.
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
titles with weekday and time, and the club's sections. Mention the
assistant in the club's privacy notice before using it with members' data.

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
thousand output tokens, so a reading costs a few cents. Usage per account:

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
