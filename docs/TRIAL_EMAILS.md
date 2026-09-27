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

| Placeholder                 | Value                                                     |
| --------------------------- | --------------------------------------------------------- |
| `{firstname}`, `{lastname}` | the candidate                                             |
| `{club}`, `{clubUrl}`       | club name and website (settings → Verein)                 |
| `{contactEmail}`            | the club's contact address, or the website if none is set |
| `{trainings}`               | one line per assigned training: weekday, time, title      |

The preview dialog shows the filled-in mail and can be edited before
sending; edits there only affect that one mail.

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
