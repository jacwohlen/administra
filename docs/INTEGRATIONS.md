# Integrations (Webling and other providers)

Goal: Administra owns its data model, and Webling is one integration among
others. Adding another provider (easyVerein, a CSV import, a calendar feed)
should mean writing an adapter, not changing the schema or the app.

The work runs in phases; each one ships on its own.

| Phase                        | What                                                                                                   | State       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- |
| 0 Stop the damage            | The sync keeps registrations entered in the app; app ids fenced away from Webling ids; CI for the sync | done (#165) |
| 1a Status and links          | `membership_status`, `member_links`, Webling fields read-only in the app, access report                | this phase  |
| 1b Enforce sign-in by status | Sign-in, directory and auto-approval require an active or passive membership                           | next        |
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
- Defaults until decided otherwise: Ehrenmitglieder count as passive (may
  sign in); non-members and people who left are hidden from the member list
  (unless asked for) and from trainer pickers, but stay in the database with
  their history.

## Membership status

`members.membership_status` is derived from the labels by
`member_status_from_labels()` whenever they change, and whenever a provider
link is added or removed. Never set it directly.

| Labels (Webling group titles are exact)     | Status       | Sign-in (from phase 1b) |
| ------------------------------------------- | ------------ | ----------------------- |
| `03_Austritt`                               | `left`       | no                      |
| `Aktiv`                                     | `active`     | yes                     |
| `Passiv`, `Ehrenmitglieder`                 | `passive`    | yes                     |
| `Nicht-Mitglieder`                          | `non_member` | no                      |
| `probetraining` (app trial candidate)       | `trial`      | no                      |
| `Probetraining` (Webling legacy)            | `non_member` | no                      |
| none of these, member comes from Webling    | `non_member` | no                      |
| none of these, member created in Administra | `active`     | yes                     |

Checked in this order, so `03_Austritt` wins over `Aktiv`. Groups that only
describe roles (Erwachsenentrainer, Kindertrainer, Hilfstrainer, Vorstand,
J&S) do not change the status. Status groups and Webling bookkeeping groups
(`01_Anmeldung` … `04_Pass bestellt`, `Test`) are not shown as chips
(`visibleLabels()` in `src/lib/memberStatus.ts`); the status is its own chip,
except `active`.

## Provider links

`member_links (connection, external_id, member_id)` records where a member
comes from. The Webling sync writes one row per member it syncs
(`connection = 'webling'`, `external_id` = Webling member id, which is also
`members.id` for historical reasons). Existing Webling members were
backfilled by the migration: Webling ids lie between 1'000 and 10'000'000,
app ids below 1'000 or from 10'000'001 on.

For a linked member the database refuses changes to name, birthday,
mobile, e-mail, labels and status made through the API by signed-in staff
(`trigger_guard_provider_fields`, error `MANAGED_BY_PROVIDER`), and the link
blocks deleting the member. The sync (service role), migrations and
SECURITY DEFINER functions are not restricted. The member page shows
"kommen aus Webling" and only offers the notes for editing.

## Enforcing sign-in by status (phase 1b)

Before switching, an admin reviews **Benutzer → Verlieren den Zugang,
sobald die Mitgliedschaft zählt** (`member_access_report()`): the approved
member accounts none of whose member records is active or passive. Then:

1. Check the list for people who should keep access; fix their groups in
   Webling (the next sync updates the status).
2. Members whose e-mail exists only in Administra (entered before the
   fields became read-only) keep it, but it should be entered in Webling too.
3. The phase 1b migration changes `grant_member_access`, `my_member_ids` and
   `get_member_directory` to require an active or passive membership and
   sets the listed accounts back to _Ausstehend_.

Until then nothing about sign-in has changed.
