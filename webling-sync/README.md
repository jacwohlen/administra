# Webling Sync Tools for Alleda

This folder contains the sync of data from the Webling API into Alleda's Supabase database.

`src/sync.py` is the entry point (GitHub Actions and local runs). The
Webling adapter (`src/webling_adapter/`) reads Webling and feeds the
database's integration layer, which maps, guards and writes (see
[How a run works](#how-a-run-works) and `docs/INTEGRATIONS.md`). A database
without the layer (`integration_begin`) is an error, with no fallback. The
old scripts `src/webling.py` and `src/events.py`, which wrote directly
through PostgREST, were removed in phase 3c.

## What it syncs

### Members (`src/webling_adapter/members.py`)

Fetches all members from Webling and sends them to the layer.

**Data Fields:**

- Member Id
- Firstname
- Lastname
- Birthday
- Groups (as labels)
- Cell Phone
- E-Mail (only when Webling has one, so an address entered in the app is kept)
- Lizenznummer (licence number, the J+S person number; only when the field exists in Webling, see `docs/JS_EXPORT.md`)

A member that cannot be read (e.g. a Webling field was renamed, or one of
its groups could not be read) is staged as problem `missing_field` or
`fetch_failed`: seen, so never gone, and not written. The other members
are still synced, and the run ends as a `warning` (red).

`integration_apply` links every member to Webling in `member_links`.
Alleda then shows its name, birthday, contact and groups as maintained
in Webling and does not let staff change them. Members Webling no longer
returns are marked as gone and count as having left (more than a tenth at
once is refused and fails the run; after checking Webling, a manual run
with `accept_gone` set to the number from the error line goes ahead);
the first run also records the rows in the Webling id range Webling no
longer has. The membership status follows the groups, as the layer's
group catalog maps them, see `docs/INTEGRATIONS.md`.

Before writing, `integration_apply` refuses the run if too many members
would go (`members_gone`), lose their active or passive membership
(`status_drop`) or start to count (`status_gain`), and if Webling answers
no members at all (`empty_snapshot`): nothing is written and the run ends
red. After checking Webling and its groups, a manual run with
`accept_gone`, `accept_status_drop` or `accept_status_gain` set to the
number from the error line goes ahead. The limits are in
`docs/INTEGRATIONS.md` ("Guards").

### Events (`src/webling_adapter/events.py`)

Fetches calendar events from Webling calendars and sends them to the layer. Only events whose last day is in the current year or later are sent. Supports syncing all calendars or filtering by specific calendar IDs or names.

**Data Fields:**

- Event Id
- Title
- Date and last day (`ends_on`)
- All day
- Start Time
- End Time
- Location
- Calendar (the layer's catalog gives the section, or makes its entries holidays)
- Max Participants
- Webling portal link (the link's url; the description is the app's)
- Participant registrations (member ID, status)

**Registrations:** for events not over yet (Europe/Zurich, going by the
last day), members confirmed in Webling get a registration, and
registrations the sync added earlier are removed once the member is no
longer confirmed in Webling (not listed, or listed with another state such
as declined), as long as they are still `registered` and have no
attendance. Everything entered in Alleda is kept: registrations and
walk-ins added in the app, attendance and its status, and the registration
date of existing rows. Removing a registration in Alleda that is still
confirmed in Webling does not stick: the next run adds it again, so cancel
it in Webling. The sync's own rows carry `event_participants.source_connection`
`webling` and stay its rows while their notes start with
`Imported from Webling`. If Webling's participant list cannot be read, the
event's registrations stay as they are. Registrations of past events are
never touched.

**Calendar Filtering:**

- Sync all calendars (default)
- Sync specific calendars by ID: `python src/sync.py events --calendar 22333 21780`
- Sync calendars by name matching: `python src/sync.py events --calendar judo aikido`
- List available calendars: `python src/sync.py list`

**Date Filtering:**

- Only events from January 1 of the current year on are synced, going by
  the last day (a camp over New Year is still sent)
- Earlier events are left as they are

**Runtime:** Slower (~1-2 minutes, fetches participants for each event)

### How a run works

`python src/sync.py members|events|list [--calendar ID|NAME ...] [--dry-run]`

Each run goes through the integration layer: `integration_begin` →
`integration_stage` → `integration_apply` → `integration_finish`. Exit 0
only when the run ends `ok`; `warning`, `refused` and `failed` turn the job
red. `--dry-run` (`INTEGRATION_DRY_RUN=true`) reads Webling and lets the
layer say what it would do, writing nothing but its run row and new
catalog rows. A database without `integration_begin` (404 `PGRST202` or
`42883`) fails the run (`Error: integration_begin: the integration layer is
not on this database ...`), as does any other refused call (`NOT_ALLOWED`,
`RUN_IN_PROGRESS`, a 404 later in the run, a network error).

Code: `src/integration/` is the provider-neutral core (Supabase client,
the four layer calls, the runner, the report); `src/webling_adapter/` reads
Webling and builds the records.

- **Members:** names trimmed, birthday and mobile as Webling has them, the
  e-mail or `null` (the layer only fills it), groups with their Webling id
  and title. A missing property is sent as problem `missing_field`, a
  member whose group could not be read as `fetch_failed`: seen (never
  gone), not written, and the run ends as a warning. With `ANONYMIZE=true`
  the records get fake values (`src/integration/anonymize.py`) before they
  are staged.
- **Events:** the calendars are read first (list and details); the run's
  scope is the calendars read completely, so a calendar Webling did not
  answer can never lose events. One list call per calendar is tried and
  taken only when it answers exactly the calendar's event ids with full
  properties; otherwise one call per event
  (`WEBLING_EVENTS_LIST_CALL=false` turns the list call off). Events before
  January 1 of this year are not sent; an event that cannot be read is sent
  as `fetch_failed`, Webling's unset date (1970) as `no_date`. Participants
  go up for events from today on, and only when Webling's list was read.
  Each event goes up with its last day (`ends_on`: an end at 00:00 belongs
  to the day before, as Webling ends an all-day entry at midnight after
  its last day and a timed event until midnight at 00:00) and `all_day`
  (Webling's `isAllDay`, else 00:00 to 00:00; then without times), and
  without a description (the portal link is the link's url, the
  description the app's); the window and participants go by the last day.
  Every calendar Webling lists goes along as `provider_calendars`: the
  layer settles the calendars Webling no longer has (deleted, or no longer
  visible to the API user) as read without events, so their events go
  under the events gone guard and their issues resolve; the log names
  their ids ("Calendars the provider no longer has").
- Records are staged 500 per call, each with only the keys the database
  lists in `capabilities` (a newer adapter never sends what an older
  database does not know; the log names the keys left out, "Not sent").
  `integration_finish` is always called once the run is open, also when
  the adapter crashes (error `adapter_crash`).

The log of a run shows counts, ids and codes only, e.g.:

```text
Layer members run 41: applied
  received 538, inserted 0, adopted 0, revived 0, updated 0, unchanged 538, ...
  gone: 0 of 538 live links, former 0 (limit 53, complete snapshot)
Final: ok
```

A refusal names its override: `... run the workflow by hand with
accept_gone=60`. What each refusal means and what to do:
`docs/INTEGRATIONS.md`.

### Duplicates

Duplicate members (a trial registration and the later Webling member, two
app rows for one person) are merged in Alleda by an admin: _Mitglieder →
Duplikate_, or _Duplikat zusammenführen_ on a member page. The merge moves
every reference in one transaction and keeps the Webling row, so this sync
finds the member through its link (`docs/INTEGRATIONS.md`,
"Merging duplicates"). Two Webling members are merged in Webling. The old
`src/duplicates.py` (search with the service-role key, and a merge that
deleted grades, medals and badges) is gone.

### Tests

CI runs `ruff check` and `pytest` on every pull request (job
`sync-scripts`; the local-database tests below run in job `db-validate`,
against the database `supabase db start` built there):

```bash
pip install -r requirements-dev.txt
ruff check . && pytest
```

The tests run against a fake Webling and Supabase (`tests/fake_world.py`,
`tests/fake_layer.py`, scenarios in `tests/scenarios.py`); among them:

- `test_log_privacy.py`: Webling answers with names, titles, groups, notes
  and e-mails, and none of them reaches stdout or stderr, on a real run or
  a dry run and when Webling or Supabase fail.
- `test_sync_cli.py`: the options and settings of `sync.py`, and the fake
  values dev gets (`ANONYMIZE`) stay the same.
- `test_layer_local_db.py`: `sync.py` against a local database with the
  layer, the SQL functions called through psql as `service_role`
  (`tests/psql_transport.py`). Skipped unless `LAYER_TEST_PSQL` names a
  psql command for a fresh database with every migration and the seed,
  e.g.
  `LAYER_TEST_PSQL='psql postgresql://postgres:postgres@127.0.0.1:54322/postgres' pytest tests/test_layer_local_db.py`
  after `supabase db reset`; `LAYER_TEST_PSQL_NO_LAYER` (optional) names a
  database without the layer, where the sync must fail. CI runs them after
  the SQL checks (each rolled back, so the database is still fresh) with
  `LAYER_TEST_REQUIRED=1`, which makes a missing `LAYER_TEST_PSQL` an
  error instead of a skip (a database it cannot reach already is one); the
  test without the layer is skipped there.

## Scheduled Sync (GitHub Actions)

The sync runs daily from GitHub Actions (`.github/workflows/webling-sync.yml`),
so it no longer depends on a personal machine being switched on.

- **Schedule:** daily at 22:47 UTC (00:47 CEST / 23:47 CET) against **prod**.
  GitHub may start scheduled runs a few minutes late.
- **Order:** members first, then events + participants. The events step runs
  even if the member step failed; the run is still marked failed.
- **Manual run:** GitHub → Actions → _Webling Sync_ → _Run workflow_. Choose the
  target (`prod` or `dev`) and what to sync (`all`, `members`, `events`).
  `dry_run` lets the layer say what it would do without writing;
  `accept_gone`, `accept_status_drop`, `accept_status_gain` and
  `accept_events_gone` take the exact number from a refused run's error
  line. The layer records the run as `trigger` `schedule` or `manual` with
  `runner` `github:<run id>`.
- **Failures:** a step is green only when its layer run ends `ok`: a
  `warning`, `refused` or `failed` run, a missing setting, a Webling or
  Supabase error and a database without the layer all turn the run red, and
  GitHub emails whoever last changed the workflow's cron schedule (a manual
  run notifies whoever started it). Logs are in the run's step output and
  list members by id only, without names, contact data or groups.
- **Logs are public** (the repository is public). The sync never logs a
  response body or a Webling URL (the API key is a query parameter): errors
  show the HTTP status, ids and, for Supabase, the PostgREST error code and
  message without the row data. Use the helpers in
  `src/integration/safe_log.py` (and `WeblingError` in
  `src/webling_adapter/api.py`) for any new request.

Dev runs on the layer since 2026-10-28, prod since 2026-10-29 (after one
night in which the old sync wrote and the layer did a dry run with the
same numbers). Phase 3c removed the old scripts, the modes and
`INTEGRATION_MODE` the same day, so there is no rollback by setting: going
back means reverting that change (`docs/INTEGRATIONS.md`, phase 3).

### Anonymization (dev / staging)

Only prod receives real member data. For every other target the member sync
replaces the personal fields before staging them:

| Field       | Written to dev / staging                                      |
| ----------- | ------------------------------------------------------------- |
| `firstname` | fake first name, e.g. `Felix`                                 |
| `lastname`  | fake last name plus the Webling id, e.g. `Fiktiv 4711`        |
| `birthday`  | real birth **year**, fake month/day (age groups, badges work) |
| `mobile`    | empty                                                         |
| `email`     | `member-<id>@example.invalid` (never deliverable, no sign-in) |
| id, labels  | unchanged, so attendance, events and groups stay consistent   |

The fake values are derived from the Webling id, so every run writes the same
fake member. Events and participant registrations contain no personal data
and are synced unchanged.

The switch is the `ANONYMIZE` variable (`true`/`false`). It has no default, so
`sync.py members` refuses to run without it:

- **GitHub Actions:** set by the workflow — `false` for `prod`, `true` for
  anything else. It is not configurable per environment on purpose.
- **`run-*.sh`:** `false` when `ENV=prod`, otherwise `true` (an exported
  `ANONYMIZE` wins).
- **Direct `python src/sync.py members`:** export it yourself.

Every synced member is overwritten completely, including an email address
entered in the app — test member sign-in with a member created in the app.
A dev database that already holds real data from an earlier sync is only
cleaned for members that still exist in Webling; rows of members deleted in
Webling keep their old values and must be cleaned by hand.

### One-time setup

Create a GitHub environment per target under **Settings → Environments**
(`prod`, and `dev` if you want to sync the Dev project manually) with:

| Name                        | Kind     | Value                                              |
| --------------------------- | -------- | -------------------------------------------------- |
| `WEBLING_DOMAIN`            | Variable | Webling subdomain, e.g. `jacwohlen`                |
| `SUPABASE_URL`              | Variable | Supabase project URL (`https://<ref>.supabase.co`) |
| `WEBLING_API_KEY`           | Secret   | Webling API key                                    |
| `WEBLING_EMAIL`             | Secret   | Webling login, needed for the participant API      |
| `WEBLING_PASSWORD`          | Secret   | Password of that login                             |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret   | secret key of that project, see below              |
| `HEALTHCHECK_URL`           | Secret   | `prod` only: healthchecks.io ping URL (optional)   |

`SUPABASE_SERVICE_ROLE_KEY` takes a secret key (`sb_secret_...`): Supabase
Dashboard → project → **Settings → API Keys** → _Publishable and secret API
keys_ → **Add new secret key** (named `webling_sync`, as on Prod and Dev), then
copy it. Use one key per project and do not reuse the app's keys, so the sync key
can be revoked on its own. The legacy JWT `service_role` key stops working at the
end of 2026, when Supabase retires the legacy keys. Anything with this key
bypasses RLS, so keep it in the environment secret only.

`HEALTHCHECK_URL` reports every run to healthchecks.io, which e-mails when a
run fails or when no run arrives (e.g. GitHub disabled the schedule after 60
days without commits). Set it in `prod` only, so manual `dev` runs don't count;
see `docs/UPTIME_MONITORING.md`.

Both environments accept only the `main` branch (_Deployment branches
and tags_): a workflow edit on another branch cannot read their secrets,
and an older branch, whose workflow still has the removed modes, cannot
start a run of the old scripts.

The variable `INTEGRATION_MODE` (the switch to the layer until phase 3c)
is gone. A re-run uses the run's own commit and is possible for 30 days,
so a Webling Sync run from before phase 3c (started before 2026-10-29
23:31 UTC) would run the old scripts: do not re-run one until
2026-11-28; start a new run instead.

## Local Setup

The steps below are for running the sync by hand (e.g. `list`,
`--calendar`, `--dry-run`).

### 1. Clone/Download this repository

### 2. Create Python virtual environment and install dependencies

```bash
cd ~/work/jacwohlen.ch/administra/webling-sync
python -m venv .env
source .env/bin/activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Create environment-specific configuration files:

**Production (`.env.prod`):**

```bash
export WEBLING_API_KEY=<your webling api key>
export WEBLING_DOMAIN=<your webling domain>  # e.g. jacwohlen

# Supabase production configuration
export SUPABASE_URL=<your production supabase url>
export SUPABASE_SERVICE_ROLE_KEY=<the production project's secret key (sb_secret_...)>

# Required for `sync.py events` (participants)
export WEBLING_EMAIL=<your webling email>
export WEBLING_PASSWORD=<your webling password>
```

**Staging (`.env.staging`):**

```bash
export WEBLING_API_KEY=<your webling api key>
export WEBLING_DOMAIN=<your webling domain>  # e.g. jacwohlen

# Supabase staging configuration
export SUPABASE_URL=<your staging supabase url>
export SUPABASE_SERVICE_ROLE_KEY=<the staging project's secret key (sb_secret_...)>

# Required for `sync.py events` (participants)
export WEBLING_EMAIL=<your webling email>
export WEBLING_PASSWORD=<your webling password>
```

**Important:** These files contain sensitive credentials. Do not commit them to version control.

The target needs the integration layer (every migration up to
`20261029120000_integration_layer.sql`); a project without it fails the
run.

## Manual Usage

### Using Wrapper Scripts (Recommended)

The wrappers source `.env.<ENV>`, set `ANONYMIZE` by `ENV` and pass their
arguments on to `sync.py`:

```bash
# Production (default)
./run-members.sh        # Sync members to production
./run-events.sh         # Sync events to production

# Staging
ENV=staging ./run-members.sh     # Sync members to staging
ENV=staging ./run-events.sh      # Sync events to staging

# Options pass through
./run-members.sh --dry-run
./run-events.sh --calendar judo
```

### Direct Python Execution

```bash
# Activate virtual environment
source .env/bin/activate

# Source environment variables (choose one)
source .env.prod      # For production
source .env.staging   # For staging

# Members need ANONYMIZE: false for production only, true for anything else
export ANONYMIZE=false

# Sync members
python src/sync.py members

# Sync all events from all calendars
python src/sync.py events

# List available calendars
python src/sync.py list

# Sync events from specific calendars by ID
python src/sync.py events --calendar 22333 21780

# Sync events from calendars matching name patterns
python src/sync.py events --calendar judo aikido club

# What the layer would do, without writing
python src/sync.py members --dry-run
```

## Project Structure

```
webling-sync/
├── README.md                 # This file
├── requirements.txt          # Python dependencies (also used by GitHub Actions)
├── requirements-dev.txt      # + pytest and ruff for the CI job
├── pyproject.toml            # ruff and pytest settings
├── .env.prod                # Production environment variables (not in git)
├── .env.staging             # Staging environment variables (not in git)
├── run-events.sh            # Events sync wrapper (uses $ENV, defaults to prod)
├── run-members.sh           # Members sync wrapper (uses $ENV, defaults to prod)
├── src/                     # Python source files
│   ├── sync.py              # Entry point: members | events | list, through the integration layer
│   ├── integration/         # Provider-neutral core: client, layer calls, runner, report, anonymize, safe log
│   └── webling_adapter/     # Webling calls and layer records (members, events, dates)
├── tests/                   # pytest (no network, no credentials)
└── .env/                    # Python virtual environment
```

## Troubleshooting

### "Please export WEBLING_DOMAIN" (or another setting)

`sync.py` stops with `Error: Please export <NAME>` when a setting is
missing. In GitHub Actions, the variable or secret is missing in the
environment (see [One-time setup](#one-time-setup)). Locally, the
environment file is not being sourced correctly. Make sure:

- The `.env.prod` (or `.env.staging`) file exists and contains `export` statements
- You `source` it, or use the wrapper scripts, which must be executable: `chmod +x run-events.sh run-members.sh`
- The ENV variable matches your environment file name (without the .env. prefix)
- For members, `ANONYMIZE` is exported (the wrappers set it)

### "integration_begin: the integration layer is not on this database"

`SUPABASE_URL` points to a project without the integration layer (404
`PGRST202` or `42883`): a wrong URL, or a project without the migration
`20261029120000_integration_layer.sql`. Fix the URL or apply the
migrations; the sync has no other way to write.

### `permission denied for function integration_begin` (or `NOT_ALLOWED`)

`SUPABASE_SERVICE_ROLE_KEY` is not the project's secret key: the anon or
publishable key gets `HTTP 401 42501: permission denied for function
integration_begin`, a mistyped key or another project's a plain `HTTP 401`,
a user's token `NOT_ALLOWED`. Only the service role may run the Webling
sync.
