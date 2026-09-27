# Member sign-in

Club members sign in themselves with the email address the club has on file
and get a personal area at `/club`:

- **Mein Profil** – own grades, medals, badges, attendance and contact
  details. A parent whose email is on file for several children sees all of
  them and switches between them at the top.
- **Mitglieder** – directory of active members (trained in the 12 months up
  to the latest recorded training) with photo, sections, belt and badges.
  Tapping a member shows their public profile (grades, medals, badges – no
  birthday, phone, email or attendance).

Staff (viewer / trainer / admin) keep the dashboard and reach their own
profile via the avatar menu → _Mein Profil_.

## How it works

1. On the login page the person enters their email and gets a 6-digit code
   (`signInWithOtp`), or uses Google as before.
2. After the code is verified Supabase marks the email as confirmed. The
   `handle_auth_user_change` trigger then calls `grant_member_access`: if a
   member record carries that email (case-insensitive, trial candidates
   excluded), the account is approved with role `member`.
3. No match → the account stays `pending` and the pending page explains why.
   As soon as a trainer adds the email to a member (or Webling syncs it), the
   `grant_member_access_on_member_change` trigger lets the person in; they
   just tap _Aktualisieren_.

Trial candidates (label `probetraining` / `Probetraining`) never grant
access: the public trial form lets anyone create such a record with any
email. Once a trainer takes them on (removes the label), access follows.

Admins can still approve anybody manually and change a member's role in
_Benutzer_; disabled accounts are never re-enabled automatically.

## Access rules

| Data                                                               | member                     | viewer+ |
| ------------------------------------------------------------------ | -------------------------- | ------- |
| Own member row, attendance, event history                          | yes                        | yes     |
| Other members: name, photo, sections                               | via `get_member_directory` | yes     |
| Grades, medals, badges                                             | yes                        | yes     |
| Trainings, events (no participant lists)                           | yes                        | yes     |
| Contact data, attendance of others, lesson plans, trial candidates | no                         | yes     |

Implemented in `supabase/migrations/20260926090100_member_self_service.sql`
(`is_staff()`, `my_member_ids()`, `*_read_own` policies).

## Setup on hosted projects (Dev / Prod)

`supabase/config.toml` configures local and preview branches. On the hosted
projects set this once in the Supabase dashboard:

1. **Custom SMTP** (Authentication → Emails → SMTP Settings). The built-in
   mailer only sends a handful of emails per hour and only to project team
   members, so sign-in codes would not arrive without it.
2. **Email templates** (Authentication → Email Templates): paste
   `supabase/templates/sign_in_code.html` into both _Magic Link_ and
   _Confirm signup_ (subject: `Dein Anmeldecode für Administra`). The
   default templates only contain a link, not the code.
3. **Email OTP length** stays at 6 digits (the app expects 6).
4. **Webling**: `webling-sync` now also syncs the member's `E-Mail`
   property, so members can sign in with the address stored there.

## Testing

`supabase/seed.sql` contains `member@example.com` / `testpass`, whose
email is on file for two siblings (Leo Scott, Brandon Guzman). Use the
preview test login with it to see the member area.
