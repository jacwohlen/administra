# Integrations (Webling and other providers)

Goal: Administra owns its data model, and Webling is one integration among
others. Adding another provider (easyVerein, a CSV import, a calendar feed)
should mean writing an adapter, not changing the schema or the app.

The work runs in phases; each one ships on its own.

| Phase                        | What                                                                                                   | State       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- |
| 0 Stop the damage            | The sync keeps registrations entered in the app; app ids fenced away from Webling ids; CI for the sync | done (#165) |
| 1a Status and links          | `membership_status`, `member_links`, Webling fields read-only in the app, access report                | done (#166) |
| 1b Enforce sign-in by status | Member accounts, directory and auto-approval require an active or passive membership                   | done (#171) |
| 1c Safe merge                | Merge a duplicate (e.g. trial row and later Webling row) moving every reference in one transaction     | done (#175) |
| 2 Integration layer          | Provider-neutral ingest in SQL (stage, apply, finish), mapping as configuration, run log               | this phase  |
| 3 Webling on the new layer   | Webling adapter on a shared Python core; group/calendar mapping from config instead of code            | planned     |
| 4 End dates and holidays     | Multi-day events, Webling "Ferien" into `training_plan_breaks`                                         | planned     |
| 5 Integrations page          | Read-only status of connections, runs and issues                                                       | planned     |

## Decisions (October 2026)

- Webling's group **Probetraining** is a legacy trial mechanism and no longer
  used. Its members are not members (`non_member`); the app's own trial flow
  (label `probetraining`, lowercase) is the only trial mechanism.
- **Nicht-Mitglieder** must not be able to sign in. That applies to every
  account with the role `member`, also ones an admin approved by hand. Staff
  accounts (viewer, trainer, admin) keep their access: it comes from their
  role, not from a member record.
- For members that come from Webling, name, birthday, mobile, e-mail and
  groups are **read-only in Administra** and changed in Webling. Notes and
  the photo stay editable.
- Members that **Webling no longer has** (deleted or merged there) count as
  having **left**.
- Defaults until decided otherwise: Ehrenmitglieder count as passive (may
  sign in); non-members and people who left are hidden from the member list
  (unless asked for) and from trainer pickers, but stay in the database with
  their history.

## Membership status

`members.membership_status` is derived from the labels and the provider
link by `member_status_from_labels()` whenever either changes. Never set it
directly. From phase 2 on, a linked member's status comes from the
provider's group catalog (`integration_member_groups`, see "Integration
layer" below), whose seeded rows are exactly this table.

| Labels (exact spelling)                     | Status       | Member accounts get in |
| ------------------------------------------- | ------------ | ---------------------- |
| any, but Webling no longer has the member   | `left`       | no                     |
| `03_Austritt`                               | `left`       | no                     |
| `Aktiv`                                     | `active`     | yes                    |
| `Passiv`, `Ehrenmitglieder`                 | `passive`    | yes                    |
| `Nicht-Mitglieder`                          | `non_member` | no                     |
| `probetraining` (app trial candidate)       | `trial`      | no                     |
| `Probetraining` (Webling legacy, see below) | `non_member` | no                     |
| none of these, member comes from Webling    | `non_member` | no                     |
| none of these, member created in Administra | `active`     | yes                    |

Checked in this order, so `03_Austritt` wins over `Aktiv`. The labels are
Webling group titles, except that the sync renames Webling's legacy trial
group `04_Probetraining` to `Probetraining` (`transform_label()` in
`webling-sync/src/webling.py`). Groups that only describe roles
(Erwachsenentrainer, Kindertrainer, Hilfstrainer, Vorstand, J&S) do not
change the status.

Status groups, the app's label `new` and Webling bookkeeping groups
(`01_Anmeldung` … `04_Pass bestellt`, `Test`) are not shown as chips
(`visibleLabels()` in `src/lib/memberStatus.ts`, exact spelling like the
SQL); the status is its own chip, except `active`, on the member list, the
member page and the check-in cards.

## Provider links

`member_links (connection, external_id, member_id, last_seen_at, gone_at)`
records where a member comes from. The Webling sync writes one row per
member Webling returns (`connection = 'webling'`, `external_id` = Webling
member id, which is also `members.id` for historical reasons), from its
first run after the migration on. Webling ids lie between 1'000 and
10'000'000, app ids below 1'000 or from 10'000'001 on.

When Webling no longer returns a member (deleted or merged there), the sync
sets `gone_at` on its link: the member has left. If more than a tenth of
the members still in Webling (at least 5) would go at once, or Webling
returns nobody, the sync refuses and the run turns red: check Webling
first. If the deletions are intended, start **Actions → Webling Sync → Run
workflow** with `accept_gone` set to the number from the error line; only
that exact number is accepted, and only for that run. A member that is back
in Webling gets its link revived.

Status changes have the same kind of guard, because a member account only
gets in while a record counts: if Webling renamed or emptied `Aktiv` or
`Passiv`, every member account would be locked out at once. Before writing,
the sync reads the status, archive date and labels of the members in the
Webling id range and asks the database's own `member_status_from_labels()`
(on prod since phase 1a) for each written member's new status, once per
distinct set of groups. It must predict with the rule the trigger will run:
a sync change reaches prod the same night while migrations wait for a
promotion, so a copy of the rule in the sync could be ahead of prod and let
the very drop through it should stop.
If more than a tenth of the members that count now (at least 5; fewer than
230 members come from Webling, so at most 22), or more than half of the
active or of the passive ones (at least 5), would stop counting, it writes
nothing (no member, link or gone mark) and the run turns red with the
number and what they would become, never names, groups or ids. If the
changes are intended, run the workflow with `accept_status_drop` set to
that number. If the statuses cannot be read or the database's rule cannot be
asked, it writes nothing either. A run that goes ahead logs how many members
lost their membership and what they became. After the run it reads the
statuses again: a member whose status is not the predicted one is a warning
(the trigger saw more than groups and link), and more members out than the
guard allows is an error. Members
going because Webling no longer has them are `accept_gone`'s, not this
guard's.

Rows in the Webling id range that were never linked are recorded as gone on
the first run: in October 2026 prod had 537 such rows, but Webling returned
only 227 members; the others (mostly the legacy Probetraining group and old
Nicht-Mitglieder) were deleted in Webling.

While a member is in Webling, the database refuses changes to name,
birthday, mobile, e-mail, labels and status made through the API by
signed-in staff, and deleting the member (`trigger_guard_provider_fields`,
error `MANAGED_BY_PROVIDER`). The sync (service role), migrations and
SECURITY DEFINER functions are not restricted. The member page shows
"kommen aus Webling" and only offers the notes for editing. A member gone
from Webling is the app's again: editable, and deletable (the link goes
with it).

E-mail: the sync sends a member's address only when Webling has one, so an
address entered in Administra before the fields became read-only stays, and
cannot be removed there either. Once those addresses are in Webling (see
below), the sync can own the field completely.

## Sign-in by membership status (phase 1b)

An account with the role `member` may use Administra only while at least one
of its member records counts: `membership_status` `active` or `passive`, not
archived, no trial label (`member_grants_access()`). Its records are the
member an admin linked under _Benutzer_ and every member carrying the
account's e-mail (case and surrounding spaces ignored). Non-members, people
who left and trial candidates get nothing, also when an admin approved the
account by hand or linked it. Staff accounts (viewer, trainer, admin; exam
roles only exist on top of these) get in by their role, whatever their
member records say.

The rule is checked on every request, never stored
(`20261027120000_member_access_requires_membership.sql`):

- `is_approved_user()` and `my_member_ids()` apply it to member accounts.
  Every policy and function that lets members read club data goes through
  one of them, so a member account without a record that counts reads
  nothing: no trainings, events, grades, badges, photos or directory.
- `my_member_ids()` returns only the records that count: a parent sees and
  registers for exams only the children whose membership counts. Staff keep
  all of theirs ("Mein Profil" of a trainer who is no member in Webling).
- The member directory lists only members that count.
- Of other members, a member account sees badges, grades, medals and the
  photo only for `club_member_ids()`: its own members and the directory
  (`20261028100000_member_data_only_for_club_members.sql`). Badge progress
  (training, event and streak counts) only of its own members; recent
  achievements, the badge leaderboard and medal counts are staff-only.
  Staff see everything. See `docs/MEMBER_SIGN_IN.md`.
- `user_profiles.status` keeps meaning what an admin (or the automatic
  approval) decided. Nobody is set back to _Ausstehend_: when the sync
  changes a status (groups changed, gone from Webling, back again), a member
  is archived or deleted, or an e-mail changes, the next request already
  follows it, and access comes back by itself once a record counts again.
- Automatic approval (`grant_member_access()`) needs a record that counts and
  only approves accounts waiting as `member`. It runs at every sign-in and
  whenever a member's e-mail, groups, status or archive date changes, so a
  member back in Webling is let in by that night's sync.
- New accounts wait with the role `member`. Approving one by hand gives
  member access, which follows the membership; for trainers and board
  members pick the staff role first (an account waiting with a staff role is
  never approved automatically).
- `my_access()` tells the app whether the account is let in (the same check)
  and the reason per record. The pending page says which case it is: e-mail
  not on file, trial candidate, or on file without an active or passive
  membership (with the status from the member register).
- _Benutzer_ marks approved member accounts without access (_Kein Zugang_,
  list _Mitglieder-Konten ohne Zugang_) and waiting member accounts that
  would get none, with the reason per record (`member_access_report()`:
  `archived`, `trial` for an active record with a trial label, otherwise the
  status). The member link shows the status of members who are not active.
- A member the sync has just added counts as coming from Webling before its
  link is written (`trigger_set_membership_status()`, Webling id range): one
  without a status group is a non-member from the start, not active until
  the end of the run.

Known gaps:

- An e-mail removed in Webling stays in Administra (the sync only sends
  addresses Webling has), so the old address keeps matching.
- A status group renamed in Webling on purpose: from phase 3 on (the sync
  on the integration layer), renamed groups keep their status (phase 2,
  bound by id); a new status group is mapped on the Integrations page
  (`integration_set_mapping`). Until then the legacy sync writes the new
  title as a label, the guard above refuses the run, and a manual run with
  `accept_status_drop` lets the drop through. `status_from_labels()` in
  `webling-sync/src/sync_rules.py` is only the tests' copy of the rule.
- Changes under the guard's limits go through (the run only logs their
  number), also a large change spread over several nights. Mass changes
  the other way (many members starting to count): from phase 3 on,
  `status_gain`.
- An app trial candidate whose trial label a trainer removes counts as an
  active member (1a rule); merge it into the Webling record (below).

`supabase/checks/member_access.sql` (CI job `db-validate`) walks through these
cases as member, admin and sync; `supabase/checks/member_data.sql` checks
what member accounts see of other members.

## Merging duplicates (phase 1c)

Duplicates come from a trial candidate who later turns up as a new Webling
member, or from two app rows for one person. An admin merges them: the
member page's menu (_Duplikat zusammenführen_) or _Mitglieder → Duplikate_,
a list of likely pairs (`src/lib/memberDuplicates.ts`): same name and
birthday; same e-mail and the same first name (siblings share a parent's
address, twins also a birthday, and there is no "not a duplicate" list to
silence a false pair); a trial registration and a row that is none with the
same name. Names are compared without accents, case and word order, and
need two words. Pairs of two Webling members are listed but merged in
Webling.

`merge_members(keep, drop)`
(`20261028110000_merge_duplicate_members.sql`) moves every reference to the
dropped member onto the kept one in one transaction and deletes the dropped
row. Admins only, because it cannot be undone. The dialog first shows
`merge_members_preview(keep, drop)`: the same code, rolled back, so its
counts are exactly what the merge does. Each merge is logged in
`member_merges` (who, when, the dropped row without photo data and trial
token, its provider links, what moved); only admins read it, no API role
writes it (the sync's service key only reads), and it goes when the kept
member is deleted. The merge locks both rows and the dropped row's links,
so the nightly sync cannot bring a gone link back half way.

Refused: both rows in Webling (`BOTH_IN_PROVIDER`: merge in Webling, the
sync then marks the other one gone); the Webling row as the one dropped
(`KEEP_PROVIDER_ROW`: the sync would create it again; "in Webling" is an
active link, or no link and a Webling id); both rows linked to an account
(`ACCOUNT_CONFLICT`: unlink one under _Benutzer_); both examined on the same
exam day (`EXAM_CONFLICT`); a reference the merge does not know
(`UNHANDLED_REFERENCE`).

What happens to each reference (`merge_member_references()`, the reviewed
list; `supabase/checks/merge_members.sql` fails when a foreign key to
`members` appears that it does not name, and the merge refuses to run):

| Reference                           | Same row under both                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logs.memberId`                     | One attendance per training and date, the higher trainer role                                                                                                         |
| `participants.memberId`             | One assignment per training, the trial start date kept                                                                                                                |
| `event_participants.memberId`       | One registration per event, the furthest status, the earliest time; one entered in the app wins over a Webling import, so the sync never removes it                   |
| `event_logs.memberId`               | One attendance per event, coach if either was, notes of both                                                                                                          |
| `member_grades.memberId`            | The grade an exam sheet recorded stays, otherwise the kept one; notes of both                                                                                         |
| `member_medals.memberId`            | The better medal per competition, with category and section of the other where it has none; exact duplicates without event removed                                    |
| `member_badges.memberId`            | Earliest earn date; then every badge of the kept member is recomputed, and the season badges of each section and year the dropped one trained in (and the year after) |
| `exam_candidates.member_id`         | The one with a sheet stays (both: refused), else the furthest status; it takes the furthest status, notes of both, empty fields; the other is kept in the log         |
| `trial_emails.member_id`            | Moved                                                                                                                                                                 |
| `training_plan_sessions.trainer_id` | Moved                                                                                                                                                                 |
| `trainings.mainTrainerId`           | Moved                                                                                                                                                                 |
| `member_merges.kept_id`             | Moved                                                                                                                                                                 |
| `user_profiles.member_id`           | Moved when only the dropped member is linked                                                                                                                          |
| `member_links.member_id`            | A gone link goes with the dropped row; the kept member's link stays                                                                                                   |

The kept row keeps its name, labels and status. Birthday, mobile and e-mail
are only filled where it has none, and not at all on a Webling row (change
them in Webling); an e-mail from the trial form is never copied (anybody can
type any address there, and the e-mail decides who may sign in). Notes of
both are joined; the dropped photo is taken when the kept row has none (the
browser copies the file, Storage is out of SQL's reach); the kept row leaves
the archive unless both were archived. Trial history and status link come
over when the kept row has neither a trial history nor a status link of
its own (a link sent out keeps working), with status `assigned` while it
has trainings (a `cancelled` would remove them).

The preview lists every value not taken over, each row both members had
and which one stays, the kept member's status before and after, and the
sign-in accounts linked to either member or matching either e-mail whose
access changes or that no longer find, or newly find, the member
(`accounts`: before and after, as `is_approved_user()` and
`my_member_ids()` decide). A member account finds a record only while it
counts: a parent who keeps access through one child no longer finds the
other when the record that stays is no member. Only member accounts can
lose access (`ACCOUNT_LOSES_ACCESS`); staff get in by their role and at
most lose "Mein Profil". An existing account link moves, but nothing is
linked by e-mail: a trainer's or a parent's address would link the wrong
person. Old links to `/dashboard/members/<dropped id>` end in "not found".

Badge triggers are paused for the merge with `set_config(..., true)` and
everything is recomputed once at the end. A `SET app.… = …` clause on the
function would be simpler but fails on hosted Supabase and in the CLI,
where `postgres` is no superuser; the check script fails on any function
that has one.

The Webling sync needs no change: the kept Webling row keeps its id, and the
sync never writes notes, photo, trial fields or registrations entered in the
app. `webling-sync/src/duplicates.py` is removed.

## Integration layer (phase 2)

`20261029120000_integration_layer.sql`. Every provider makes the same four
calls. The adapter only fetches and translates; the database does the rest,
one transaction per apply: `integration_begin(connection, kind, options)`
opens a run of `members` or `events` and returns the scope, today in
Zurich, the connection's settings and the record keys this database
understands (`capabilities`); `integration_stage(run, records)` takes up to
1000 records per call; `integration_apply(run, options)` resolves identity,
maps, applies the guards and writes; `integration_finish(run, report)`
closes the run and deletes the staged records. The sync calls them with the
service role key. An admin may call them only for a connection that runs in
the app (`runs_in = 'app'`, e.g. a CSV upload) and only on runs that admin
started. Webling is never fed by hand. At most one run per connection and
kind is open; one left open for an hour is closed at the next begin.

Records carry ids, never names as ids. A field left out stays as it is. A
record with a `problem` (e.g. `fetch_failed`, or `no_date` for Webling's
unset dates) counts as seen, so it never goes as gone, but is not written.
Values are stored as sent; names and titles are trimmed. One record the
database refuses is noted as `write_failed`; the others are written.

**Mapping.** `integration_member_groups` maps each provider group to a
label, a status with a rank, hidden (no chip) and a role (`trainer`);
`integration_calendars` maps each calendar to events with a section, to
holidays (`training_plan_breaks`) or to nothing. Rows are bound to the
provider's id when first seen, so a group renamed in Webling keeps its
status. New groups come without a status, hidden when they look like
bookkeeping (`^\d\d_[A-Z]`); new calendars hold events in the section of
the first matching rule (judo, aikido, club/verein, else General). Both are
listed as not reviewed. A linked member's status is the status group with
the lowest rank among its labels (`03_Austritt` first; the app's own
`probetraining` ranks right after `Nicht-Mitglieder`), else the connection's default
(`non_member`); all links gone: `left`; no link: the rule above
(`member_status_for()`). With the seeded rows this is exactly the table
above; the migration fails if one stored status would change. Admins
change a mapping with `integration_set_mapping`: preview first (dry run);
the statuses are derived again at once under the guards below, and the
change is logged as a `config` run. Identity rules, owned fields and guard
limits change only by migration. Staff read the connections and catalogs;
nobody writes them through the API.

**Owned fields.** `integration_connections.field_policy` says, per field,
whether the provider owns it (written as sent, also cleared), fills it
(written only when it has a value) or sets it only once (`initial`). Owned
and filled fields are read-only for staff while linked
(`MANAGED_BY_PROVIDER`), for members, events and holidays; linked events
and holidays cannot be deleted in the app. Webling owns name, birthday,
mobile and groups and fills the e-mail; it owns event title, dates, section
and description (the portal link, until phase 4) and fills times, place and
limit; it owns holiday title and dates, while "Dojo zu" stays the TK's. The
event page hides edit and delete of an event its provider still has
(`event_links` without `gone_at`) and links to it there; deleting an event
deletes its registrations and attendance with it (foreign keys), so a
refused delete loses nothing. An app without the migration (Netlify
deploys before a promotion) treats every event as not linked.

**Identity.** Through the link first (a gone link is revived); then an
admin's `link_to` from an import review; for Webling, a row with the
Webling id that has no link yet; otherwise a new row. A member has at most
one live link. A new member gets its e-mail only after its link, so
automatic approval only ever sees the provider's status. A record that
looks like a member the connection does not have (same e-mail, or same name
and birthday) is reported as `possible_duplicate`, never merged; a
connection with `on_possible_duplicate = 'skip'` holds it back until it is
linked or merged. Events work like members (`event_links`, one live link
per event): the first run links every current-year event the legacy sync
wrote. Holidays are found through their link, else a TK entry with the same
title and dates. Registrations the provider manages carry
`event_participants.source_connection` (backfilled from the "Imported from
Webling" notes); confirmed participants are found through live member
links. Rows entered in the app, and rows with attendance, are never
removed. `events.date_to` (multi-day events) exists from now on and is
shown from phase 4.

**Guards.** A refused or dry apply writes nothing but its run row and new
catalog rows. The override is the exact number from the refusal, for that
run only:

| Refused                                                                                                                             | Override             |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Complete snapshot without records                                                                                                   | none                 |
| Members gone (and rows in the Webling range never linked) > max(5, a tenth of the live links)                                       | `accept_gone`        |
| Members losing an active or passive membership (apart from those gone) > max(5, a tenth of those counting), or > half of one status | `accept_status_drop` |
| Members starting to count (new members excluded) > max(5, a tenth)                                                                  | `accept_status_gain` |
| Events or holidays gone from calendars read completely, within the window, > max(5, a tenth)                                        | `accept_events_gone` |

A partial run (one calendar, a partial member list) never marks anything
gone. A future event gone from the provider that nobody used in the app
(attendance, app registrations, exams, medals) is deleted; any other is kept
as the app's and reported.

**Run log and issues.** Admins read `integration_runs` (kind, scope,
trigger, runner, dry run, status, counts, guard numbers, accepted
overrides, the adapter's counters, an error code) and `integration_issues`.
Both hold codes, ids and counts, never names, titles or values; staged
records (`integration_records`) are read by nobody and deleted when the run
ends. Issues persist until a run that checks them no longer sees them; an
admin can dismiss one (`integration_dismiss_issue`) and it stays dismissed.
A run ends `ok`, `warning` (records it could not write, or adapter errors),
`refused` or `failed`. An unset Webling date and possible duplicates are
reported but do not change the run's status. Runs are kept 400 days, closed
issues 180 days. `integration_status()` sums it up for the Integrations
page.

The legacy sync keeps working unchanged until phase 3 switches it (its
nightly link upsert no longer rewrites every member). Until then, change no
mapping with `integration_set_mapping`: the legacy sync's guard predicts
statuses with `member_status_from_labels()`, which only agrees with the
seeded catalog.
`supabase/checks/integration_layer.sql` (CI job `db-validate`) checks the
seeded mapping against the old rule, the legacy sync's writes, who may do
what, identity, guards, events, holidays and the run log.

### When the sync is red (phase 3 on)

| Run                      | Meaning                                                           | Do                                                                                                               |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| refused `empty_snapshot` | Webling answered no members                                       | Check Webling and the API key, run again                                                                         |
| refused `members_gone`   | Many members gone at once                                         | Check Webling; if intended, **Actions → Webling Sync → Run workflow** with `accept_gone` = the number in the log |
| refused `status_drop`    | Many members would lose their membership                          | A new or renamed status group: map it on the Integrations page, run again; if intended, `accept_status_drop`     |
| refused `status_gain`    | Many members would start counting (and be approved automatically) | Check the groups; if intended, `accept_status_gain`                                                              |
| refused `events_gone`    | Many events gone at once                                          | Check the calendar in Webling; if intended, `accept_events_gone`                                                 |
| failed `<sqlstate>`      | The apply failed as a whole                                       | Actions log, then a bug report                                                                                   |
| warning                  | Records not written, or fetch errors                              | Integrations page → issues (`invalid_record`, `id_conflict`, `write_failed`, held duplicates)                    |
| `RUN_IN_PROGRESS`        | Another run of the same kind is open                              | Wait an hour: an abandoned run is closed then                                                                    |
