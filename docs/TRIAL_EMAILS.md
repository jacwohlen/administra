# E-mails to trial candidates

The trial intake (`/dashboard/probetraining`) sends three kinds of mail
through the club's SMTP server:

| Mail                        | When                                                                | Preview                             |
| --------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| **Danke für die Anmeldung** | right after the public form (`/probetraining`) is submitted         | no, sent automatically              |
| **Warteliste**              | offered after "Auf Warteliste"                                      | yes, nothing leaves before "Senden" |
| **Training zugewiesen**     | offered after a training was assigned; lists the assigned trainings | yes                                 |

Staff can also open any of the three from the candidate's row ("E-Mail"),
e.g. to resend one that failed. Every mail is logged in `trial_emails` and
shown in the candidate's timeline with its status: _gesendet_,
_fehlgeschlagen_ (with the SMTP error), _nicht gesendet_ (SMTP not
configured) or _ausstehend_.

Mails are plain text in the language the candidate registered in (the
public form's DE/EN switch; stored as `members."trialLocale"`).

## Templates

Admins edit the texts under **Einstellungen → E-Mails an
Probetraining-Kandidaten**, per mail and language. An empty field keeps the
built-in text from `src/lib/trialMail.ts`. Placeholders:

| Placeholder                 | Value                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `{firstname}`, `{lastname}` | the candidate                                                                                                               |
| `{club}`, `{clubUrl}`       | club name and website (settings → Verein)                                                                                   |
| `{contactEmail}`            | the club's contact address, or the website if none is set                                                                   |
| `{trainings}`               | one line per assigned training: weekday, time, title, the first session when one was picked, and the main trainer's contact |

The preview dialog shows the filled-in mail and can be edited before
sending; edits there only affect that one mail.

## First session

When a training is assigned, the dialog offers the next eight sessions of
that training as the candidate's first one; the next session is selected,
so a click on "Zuweisen" keeps it. Pick a later one when the group is full
this week. The date is stored per assignment (`participants."trialStartDate"`),
can be changed or cleared later in the same dialog, and shows up in the
overview, in `{trainings}` ("– erstes Training am Freitag, 16.10.2026") and on
the status page. Once it has passed, it is left out of mails and the status page.

## Main trainer

A training can have a main trainer (**Trainings → Bearbeiten →
Haupttrainer/in**, `trainings."mainTrainerId"`), for trainings that are
always led by the same person, such as the kids' trainings. Leave it empty
when the trainers rotate. Trainers are members, so name, mobile and e-mail
come from their member record. In `{trainings}` the training then gets an
indented line, e.g. "Ansprechperson: Anna Muster, 079 123 45 67,
anna@example.ch", so the candidate contacts the trainer directly from then
on. The status page does not show it: it needs no account, and the
trainer's details stay in the mail.

## Status page

Every candidate has a personal, unguessable link,
`/probetraining/status/<token>` (`members."trialToken"`). The built-in
templates include it, the confirmation page after registering links to it,
and staff can copy it from the candidate's row ("Status-Link").

The page needs no account. It shows the first name, the current status
(received, waiting list, training with day and time, cancelled, or member
once the trial label is removed), the registration date and the section —
nothing else about the candidate. While the registration is active, the
candidate can cancel it there; that sets the status to _abgesagt_ with
`"trialSelfCancelled"`, removes the training assignments, and shows up as
"Selbst abgemeldet" in the dashboard. It is marked `noindex` and sends no
referrer.

Both actions go through SECURITY DEFINER functions keyed by the token,
`get_trial_status(token)` and `cancel_trial(token)`
(`supabase/migrations/20260928090000_trial_status_page.sql`).

## SMTP setup (Netlify)

Set these environment variables for the **Production** and branch
(`main`) deploy contexts — _not_ for Deploy Previews, so preview branches
with seed data never mail anyone:

| Variable                | Example                                               |
| ----------------------- | ----------------------------------------------------- |
| `PRIVATE_SMTP_HOST`     | `smtp.example.ch`                                     |
| `PRIVATE_SMTP_PORT`     | `587` (STARTTLS, the default) or `465` (implicit TLS) |
| `PRIVATE_SMTP_USER`     | the SMTP login                                        |
| `PRIVATE_SMTP_PASSWORD` | mark as **secret** in Netlify                         |
| `PRIVATE_SMTP_FROM`     | `JAC Wohlen <probetraining@jacwohlen.ch>`             |

### Reusing the SMTP server of the sign-in codes

No separate mail server is needed: the server already configured in the
Supabase dashboard for the sign-in codes (Authentication → Emails → SMTP
Settings, see `docs/MEMBER_SIGN_IN.md`) works here too. The app cannot read
those settings — Supabase uses them internally and never returns the
password — so enter the same values a second time in Netlify:

| Supabase SMTP setting        | Netlify variable        |
| ---------------------------- | ----------------------- |
| Host                         | `PRIVATE_SMTP_HOST`     |
| Port                         | `PRIVATE_SMTP_PORT`     |
| Username                     | `PRIVATE_SMTP_USER`     |
| Password                     | `PRIVATE_SMTP_PASSWORD` |
| Sender name and sender email | `PRIVATE_SMTP_FROM`     |

- **Sender address**: safest is the same one Supabase uses. A different
  one (e.g. `probetraining@…`) only works if the mail provider allows that
  sender for this login; otherwise mails are rejected or end up in spam.
  Replies reach the club's contact address anyway (`Reply-To`), so a
  `noreply@…` sender is fine.
- **Password changes** have to be made in both places, Supabase and
  Netlify (followed by a redeploy).
- **Sending limits** of the mail provider, if any, are shared between
  sign-in codes and trial mails.

Replies go to the contact e-mail from the settings (`Reply-To`). The
variables are read at runtime (`$env/dynamic/private`), so a deploy without
them still builds; mails are then logged as _nicht gesendet_ and the preview
dialog says so. Changing them takes effect with the next deploy.

## How it works

- The public form posts to `/api/probetraining/register`. The endpoint
  calls `register_trial()` (SECURITY DEFINER), which validates the input,
  creates the candidate and a pending `welcome` row in `trial_emails`, and
  returns a one-time token for that row. The endpoint sends the mail and
  records the outcome with `complete_trial_email(id, token, …)`. Anonymous
  clients can neither read `trial_emails` nor insert into `members`
  directly.
- Staff mails go through `/api/probetraining/mail` with the signed-in
  user's session, so row-level security applies: viewers can see the log,
  trainers and admins (`is_writer()`) can send. The recipient is always the
  address stored on the candidate.
- A failed mail never fails the registration or the status change; it
  stays in the log for a resend.

Code: `src/lib/trialMail.ts` (templates, rendering),
`src/lib/server/mailer.ts` (SMTP), `src/routes/api/probetraining/`,
`supabase/migrations/20260927230000_trial_emails.sql`.
