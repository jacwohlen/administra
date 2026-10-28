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
| 1c Safe merge                | Merge a duplicate (e.g. trial row and later Webling row) moving every reference in one transaction     | planned     |
| 2 Integration layer          | Provider-neutral ingest in SQL (stage, apply, finish), mapping as configuration, run log               | planned     |
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
directly.

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
Webling id range and predicts each written member's new status from its
groups (`status_from_labels()` in `webling-sync/src/sync_rules.py`, a port
of `member_status_from_labels()`; it never calls the SQL, because a sync
change reaches prod the same night while migrations wait for a promotion).
If more than a tenth of the members that count now (at least 5; fewer than
230 members come from Webling, so at most 22), or more than half of the
active or of the passive ones (at least 5), would stop counting, it writes
nothing (no member, link or gone mark) and the run turns red with the
number and what they would become, never names, groups or ids. If the
changes are intended, run the workflow with `accept_status_drop` set to
that number. If the statuses cannot be read, it writes nothing either. A run
that goes ahead logs how many members lost their membership and what they
became. After the run it reads the statuses again: a member whose status is
not the predicted one is a warning (the port and the SQL differ; change both
together), and more members out than the guard allows is an error. Members
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
- A status group renamed in Webling on purpose needs the new title in
  `member_status_from_labels()` and in `status_from_labels()`
  (`webling-sync/src/sync_rules.py`) before the sync runs again; until then
  the guard above refuses the run.
- Changes under the guard's limits go through (the run only logs their
  number), also a large change spread over several nights. Mass changes
  the other way (many members starting to count) have no guard.
- An app trial candidate whose trial label a trainer removes counts as an
  active member (1a rule); phase 1c merges it with the Webling record.

`supabase/checks/member_access.sql` (CI job `db-validate`) walks through these
cases as member, admin and sync; `supabase/checks/member_data.sql` checks
what member accounts see of other members.
