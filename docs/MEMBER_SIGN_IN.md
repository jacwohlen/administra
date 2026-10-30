# Member sign-in

Club members with an active or passive membership sign in themselves with
the email address the club has on file and get a personal area at `/club`:

- **Mein Profil** – own grades, medals, badges, attendance and contact
  details. A parent whose email is on file for several children sees those
  whose membership counts and switches between them at the top.
- **Mitglieder** – directory of active and passive members who trained in
  the 12 months up to the latest recorded training, with photo, sections,
  belt and badges.
  Tapping a member shows their public profile (grades, medals, badges – no
  birthday, phone, email, attendance or badge progress, which counts
  trainings).

Staff (viewer / trainer / admin) keep the dashboard and reach their own
profile via the avatar menu → _Mein Profil_.

## How it works

1. On the login page the person enters their email and gets a 6-digit code
   (`signInWithOtp`), or uses Google as before.
2. After the code is verified Supabase marks the email as confirmed. The
   `handle_auth_user_change` trigger then calls `grant_member_access`: if an
   active or passive member record carries that email (case-insensitive, not
   archived, trial candidates excluded), the account is approved with role
   `member`. The bootstrap
   admin email (`is_bootstrap_admin()`) likewise only becomes admin once it
   is confirmed.
3. Otherwise the account waits (`pending`, role `member`) and the pending
   page says why: email not on file, trial candidate, or on file without an
   active or passive membership (with the status from the member register,
   `my_access()`). As soon as the email is on a record that counts, or a
   record starts to count (Aktiv in Webling, back in Webling, unarchived),
   the `grant_member_access_on_member_*` triggers let the person in; they
   just tap _Aktualisieren_. For a member that is in Webling the email is
   entered in Webling and arrives with the next sync; for a member created
   in Adsumus (or gone from Webling) a trainer adds it here.

Trial candidates (label `probetraining` / `Probetraining`) never grant
access: the public trial form lets anyone create such a record with any
email. Once a trainer takes them on (removes the label), access follows.
While a member is in Webling, the email can only be changed there.

### Losing and regaining access

A member account keeps access only while one of its member records is an
active or passive membership (`membership_status`, see
`docs/INTEGRATIONS.md`), checked on every request. When the Webling sync
marks the member as left or non-member, the member is archived or deleted,
or the email moves to another address, the account sees nothing from the
next request on and the app shows the pending page ("Kein Zugang", with the
status). The account stays approved: once a record counts again, access is
back without anyone approving it.

New accounts wait with the role `member`. An admin approving one by hand
gives member access, which still needs a membership that counts; _Benutzer_
marks such accounts (_Kein Zugang_) and shows the status of each record. For
trainers and board members pick the staff role before approving: staff get
in by their role. Disabled accounts are never re-enabled automatically.

### Duplicate members

When an admin merges a duplicate (`docs/INTEGRATIONS.md`, "Merging
duplicates"), an account linked to the removed record is linked to the one
that stays; if both records are linked to accounts, the merge is refused
until one link is removed under _Benutzer_. The e-mail of the removed
record is only taken over by a record without one that is not in Webling,
and never from a trial registration. An account that found the removed
record only by its e-mail loses it, and a member account also loses a
record that stays but does not count (a parent keeps access through
another child but no longer sees this one): the preview lists each
account whose access changes (only member accounts can lose it) or that
no longer finds, or newly finds, the record. Link it under _Benutzer_ or
put the e-mail on the record that stays (in Webling for Webling members);
the merge never links an account by e-mail, as a trainer's or a parent's
address would link the wrong person.

## Access rules

| Data                                                                                  | member (active/passive)    | viewer+ |
| ------------------------------------------------------------------------------------- | -------------------------- | ------- |
| Own member rows that count, their attendance, event history and badge progress        | yes                        | yes     |
| Directory: name, photo, sections                                                      | via `get_member_directory` | yes     |
| Grades, medals, badges and photo of own members and the directory                     | yes (`club_member_ids()`)  | yes     |
| Grades, medals, badges and photo of anyone else                                       | no                         | yes     |
| Recent achievements, badge leaderboard, medal counts                                  | no (staff pages only)      | yes     |
| Trainings, events (no participant lists)                                              | yes                        | yes     |
| Exam days, own registrations (results only as the new grade)                          | yes (`docs/Q_EXAMS.md`)    | yes     |
| Contact data, attendance and badge progress of others, lesson plans, trial candidates | no                         | yes     |

The directory is own members plus the active and passive members (not
archived, no trial label) who trained in the 12 months up to the latest
recorded training; `club_member_ids()` is that set, and the directory, the
member tables, the RPCs and the `avatars` bucket all use it. RPCs taking a
member id check it with `can_see_member()`. Photos are stored as
`<member id>_<upload time>.webp`; files named otherwise are staff-only.

A member account without an active or passive membership gets nothing (the
pending page says why).

Implemented in `supabase/migrations/20260926090100_member_self_service.sql`
(`is_staff()`, `my_member_ids()`, `*_read_own` policies),
`20261027120000_member_access_requires_membership.sql` (the membership rule
in `is_approved_user()` / `my_member_ids()`, `my_access()`) and
`20261028100000_member_data_only_for_club_members.sql` (`club_member_ids()`,
`can_see_member()`). `supabase/checks/member_data.sql` probes every table,
view and RPC as a member account, and fails when a SECURITY DEFINER function
the API can call is not listed there with its guard, or one taking a member
id checks neither the member nor a staff role.

## Setup on hosted projects (Dev / Prod)

`supabase/config.toml` configures local and preview branches. On the hosted
projects set this once in the Supabase dashboard:

1. **Custom SMTP** (Authentication → Emails → SMTP Settings). The built-in
   mailer only sends a handful of emails per hour and only to project team
   members, so sign-in codes would not arrive without it.
2. **Email templates** (Authentication → Email Templates): paste
   `supabase/templates/sign_in_code.html` into both _Magic Link_ and
   _Confirm signup_ (subject: `Dein Anmeldecode für Adsumus`). The
   default templates only contain a link, not the code.
3. **Email OTP length** stays at 6 digits (the app expects 6).
4. **Confirm email** (Authentication → Sign In / Providers → Email) must be
   **on**. Automatic approval trusts `auth.users.email_confirmed_at`: with
   confirmations off, Supabase sets it on a password sign-up without any
   proof, so anyone could sign up with a member's address (or the bootstrap
   admin's) and get in. `config.toml` sets `enable_confirmations = true` for
   local and preview branches.
5. **Webling**: `webling-sync` now also syncs the member's `E-Mail`
   property, so members can sign in with the address stored there.
6. **Storage bucket `avatars`** must be **private** (Storage → avatars →
   Edit bucket, or `SELECT public FROM storage.buckets WHERE id = 'avatars'`
   gives `false`). A public bucket serves every photo by URL without asking
   the read policy. The app only downloads photos through the API, and
   `20261028100000_member_data_only_for_club_members.sql` makes the bucket
   private where the migration may; it warns where it may not.

## Testing

`supabase/seed.sql` contains `member@example.com` / `testpass`, whose
email is on file for two siblings (Leo Scott, Brandon Guzman). Use the
preview test login with it to see the member area (local and Deploy
Previews only; the dev environment is not seeded). `former@example.com` /
`testpass` is on file only for a member who left (Joseph Fernandez) and was
approved by hand: it shows the pending page's "Kein Zugang".
`supabase/checks/member_access.sql` and `supabase/checks/member_data.sql`
check the rules on the database.
