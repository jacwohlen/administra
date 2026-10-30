# Integrations (Webling and other providers)

Goal: Alleda owns its data model, and Webling is one integration among
others. Adding another provider (easyVerein, a CSV import, a calendar feed)
should mean writing an adapter, not changing the schema or the app.

The work runs in phases; each one ships on its own.

| Phase                        | What                                                                                                                                                                                              | State                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 0 Stop the damage            | The sync keeps registrations entered in the app; app ids fenced away from Webling ids; CI for the sync                                                                                            | done (#165)             |
| 1a Status and links          | `membership_status`, `member_links`, Webling fields read-only in the app, access report                                                                                                           | done (#166)             |
| 1b Enforce sign-in by status | Member accounts, directory and auto-approval require an active or passive membership                                                                                                              | done (#171)             |
| 1c Safe merge                | Merge a duplicate (e.g. trial row and later Webling row) moving every reference in one transaction                                                                                                | done (#175)             |
| 2 Integration layer          | Provider-neutral ingest in SQL (stage, apply, finish), mapping as configuration, run log; calendars the provider no longer has                                                                    | done (#176, #184)       |
| 3 Webling on the new layer   | Webling adapter on a shared Python core (3a); the app reads the configuration (3b); dev on the layer since 2026-10-28, prod since 2026-10-29; the legacy scripts, modes and fallback removed (3c) | done (#177, #178, #186) |
| 4 End dates and holidays     | Multi-day and all-day events, Webling "Ferien" into `training_plan_breaks`                                                                                                                        | done (#179, #181)       |
| 5 Integrations page          | Status of connections, runs and issues; group and calendar mapping editor                                                                                                                         | done (#178)             |

## Decisions (October 2026)

- Webling's group **Probetraining** is a legacy trial mechanism and no longer
  used. Its members are not members (`non_member`); the app's own trial flow
  (label `probetraining`, lowercase) is the only trial mechanism.
- **Nicht-Mitglieder** must not be able to sign in. That applies to every
  account with the role `member`, also ones an admin approved by hand. Staff
  accounts (viewer, trainer, admin) keep their access: it comes from their
  role, not from a member record.
- For members that come from Webling, name, birthday, mobile, e-mail and
  groups are **read-only in Alleda** and changed in Webling. Notes and
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
| none of these, member created in Alleda     | `active`     | yes                    |

Checked in this order, so `03_Austritt` wins over `Aktiv`. The labels are
Webling group titles, except that Webling's legacy trial group
`04_Probetraining` gets the label `Probetraining` (its seeded row in
`integration_member_groups`). Groups that only describe roles
(Erwachsenentrainer, Kindertrainer, Hilfstrainer, Vorstand, J&S) do not
change the status.

Status groups, the app's labels `new` and `probetraining` and Webling
bookkeeping groups (`01_Anmeldung` … `04_Pass bestellt`, `Test`) are not
shown as chips (`visibleLabels()` in `src/lib/memberStatus.ts`, exact
spelling like the SQL); the status is its own chip, except `active`, on the
member list, the member page and the check-in cards. From phase 3b on the
app reads which ones from the integration catalog (see "The app reads the
configuration" below); the built-in list is the seeded catalog.

## Provider links

`member_links (connection, external_id, member_id, last_seen_at, gone_at)`
records where a member comes from. The Webling sync writes one row per
member Webling returns (`connection = 'webling'`, `external_id` = Webling
member id, which is also `members.id` for historical reasons), from its
first run after the migration on. Webling ids lie between 1'000 and
10'000'000, app ids below 1'000 or from 10'000'001 on.

When Webling no longer returns a member (deleted or merged there), the sync
sets `gone_at` on its link: the member has left. If more than a tenth of
the members still in Webling (at least 5) would go at once
(`members_gone`), or Webling returns nobody (`empty_snapshot`, no
override), the sync refuses and the run turns red: check Webling first. If
the deletions are intended, start **Actions → Webling Sync → Run
workflow** with `accept_gone` set to the number from the error line; only
that exact number is accepted, and only for that run. A member that is back
in Webling gets its link revived.

Status changes have the same kind of guard, because a member account only
gets in while a record counts: if Webling renamed or emptied `Aktiv` or
`Passiv`, every member account would be locked out at once.
`integration_apply` compares the statuses inside its transaction, as the
database derives them with the group catalog, so there is no copy of the
rule that could differ from it. If more than a tenth of the members that
count now (at least 5; fewer than 230 members come from Webling, so at most
22), or more than half of the active or of the passive ones (at least 5),
would stop counting, the run is refused (`status_drop`): nothing is written
(no member, link or gone mark) and the run turns red with the number and
what they would become, never names, groups or ids. If the changes are
intended, run the workflow with `accept_status_drop` set to that number.
Many members starting to count at once are refused the same way
(`status_gain`, override `accept_status_gain`). Members going because
Webling no longer has them are `accept_gone`'s, not this guard's. The
limits are in the table under "Guards" below.

Rows in the Webling id range that were never linked are recorded as gone on
the first run: in October 2026 prod had 537 such rows, but Webling returned
only 227 members; the others (mostly the legacy Probetraining group and old
Nicht-Mitglieder) were deleted in Webling.

While a member is in Webling, the database refuses changes to name,
birthday, mobile, e-mail, labels and status made through the API by
signed-in staff, and deleting the member (`trigger_guard_provider_fields`,
error `MANAGED_BY_PROVIDER`). The sync (through the layer's SECURITY
DEFINER functions), migrations, other SECURITY DEFINER functions and direct
service role writes are not restricted. The member page shows
"kommen aus Webling" and only offers the notes for editing. A member gone
from Webling is the app's again: editable, and deletable (the link goes
with it).

E-mail: the sync sends a member's address only when Webling has one, so an
address entered in Alleda before the fields became read-only stays, and
cannot be removed there either. Once those addresses are in Webling (see
below), the sync can own the field completely.

## Sign-in by membership status (phase 1b)

An account with the role `member` may use Alleda only while at least one
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

- An e-mail removed in Webling stays in Alleda (the sync only sends
  addresses Webling has), so the old address keeps matching.
- A status group changed in Webling on purpose: a renamed group keeps its
  status (bound by id); a new group arrives without a status, so its
  members fall to `non_member` until it is mapped on the Integrations page
  (`integration_set_mapping`), and `status_drop` refuses a large drop. A
  smaller one goes through; the warning dot on the avatar stays until the
  new group is reviewed (see "Integrations page"). Marking it reviewed
  without a status clears the dot and leaves those members non-members.
- Changes under the guard's limits go through (the run only logs their
  number), also a large change spread over several nights. Mass changes
  the other way (many members starting to count): `status_gain`.
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
status: the label of every member whose status the connection decides
follows the new name in the same run, also of members the run does not
write (a record with a problem, a partial run, a link gone), but not of a
member another provider has now. Statuses are looked up by the label
text, so a group's label is unique per connection: a group whose name
another group's label already has (a second `Passiv`, or a group renamed
to `Aktiv`) gets the provider's id in its label (`Passiv (123)`) and never
that group's status. Only on first sight, several groups with a seeded
row's name (an archive folder called `Passiv`) keep the old rule, which
went by the title: the seeded row binds to the lowest id (numeric ids in
numeric order), each other one
copies its mapping with its id in the label, not reviewed, so the first
run changes nobody's status.
New groups come without a status, hidden when they look like bookkeeping
(`^\d\d_[A-Z]`); new calendars hold events in the section of the first
matching rule (judo, aikido, club/verein, else General). Both are listed as
not reviewed. A linked member's status is the status group with
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
and (from phase 4) all day, and fills times, place and limit (until phase 4
it owned the description too, which held the portal link); it owns holiday
title and dates, while "Dojo zu" stays the TK's. The event page hides
delete of an event its provider still has (`event_links` without
`gone_at`) and links to it there; its edit page locks the fields the
connection's `field_policy` gives the provider (all a provider may write
when the policy cannot be read; all day and the times together, as each
changes the other) and leaves the rest, such as the registration deadline
and, from phase 4, Webling's description, to the app. Deleting an event
deletes its registrations and attendance with it (foreign keys), so a
refused delete loses nothing. A link that cannot be read is logged and the
event treated as not linked.

**Identity.** Through the link first (a gone link is revived); then an
admin's `link_to` from an import review; for Webling, a row with the
Webling id that has no link yet; otherwise a new row. A member has at most
one live link. A new member gets its e-mail only after its link, and a
member back in the provider gets its fields and labels before its link
comes back, so automatic approval only ever sees the provider's status. A record that
looks like a member the connection does not have (same e-mail, or same name
and birthday) is reported as `possible_duplicate`, never merged; a
connection with `on_possible_duplicate = 'skip'` holds it back until it is
linked or merged. Events work like members (`event_links`, one live link
per event): the first run linked every current-year event the old sync
had written. Holidays are found through their link, else a TK entry with the same
title and dates. Registrations the provider manages carry
`event_participants.source_connection` (backfilled from the "Imported from
Webling" notes); confirmed participants are found through live member
links. As before the layer, a row stays the provider's only while its
notes start with the provider's note: notes changed in the app (by staff,
or by a merge that keeps the Webling registration with the app's notes)
make it the app's. Rows entered in the app, and rows with attendance, are
never removed. `events.date_to` (multi-day events) exists from now on and is
shown since phase 4.

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

**A calendar the provider no longer has.** A complete run settles only the
calendars it read, and a calendar deleted at the provider is never read
again. An adapter that knows every calendar the provider has sends them as
`scope.provider_calendars` (capabilities version 3,
`20261101120000_provider_calendars_gone.sql`; an older database ignores the
key, an older adapter leaves things as before). A complete run then counts
the catalog's calendars missing from that list as read, without records
(`scope.calendars_gone`): their events and holidays within the window go
under the same guard, their open issues resolve, and
`integration_calendars.gone_at` marks them ("Nicht mehr in Webling" on the
Integrations page, nothing left to review) until the provider lists them
again; the mark is written by every run, a dry or refused one too, like new
catalog rows. Webling lists the calendars its API user can see: one it
loses access to looks deleted, which the events gone guard catches beyond
a few events.

**Run log and issues.** Admins read `integration_runs` (kind, scope,
trigger, runner, dry run, status, counts, guard numbers, accepted
overrides, the adapter's counters, an error code) and `integration_issues`.
Both hold codes, ids and counts, never names, titles or values; staged
records (`integration_records`) are read by nobody and deleted when the run
ends. Issues persist until a run that checks them no longer sees them (an
issue about a record: a run that staged it, an unknown participant's event
with its list or once over, or a complete run, for events one that read
the calendar noted with the issue; never a run that could not fetch it;
the scan for duplicates and kept events: every run); an admin can dismiss one
(`integration_dismiss_issue`) and it stays dismissed. An issue about a new
record whose insert failed, or about a holiday, names the record
(`external_id`), no member or event.
A run ends `ok`, `warning` (records it could not write, or adapter errors),
`refused` or `failed`. An unset Webling date and possible duplicates are
reported but do not change the run's status. Runs are kept 400 days, closed
issues 180 days. `integration_status()` sums it up for the Integrations
page.

`supabase/checks/integration_layer.sql` (CI job `db-validate`) checks the
seeded mapping against the old rule, who may do what, identity, guards,
events, holidays and the run log.

### When the sync is red

| Run                                                                             | Meaning                                                                                                             | Do                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| refused `empty_snapshot`                                                        | Webling answered no members                                                                                         | Check Webling and the API key, run again                                                                         |
| refused `members_gone`                                                          | Many members gone at once                                                                                           | Check Webling; if intended, **Actions → Webling Sync → Run workflow** with `accept_gone` = the number in the log |
| refused `status_drop`                                                           | Many members would lose their membership                                                                            | A new or renamed status group: map it on the Integrations page, run again; if intended, `accept_status_drop`     |
| refused `status_gain`                                                           | Many members would start counting (and be approved automatically)                                                   | Check the groups; if intended, `accept_status_gain`                                                              |
| refused `events_gone`                                                           | Many events gone at once                                                                                            | Check the calendar in Webling; if intended, `accept_events_gone`                                                 |
| failed `<sqlstate>`                                                             | The apply failed as a whole                                                                                         | Actions log, then a bug report                                                                                   |
| warning                                                                         | Records not written, or fetch errors                                                                                | Integrations page → issues (`invalid_record`, `id_conflict`, `write_failed`, held duplicates)                    |
| `RUN_IN_PROGRESS`                                                               | Another run of the same kind is open                                                                                | Wait an hour: an abandoned run is closed then                                                                    |
| `the integration layer is not on this database`                                 | `integration_begin` is missing (404 `PGRST202` or `42883`): a wrong `SUPABASE_URL`, or a database without the layer | Fix the environment's `SUPABASE_URL`; there is no fallback                                                       |
| `HTTP 401` / `permission denied for function integration_begin` / `NOT_ALLOWED` | The key is not the project's secret key                                                                             | Fix the environment's `SUPABASE_SERVICE_ROLE_KEY` (`webling-sync/README.md`)                                     |

## Phase 3: Webling on the layer

`webling-sync/src/sync.py` runs each step (members, then events) through
the layer: `integration_begin` → `integration_stage` (500 records per call,
only the keys in `capabilities`) → `integration_apply` →
`integration_finish`, which is always called once the run is open (a crash
ends it as `failed`, error `adapter_crash`). A database without
`integration_begin` (404 `PGRST202` or `42883`) is an error like any other,
with no fallback. Exit 0 only when the run ends `ok`.

The core in `src/integration/` knows no provider; `src/webling_adapter/`
reads Webling and sends what it has (names trimmed, values as Webling has
them, the portal link as the link's url, from phase 4 with `ends_on` and
`all_day`). A member Webling cannot fully answer is sent as a problem
(`missing_field`, `fetch_failed`): seen, so never gone, and not written.
The events scope is the calendars Webling answered completely, so an
unanswered calendar cannot lose events; Webling's unset date is
`no_date`, and participants go up only for events from today whose list
was read. The workflow inputs `accept_gone`, `accept_status_drop`,
`accept_status_gain` and `accept_events_gone` become the apply's
overrides.

**The switch.** Until 3c, `INTEGRATION_MODE` chose the old scripts
(`webling.py`, `events.py`, writing directly through PostgREST), a shadow
mode (the old scripts, then a dry run of the layer) or the layer. Dev ran a
dry run and switched to the layer on 2026-10-28. Prod ran one shadow night
(2026-10-28/29: the old scripts wrote, and the layer's dry run had the same
numbers) and switched on 2026-10-29; its first layer run was started by
hand (GitHub run 40834994585, 07:22 UTC): 73 events adopted, the 12
holiday events the old sync had written replaced by 13 holidays, members
unchanged. The calendars Webling no longer has (#184) followed the same
day.

**3c** removed the old scripts, the modes, `INTEGRATION_MODE` (with the
workflow input `mode`) and the fallback for a database without the layer,
the same day rather than after two weeks in layer mode, and
`20261102120000_remove_legacy_sync_support.sql` drops `events_keep_span`
(see "End dates and holidays"). There is no rollback by setting: going back
to the old sync means reverting 3c, safe only while no merge has moved a
Webling link and no group status was changed with
`integration_set_mapping` (the old sync's guard predicted with the seeded
rule), and without `events_keep_span` its event upsert fails once a start
moves past a last day. The GitHub variable `INTEGRATION_MODE` went
on 2026-10-30, once the `prod` and `dev` environments only accepted
`main`, so older branches cannot start the old workflow; it only still
steered re-runs of the few runs between 3a and 3c, and runs from before
3a would run the old scripts with or without it. A re-run uses the run's
own commit and is possible for 30 days, so a Webling Sync run from before
3c (started before 2026-10-29 23:31 UTC) must not be re-run until
2026-11-28; start a new run instead. The database keeps what still serves:
`member_status_from_labels()` (the status of members without a live link),
`integration_connections.legacy_note_prefix` (prod still has registrations
the old sync wrote whose notes only start with `Imported from Webling`),
`events_all_day`, and the adoption of unlinked rows with a Webling id and
the replacement of holiday events, which find nothing left to do.

**After 3c** every database (prod, Dev, preview branches) has the layer
and phases 3 and 4, so the hardening PR
(`20261103120000_integrations_hardening.sql`) removed what served one
without them: in the app the Integrations page's "noch nicht
eingerichtet", reading the calendars without `gone_at`, saving an event
again without `all_day` (`saveEventRow()`) and the quiet handling of a
missing table (`isMissingSchemaError()`: such an error is logged like any
other now); in the Webling adapter capabilities version 1 (the portal link
as description, no last day). CI runs the sync's layer tests against the
`db-validate` job's database. `member_status_from_labels()` is no API
function any more: only the database calls it, as the owner.

## The app reads the configuration (phase 3b)

The dashboard layout loads `integration_connections` and
`integration_member_groups` once per app session for staff
(`src/lib/integrationConfigLoad.ts`, `src/lib/integrationConfig.ts`); after
a mapping change on the Integrations page it loads them again. From them:

- **Chips** (`visibleLabels()`): a label is hidden when its catalog group
  is (`hidden`; the label is the group's `label`, else its name); a label
  the catalog does not know (such as a stale label of a member gone from
  the provider) when it matches the connection's
  `settings.hidden_group_pattern`; the app's own `new` and `probetraining`
  always.
- **Trainers** in the training plan (`hasTrainerLabel()`): members of
  groups with `role = 'trainer'` are offered first (seeded:
  Erwachsenentrainer); a label the catalog does not know keeps the built-in
  rule (contains "erwachsenentrainer", case ignored).
- **Provider names** (`providerName()`): `display_name` of the connection.
- **Daten-Assistent** (club dates): an existing event is the provider's
  when it has a live `event_links` row; without any link row (events of
  earlier years the old sync wrote, which the layer never linked) the
  Webling portal link in the description still tells; an event whose links
  are all gone is the app's.

Without the configuration (member accounts, which may not read it; a
failed load, logged and tried again at the next navigation) the built-in
rules apply, which are what the seeded catalog says.

## End dates and holidays (phase 4)

`20261030120000_event_end_dates_and_holidays.sql`. Events have a last day
(`events.date_to`, inclusive, NULL for one day) and `events.all_day` (no
times). Every date filter of the app is an overlap, `date <= day AND
coalesce(date_to, date) >= day` (`endsOnOrAfter()` in
`src/lib/eventUtils.ts`): the dashboard's events of the day, the events
list (today and under way, upcoming, past once the last day is over), the
event page (range chip, attendance from the first day to the last), the
exam days' event choice, and the training plan (a multi-day event is a band
from its first day shown and a chip on each training it covers, also one
that begins in December of the year before). The event form has _Bis_ and
_Ganztägig_; the Daten-Assistent writes `date_to` (until now it put
"bis 16.11.2026" as the description's first line: the migration moves such
lines of events no provider maintains into `date_to`). `events.date` has to
be `YYYY-MM-DD` (a CHECK, `NOT VALID`: an old row written otherwise stays
readable, but cannot be updated until its date is fixed), and an index
serves the overlap.

**All day.** The old sync wrote Webling's all-day entries as 00:00 to
00:00. The migration turned such rows into `all_day` without times, and the
trigger `events_all_day` keeps doing so for every writer; real times
written to an all-day event make it timed again, all day set by the app or
the layer drops the times.

**The last day.** Staff send both days (the form checks them; on a linked
event the days Webling owns are locked and not sent), and the layer writes
the last day Webling sends (its event writers run only inside
`integration_apply`, SECURITY DEFINER: `current_user` is the owner, also
when the sync calls it). The old sync upserted a start but knew no last
day; for its direct writes (`service_role`) the trigger `events_keep_span`
moved the last day along. Phase 3c drops it
(`20261102120000_remove_legacy_sync_support.sql`): a direct write of a
start after the last day is refused (`events_date_to_check`) as for
everyone else.

**Deploy order** (history). Netlify can deploy the app before Supabase
applies a promotion's migrations. Until the hardening after 3c, an app
ahead of this migration saved without `all_day` (`saveEventRow()` retried
without the column); every database has it now, and the event form saves
directly. The promotion that carried phase 4 carried phase 2
(`20261029120000`) as well: until Supabase had applied both (about a minute
after the merge) the training plan, the dashboard's events of the day, the
exam days' event choice and saving an event failed, and reloading after the
minute was enough.

**The layer, capabilities version 2.** `integration_begin` answers
`version: 2` and takes `all_day` in event records; `ends_on` becomes
`date_to`. Webling owns `event.all_day` and no longer the description: the
portal link is the link's url (`event_links.url`, the event page links to
it). Descriptions that are only that url are cleared, by the migration for
the linked events and by the layer for events it links later.
`integration_field_policy_ok()` knows `event.all_day`. On the edit page of
a linked Webling event the
description is open from then on, while _Datum_, _Bis_, _Ganztägig_ and
the times stay locked (`lockedEventFields()` in `src/lib/eventLinks.ts`:
all day and the times go together, as either changes the other). The
migration replaces `integration_write_event(s)`, `integration_normalize_event`,
`integration_field_policy_ok` and `integration_begin` with the phase 2
versions (review fixes included) plus `all_day`; a failed insert still
leaves its issue without an event id.

**Webling adapter.** It sends `ends_on` and `all_day`
(`webling_adapter/dates.span()`) and no description; until the hardening
after 3c it still sent a database of capabilities version 1 the portal link
as description and neither of the two. All day is Webling's flag
`isAllDay` when an event has it, else an entry from 00:00 to 00:00 (or
without an end), as the old sync wrote them. An end at 00:00 belongs
to the day before: Webling ends an all-day entry at midnight after its
last day (Karfreitag 03.04. ends on 04.04. 00:00, seen on the first layer
run on Dev), and a timed event that ends at midnight (19:00 to 00:00 the
next day) ends on the day before too. The window and the registrations go
by the last day: a camp that began before January 1 is still sent, one
under way still gets its participants.

**Holidays.** Webling's calendar "Ferien und Feiertage" holds holidays now
(`integration_calendars.target = 'break'`, `closed_max_days = 3`: a period
of up to three days closes the dojo, a longer one is school holidays; the
TK's "Dojo zu" wins afterwards). The migration flips the seeded row (left
alone when an admin mapped it otherwise) and handles the calendar's events
the layer had linked: unused ones of this year are deleted, the others
stay as the app's (gone link); in the migration, so the next run does not
count them under the events gone guard. Holidays reach
`training_plan_breaks` only through the layer: a run brings them as
holidays (a TK entry with the same title and dates is taken over). The
first layer run also replaced the events the old sync had written for them
(the General section), recognised by the Webling id and the portal link as
description: deleted when unused, else kept as the app's with a gone link
(`event_gone_kept`); it counted `breaks_inserted`,
`holiday_events_deleted` and `holiday_events_kept`, none of it under the
events gone guard (on prod 13 holidays for 12 such events, 2026-10-29).

A provider's holiday is read-only in the app but for "Dojo zu"
(_Trainings & Ferien_ shows where it comes from and offers no delete), and
the Daten-Assistent's holiday import never adds one again: a period with
the same dates, or the same title over overlapping dates, is shown as
_Synchronisiert_ (`src/lib/assistant/trainingPlan.ts`).

Issues (phase 2's rule, unchanged): a holiday's issue names its record
and calendar, no event, and waits for a run of that calendar; an unknown
participant of an event under way stays open until the list is read again
or the event's last day (`ends_on`) is over.

`supabase/checks/event_dates.sql` (CI job `db-validate`) checks what the
migrations left (`events_keep_span` gone), all day for every writer, the
date checks, the overlap filters, capabilities and policy, the layer's end
dates and all day, the holidays replacing the holiday events the old sync
wrote, and the issues of holidays and multi-day events.

## Integrations page (phase 5)

`/dashboard/integrations`, admins only (avatar menu, like Benutzer and
Einstellungen; `src/routes/dashboard/integrations/`, helpers in
`src/lib/integrations.ts`). One card per connection of
`integration_status()`:

- **What needs you**: the latest members or events run refused (with the
  guard's numbers and the exact override, e.g. "Actions → Webling Sync →
  Run workflow mit accept_gone = 60", computed from the run's `guard`) or
  failed (its error code), no successful run for 36 hours, open errors,
  new groups or calendars not reviewed yet (a new group usually has no
  status, only the first run's copies of a seeded group carry one, and
  members in no other status group count as non-members until it gets
  one; a new calendar's events are in a guessed section). The same
  conditions put a warning dot on the avatar and the menu entry
  (`dashboard/+layout.ts`) until the run is fixed, the errors are
  dismissed or the new rows are marked reviewed; a kind never run (a new
  connection, or one without events) raises nothing.
- **Numbers**: members and events linked, members gone, holidays, open
  issues (errors and warnings), catalog rows to review; the latest run and
  success per kind with "vor …" and a stale chip.
- **Runs**: the latest 50 `integration_runs` (mapping previews left out)
  with trigger, status, dry run, the counts other than zero, overrides used,
  the adapter's fetch errors and the error or refusal code.
- **Issues**: open and dismissed ones grouped by code. An issue whose
  member or event does not exist (merged or deleted since, or a new record
  whose insert failed) shows the provider's record number instead: it
  still counts as open, and every run that sees the record notes it again.
  Left out is only what has nothing else to show it by: a possible
  duplicate whose pair is gone (the next members run resolves it) or an
  issue without a record number. A possible duplicate links both member
  pages and opens the merge dialog (phase 1c); "Kein Duplikat" dismisses
  it (`integration_dismiss_issue`), any other issue can be dismissed too,
  and a dismissed one can be reopened. A group of two open issues or more
  has "Alle ausblenden", except possible duplicates (each pair is checked
  on its own): after a confirmation with the count it dismisses them one
  after the other, stops at the first error and says how many went
  through. An issue about a provider's event or holiday (kind `events`;
  not an unknown participant, whose number is the member's) has "In
  Webling öffnen" when the connection has a link template (below).
- **Mapping**: status, rank, hidden and role per group; target, section
  and "Dojo zu" days per calendar; new rows marked "Neu" and confirmed with
  "Geprüft", calendars the provider no longer lists marked "Nicht mehr in
  Webling" (and listed last). Preview is `integration_set_mapping`'s dry run (how many
  members get another status, how many lose or gain a membership, whether
  that is over the guard; when more than half of one status is what trips
  it, the preview names the status instead of the limit for all); Save,
  after a confirmation, sends exactly the numbers the preview was over the
  guard with; if they changed meanwhile the save is refused and shows the
  new preview. A preview fits only the inputs and the catalog rows it was
  made on: when the rows reload in place (another admin saved), inputs
  left as loaded take the new values and Save waits for a new preview.
  Save also waits while an input is invalid.

**Links to the provider** (`settings.record_urls`,
`20261103120000_integrations_hardening.sql`). A connection's
`settings.record_urls.event` is the address of one of its events, with
`{id}` for the external id; the page reads `integration_connections` (id,
settings) for it. It is used only when it starts with `https://` and has
`{id}` exactly once, after the host, and only for a record number of
letters, digits and `_.:-` (URL-encoded into the link, which opens in a
new tab); otherwise the issue shows the number without a link, as it does
when the connections cannot be read (logged). The migration derives the
template from each connection's live `event_links` when all their urls
are one prefix followed by their own id (Webling:
`https://<club>.webling.ch/portal#/calendar/event/{id}`) and keeps one
already set; a connection without such links gets none until one is set
in SQL.

## Modules on and off, the licence number

`20261104120000_license_number_and_js_module.sql`.

**On and off.** Every connection can be switched on and off by an admin on
the Integrations page (`integration_set_enabled(connection, enabled)`;
switching off asks first). Off, `integration_begin` answers
`CONNECTION_DISABLED` (SQLSTATE `PT423`, no longer `UNKNOWN_CONNECTION`),
and the sync ends with exit 0 and "switched off on the Integrations page"
without opening a run, so a switched-off Webling neither syncs nor turns the
workflow red. Links, runs, issues and data stay; members and events of a
switched-off provider stay read-only while their links exist (the guards
look at the link, not at the switch). The app reads `enabled` with the
configuration (`integrationConfig.enabled`, `isModuleEnabled()`).

**Modules without a sync.** The J+S export is the connection `js`
(provider `js`, `runs_in = 'sync'`, so no admin can open a run for it, and
no runner does), off after the migration. The Integrations page shows it
as a switch with a description, not runs, issues or mapping (`hasSync()` in
`src/lib/integrations.ts`); while on, the dashboard offers _J+S-Export_
to trainers and admins (`data.jsEnabled`), see `docs/JS_EXPORT.md`.

**Licence number.** `members.license_number` (Lizenznummer, the J+S person
number) is a member field like the name: the layer takes `license_number`
in member records (capabilities `member_keys`, trimmed, blank is none),
`integration_field_policy_ok()` knows `member.license_number`, and Webling
owns it (`field_policy`), so it is read-only in the app while a member is
linked and cleared when Webling has none. The Webling adapter sends it only
when its members have the property _Lizenznummer_ (a Webling without the
field changes nothing); an older adapter or database leaves it out (keys
filtered by the capabilities). Anonymized runs send none. Members from the
app get it in the member form. Not yet in `merge_members()`: a merge keeps
the kept row's number (the Webling row's, which Webling owns anyway).

`supabase/checks/integration_layer.sql` (section L) checks the policy, the
capabilities, writing, keeping and clearing the number, the guard for
staff, who may switch, and `CONNECTION_DISABLED`.
