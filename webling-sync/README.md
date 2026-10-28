# Webling Sync Tools for Administra

This folder contains scripts to sync data from Webling API with Administra's Supabase database.

`src/sync.py` is the entry point (GitHub Actions and local runs). In the
default mode, `legacy`, it runs the two scripts below unchanged; in `layer`
mode the Webling adapter feeds the database's integration layer instead
(see [Modes](#3-modes-legacy-shadow-layer) and `docs/INTEGRATIONS.md`).

## Scripts

### 1. Member Sync (`src/webling.py`)

Fetches all members from Webling and syncs them to Administra.

**Data Fields:**

- Member Id
- Firstname
- Lastname
- Birthday
- Groups (as labels)
- Cell Phone
- E-Mail (only when Webling has one, so an address entered in the app is kept)

A member that cannot be read (e.g. a Webling field was renamed) fails on its
own: the other members are still synced, and the run ends red.

Every synced member is linked to Webling in `member_links` (one request per
run). Administra then shows its name, birthday, contact and groups as
maintained in Webling and does not let staff change them. On a database
without that table yet (migration not promoted) the links are skipped with
a warning. Members Webling no longer returns are marked as gone and count
as having left (more than a tenth at once is refused and fails the run;
after checking Webling, a manual run with `accept_gone` set to the number
from the error line goes ahead);
the first run also records the rows in the Webling id range Webling no
longer has. The membership status follows the groups, see
`docs/INTEGRATIONS.md`.

Before writing any member the sync reads the current statuses and refuses
the run if too many members would lose their active or passive membership
at once (more than a tenth, at least 5, or more than half of the active or
the passive ones): nothing is written and the run ends red. After checking
the groups in Webling, a manual run with `accept_status_drop` set to the
number from the error line goes ahead. The prediction comes from the
database's own `member_status_from_labels()`, asked once per distinct set of
groups, so it is always the rule prod runs; if the statuses cannot be read
or the rule cannot be asked, the run writes nothing either. A run that goes
ahead logs how many members lost their membership and what they became
(counts only). After the run, a status the database derived differently
from the prediction is reported as a warning. `status_from_labels()` in
`src/sync_rules.py` is only the tests' copy of the rule.

### 2. Events Sync (`src/events.py`)

Fetches calendar events from Webling calendars and syncs them to Administra. Only syncs events from the current year onwards (skips past events). Supports syncing all calendars or filtering by specific calendar IDs or names.

**Data Fields:**

- Event Id
- Title
- Description (Webling portal link for event details)
- Date
- Start Time
- End Time
- Location
- Section (derived from calendar name)
- Max Participants
- Participant registrations (member ID, status, notes)

**Registrations:** for events from today on (Europe/Zurich), members confirmed
in Webling get a registration, and registrations the sync added earlier are
removed once the member is no longer confirmed in Webling (not listed, or
listed with another state such as declined), as long as they are still
`registered` and have no attendance. Everything entered in Administra is
kept: registrations and walk-ins added in the app, attendance and its status,
and the registration date of existing rows. Removing a registration in
Administra that is still confirmed in Webling does not stick: the next run adds
it again, so cancel it in Webling. The sync's own rows are the ones
whose notes start with `Imported from Webling`. If Webling's participant list
cannot be read, the event's registrations stay as they are. Registrations of
past events are never touched.

**Calendar Filtering:**

- Sync all calendars (default)
- Sync specific calendars by ID: `python events.py --calendar 22333 21780`
- Sync calendars by name matching: `python events.py --calendar judo aikido`
- List available calendars: `python events.py list`

**Date Filtering:**

- Only events from the current year and future years are synced
- Past events are automatically skipped to keep the database current

**Runtime:** Slower (~1-2 minutes, fetches participants for each event)

### 3. Modes: legacy, shadow, layer

`python src/sync.py members|events|list [--calendar ID|NAME ...] [--dry-run] [--mode MODE]`

The mode is `--mode`, else the environment variable `INTEGRATION_MODE`,
else `legacy` (also when the variable is set but empty):

| Mode     | What runs                                                                                                                                                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy` | `src/webling.py` / `src/events.py` exactly as before, in their own process, with their exit status. Nothing of the layer is imported.                                                                                                                                                                                                         |
| `shadow` | Legacy first (it writes, its exit status is the job's), then the same Webling read as a **dry run** of the layer. Through the layer only its run row and the group and calendar catalog (new rows, Webling ids bound to seeded rows) are written. A dry run that would not end `ok`, or a missing layer, is a `::warning::`, never a failure. |
| `layer`  | The integration layer: `integration_begin` → `integration_stage` → `integration_apply` → `integration_finish`. Exit 0 only when the run ends `ok`; `warning`, `refused` and `failed` turn the job red.                                                                                                                                        |

In `layer` mode the legacy scripts run instead **only** when the database
has no `integration_begin` yet (404 `PGRST202` or `42883` on that first
call, i.e. before Promotion 1), with a `::warning::`. Any other answer
(`NOT_ALLOWED`, `RUN_IN_PROGRESS`, a 404 later in the run, a network error)
fails the run. `--dry-run` (`INTEGRATION_DRY_RUN=true`) never falls back:
legacy has no dry run, so a dry run in `legacy` mode stops with exit 2.

Code: `src/integration/` is the provider-neutral core (Supabase client,
the four layer calls, the runner, the report); `src/webling_adapter/` reads
Webling (the same calls as the legacy scripts) and builds the records.

- **Members:** names trimmed, birthday and mobile as Webling has them, the
  e-mail or `null` (the layer only fills it), groups with their Webling id
  and title. A missing property is sent as problem `missing_field`, a
  member whose group could not be read as `fetch_failed`: seen (never
  gone), not written, and the run ends as a warning. With `ANONYMIZE=true`
  the records get the same fake values as the legacy sync before they are
  staged.
- **Events:** the calendars are read first (list and details); the run's
  scope is the calendars read completely, so a calendar Webling did not
  answer can never lose events. One list call per calendar is tried and
  taken only when it answers exactly the calendar's event ids with full
  properties; otherwise one call per event, as before
  (`WEBLING_EVENTS_LIST_CALL=false` turns the list call off). Events before
  January 1 of this year are not sent; an event that cannot be read is sent
  as `fetch_failed`, Webling's unset date (1970) as `no_date`. Participants
  go up for events from today on, and only when Webling's list was read.
  A database whose `capabilities` have version 2 (integrations phase 4)
  gets the last day (`ends_on`) and `all_day` (Webling's `isAllDay`, else
  00:00 to 00:00), no description (the portal link is the link's url),
  and the window and participants go by the last day. That the end of an
  all-day entry is its last day (inclusive) is an assumption, see
  `ALL_DAY_END_INCLUSIVE` in `src/webling_adapter/dates.py`.
- Records are staged 500 per call, each with only the keys the database
  lists in `capabilities` (a newer adapter never sends what an older
  database does not know). `integration_finish` is always called once the
  run is open, also when the adapter crashes (error `adapter_crash`).

The log of a layer run shows counts, ids and codes only, e.g.:

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
app rows for one person) are merged in Administra by an admin: _Mitglieder →
Duplikate_, or _Duplikat zusammenführen_ on a member page. The merge moves
every reference in one transaction and keeps the Webling row, so this sync
finds the member under its Webling id as before (`docs/INTEGRATIONS.md`,
"Merging duplicates"). Two Webling members are merged in Webling. The old
`src/duplicates.py` (search with the service-role key, and a merge that
deleted grades, medals and badges) is gone.

### Tests

`src/sync_rules.py` holds the rules that need no network (member mapping,
which registrations to add or remove). CI runs `ruff check` and `pytest` on
every pull request (job `sync-scripts`):

```bash
pip install -r requirements-dev.txt
ruff check . && pytest
```

The tests run against a fake Webling and Supabase (`tests/fake_world.py`,
`tests/fake_layer.py`); among them:

- `test_legacy_golden.py`: the legacy scripts make exactly the HTTP calls,
  with the same bodies and exit status, as before phase 3
  (`tests/golden/legacy_calls.json`, recorded on commit `2dc1e7d`).
- `test_log_privacy.py`: Webling answers with names, titles, groups, notes
  and e-mails, and none of them reaches stdout or stderr, in all three
  modes and when Webling or Supabase fail.
- `test_layer_local_db.py`: `sync.py` in layer mode against a local
  database with the layer, the SQL functions called through psql as
  `service_role` (`tests/psql_transport.py`). Skipped unless
  `LAYER_TEST_PSQL` names a psql command for a fresh database with every
  migration and the seed, e.g.
  `LAYER_TEST_PSQL='psql postgresql://postgres:postgres@127.0.0.1:54322/postgres' pytest tests/test_layer_local_db.py`
  after `supabase db reset`.

## Scheduled Sync (GitHub Actions)

The sync runs daily from GitHub Actions (`.github/workflows/webling-sync.yml`),
so it no longer depends on a personal machine being switched on.

- **Schedule:** daily at 22:47 UTC (00:47 CEST / 23:47 CET) against **prod**.
  GitHub may start scheduled runs a few minutes late.
- **Order:** members first, then events + participants. The events step runs
  even if the member step failed; the run is still marked failed.
- **Manual run:** GitHub → Actions → _Webling Sync_ → _Run workflow_. Choose the
  target (`prod` or `dev`) and what to sync (`all`, `members`, `events`).
  `mode` (empty: the environment's `INTEGRATION_MODE`, else `legacy`) and
  `dry_run` choose how; `accept_gone`, `accept_status_drop` (both modes)
  and `accept_status_gain`, `accept_events_gone` (layer mode) take the exact
  number from a refused run's error line.
- **Mode:** scheduled runs have no inputs and use the environment's
  variable `INTEGRATION_MODE`; while it is unset they run `legacy`. The
  layer records the run as `trigger` `schedule` or `manual` with `runner`
  `github:<run id>`.
- **Failures:** both scripts exit non-zero on any error (missing variable,
  Webling/Supabase HTTP error, failed upsert), so the run turns red and GitHub
  emails whoever last changed the workflow's cron schedule (a manual run
  notifies whoever started it). Logs are in the run's step output and list
  members by id only, without names, contact data or groups.
- **Logs are public** (the repository is public). The scripts never log a
  response body or a Webling URL (the API key is a query parameter): errors
  show the HTTP status, ids and, for Supabase, the PostgREST error code and
  message without the row data. Use the helpers in `src/safe_log.py` for any
  new request.

### Switching to the layer

Operations only, once the integration layer migration is on the database
(Promotion 1) and this code is on `main`. The switch is the variable
`INTEGRATION_MODE` of the GitHub environment (**Settings → Environments →
prod/dev → Environment variables**).

1. **Dev:** set `INTEGRATION_MODE=layer` on `dev`. Run the workflow on
   `dev` with `dry_run`, then without. Check that the run rows appear in
   `integration_runs` and that the anon key and a trainer account get
   `NOT_ALLOWED` from `rpc/integration_begin` (the service key is allowed).
2. **Prod, 2 to 3 nights:** set `INTEGRATION_MODE=shadow` on `prod`. The
   legacy sync keeps writing; after each step the log shows what the layer
   would have done (`dry run: nothing written`). Accept when, every night:
   - members: `inserted 0`, `adopted 0`, `updated 0`, `gone 0`,
     `former 0`, `statuses_recomputed 0`;
   - events: `adopted` about the number of this year's Webling events
     (about 85; every shadow night, since a dry run links nothing),
     `updated 0`, `inserted 0`, `gone 0`, `registrations_added 0`,
     `registrations_removed 0`; `registrations_adopted` is the number of
     registrations the legacy sync added since Promotion 1 (older ones
     were marked by the migration);
   - `Calendar N: … (list call …)` shows whether Webling answered the one
     list call per calendar; `updated 0` confirms its values equal what
     the legacy sync wrote.
   - Possible duplicates are listed as `::warning::` issues for an admin;
     they do not fail runs and need no action for the switch.
3. **Prod:** set `INTEGRATION_MODE=layer`. The first night adopts the
   events (`adopted` about 85, `updated 0`); from the second night on they
   are `unchanged`.

If the end dates migration (phase 4, Promotion 3) is on prod before the
switch, the shadow and first nights differ: the calendar "Ferien und
Feiertage" brings holidays (`breaks_inserted` and `holiday_events_deleted`
about the number of this year's holidays, `adopted` the other calendars'
events only), and adopted events lose the portal link as description and
get their last day and all day.

**Rollback:** set `INTEGRATION_MODE` back to `legacy` (or delete it). Safe
only while no merge has moved a Webling link and no group status was
changed with `integration_set_mapping`: the legacy guard predicts statuses
with the static rule. Until PR 3c removes the legacy scripts, both paths
stay in the code.

### Anonymization (dev / staging)

Only prod receives real member data. For every other target the member sync
replaces the personal fields before writing them:

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
`webling.py` refuses to run without it:

- **GitHub Actions:** set by the workflow — `false` for `prod`, `true` for
  anything else. It is not configurable per environment on purpose.
- **`run-*.sh`:** `false` when `ENV=prod`, otherwise `true` (an exported
  `ANONYMIZE` wins).
- **Direct `python src/webling.py`:** export it yourself.

Every synced member is overwritten completely, including an email address
entered in the app — test member sign-in with a member created in the app.
A dev database that already holds real data from an earlier sync is only
cleaned for members that still exist in Webling; rows of members deleted in
Webling keep their old values and must be cleaned by hand.

### One-time setup

Create a GitHub environment per target under **Settings → Environments**
(`prod`, and `dev` if you want to sync the Dev project manually) with:

| Name                        | Kind     | Value                                               |
| --------------------------- | -------- | --------------------------------------------------- |
| `WEBLING_DOMAIN`            | Variable | Webling subdomain, e.g. `jacwohlen`                 |
| `SUPABASE_URL`              | Variable | Supabase project URL (`https://<ref>.supabase.co`)  |
| `WEBLING_API_KEY`           | Secret   | Webling API key                                     |
| `WEBLING_EMAIL`             | Secret   | Webling login, needed for the participant API       |
| `WEBLING_PASSWORD`          | Secret   | Password of that login                              |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret   | secret key of that project, see below               |
| `HEALTHCHECK_URL`           | Secret   | `prod` only: healthchecks.io ping URL (optional)    |
| `INTEGRATION_MODE`          | Variable | `legacy` (or unset), `shadow` or `layer`, see above |

`SUPABASE_SERVICE_ROLE_KEY` takes a secret key (`sb_secret_...`): Supabase
Dashboard → project → **Settings → API Keys** → _Publishable and secret API
keys_ → **Add new secret key** (e.g. named `webling-sync`), then copy it once.
Use one key per project and do not reuse the app's keys, so the sync key can be
revoked on its own. The legacy JWT `service_role` key still works but Supabase
retires it at the end of 2026. Anything with this key bypasses RLS, so keep it in
the environment secret only.

`HEALTHCHECK_URL` reports every run to healthchecks.io, which e-mails when a
run fails or when no run arrives (e.g. GitHub disabled the schedule after 60
days without commits). Set it in `prod` only, so manual `dev` runs don't count;
see `docs/UPTIME_MONITORING.md`.

Optionally restrict the `prod` environment to the `main` branch
(_Deployment branches and tags_) so a workflow edit on another branch cannot
read the prod secrets.

Once the first scheduled run is green, stop the old systemd timers so the
sync does not run twice:

```bash
systemctl --user disable --now webling-sync-events.timer webling-sync-members.timer
```

## Local Setup

The steps below are for running the scripts by hand (e.g. `list`,
`--calendar`) or as a fallback scheduler with systemd.

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
export SUPABASE_SERVICE_ROLE_KEY=<your production supabase service_role key>

# Required for events.py (participant sync)
export WEBLING_EMAIL=<your webling email>
export WEBLING_PASSWORD=<your webling password>
```

**Staging (`.env.staging`):**

```bash
export WEBLING_API_KEY=<your webling api key>
export WEBLING_DOMAIN=<your webling domain>  # e.g. jacwohlen

# Supabase staging configuration
export SUPABASE_URL=<your staging supabase url>
export SUPABASE_SERVICE_ROLE_KEY=<your staging supabase service_role key>

# Required for events.py (participant sync)
export WEBLING_EMAIL=<your webling email>
export WEBLING_PASSWORD=<your webling password>
```

**Important:** These files contain sensitive credentials. Do not commit them to version control.

### 4. (Fallback) Set up automated scheduling with systemd timers

Only needed if the GitHub Actions schedule is not used.

The `systemd/` directory contains service and timer files for automated daily sync.

**Schedule:**

- Events sync: Daily at 23:58
- Members sync: Daily at 23:59

**Install systemd services:**

```bash
# Run the install script
./install-systemd.sh

# The script will copy service files to ~/.config/systemd/user/
# By default, services use production environment (ENV=prod)

# Optional: Edit service files to use staging environment
# Edit ~/.config/systemd/user/webling-sync-events.service
# Edit ~/.config/systemd/user/webling-sync-members.service
# Change: Environment="ENV=prod" to Environment="ENV=staging"

# Reload systemd
systemctl --user daemon-reload

# Enable and start timers
systemctl --user enable webling-sync-events.timer
systemctl --user enable webling-sync-members.timer
systemctl --user start webling-sync-events.timer
systemctl --user start webling-sync-members.timer

# Enable lingering (allows services to run when not logged in)
loginctl enable-linger $USER
```

**Verify timers are active:**

```bash
systemctl --user list-timers
```

You should see both `webling-sync-events.timer` and `webling-sync-members.timer` scheduled for 23:58 and 23:59 respectively.

## Manual Usage

### Using Wrapper Scripts (Recommended)

```bash
# Production (default)
./run-members.sh        # Sync members to production
./run-events.sh         # Sync events to production

# Staging
ENV=staging ./run-members.sh     # Sync members to staging
ENV=staging ./run-events.sh      # Sync events to staging
```

### Direct Python Execution

```bash
# Activate virtual environment
source .env/bin/activate

# Source environment variables (choose one)
source .env.prod      # For production
source .env.staging   # For staging

# Sync members
python src/webling.py

# Sync all events from all calendars
python src/events.py

# List available calendars
python src/events.py list

# Sync events from specific calendars by ID
python src/events.py --calendar 22333 21780

# Sync events from calendars matching name patterns
python src/events.py --calendar judo aikido club

# The same through the entry point (legacy unless INTEGRATION_MODE says otherwise)
python src/sync.py members
python src/sync.py events --calendar judo

# What the layer would do, without writing
python src/sync.py members --mode layer --dry-run
```

## Systemd Service Management

### View logs

```bash
# Via systemd journal
journalctl --user -u webling-sync-events.service -f
journalctl --user -u webling-sync-members.service -f

# Via log files
tail -f logs/events.log
tail -f logs/members.log
```

### Manual service execution

```bash
systemctl --user start webling-sync-events.service
systemctl --user start webling-sync-members.service
```

### Check service status

```bash
systemctl --user status webling-sync-events.service
systemctl --user status webling-sync-members.service
```

### Check timer status

```bash
systemctl --user status webling-sync-events.timer
systemctl --user status webling-sync-members.timer
```

### Stop/disable timers

```bash
# Stop timers (temporary)
systemctl --user stop webling-sync-events.timer
systemctl --user stop webling-sync-members.timer

# Disable timers (prevents auto-start on boot)
systemctl --user disable webling-sync-events.timer
systemctl --user disable webling-sync-members.timer
```

### Restart timers after configuration changes

```bash
systemctl --user daemon-reload
systemctl --user restart webling-sync-events.timer
systemctl --user restart webling-sync-members.timer
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
├── install-systemd.sh       # Install script for systemd services
├── run-events.sh            # Events sync wrapper (uses $ENV, defaults to prod)
├── run-members.sh           # Members sync wrapper (uses $ENV, defaults to prod)
├── src/                     # Python source files
│   ├── sync.py              # Entry point: members | events | list, mode legacy | shadow | layer
│   ├── webling.py           # Member sync script (legacy mode)
│   ├── events.py            # Events & participants sync script (legacy mode)
│   ├── sync_rules.py        # Rules without network access (member mapping, registrations), unit-tested
│   ├── safe_log.py          # Webling requests and error messages without personal data or keys
│   ├── integration/         # Provider-neutral core: client, layer calls, runner, report, anonymize
│   └── webling_adapter/     # Webling calls and layer records (members, events, dates)
├── tests/                   # pytest (no network, no credentials)
│   └── golden/              # Legacy HTTP calls as recorded before phase 3
├── .env/                    # Python virtual environment
├── logs/                    # Log files
│   ├── events.log
│   └── members.log
└── systemd/                 # Systemd service/timer templates
    ├── webling-sync-events.service
    ├── webling-sync-events.timer
    ├── webling-sync-members.service
    └── webling-sync-members.timer
```

## Troubleshooting

### Services fail with "Please export WEBLING_DOMAIN" error

The environment file is not being sourced correctly. Make sure:

- The `.env.prod` (or `.env.staging`) file exists and contains `export` statements
- The wrapper scripts are executable: `chmod +x run-events.sh run-members.sh`
- The ENV variable matches your environment file name (without the .env. prefix)

### Timers don't run when logged out

Enable lingering for your user:

```bash
loginctl enable-linger $USER
```

### Check if lingering is enabled

```bash
loginctl show-user $USER | grep Linger
```

Should output: `Linger=yes`

### View recent service failures

```bash
journalctl --user -u webling-sync-events.service --since "1 hour ago"
journalctl --user -u webling-sync-members.service --since "1 hour ago"
```
