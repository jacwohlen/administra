# Uptime monitoring

An external service calls the app every few minutes and e-mails us when it
stops answering, so we notice an outage before a trainer stands in front of
a group without the attendance list. Error monitoring (Sentry, see
`ERROR_MONITORING.md`) only sees errors while people use the app; the
uptime check also covers "nobody can reach it at all".

## Health endpoint

`GET /api/health` (`src/routes/api/health/+server.ts`) answers:

- `200 {"status":"ok"}` when the app runs and the database answers a tiny
  query (one row of `app_settings`, readable without login),
- `503 {"status":"error"}` otherwise, e.g. Supabase down or paused, or the
  query takes longer than 5 seconds.

It never returns details (the endpoint is public). The reason is in the
Netlify function log ("Health check failed: …").

## Monitors

We use [UptimeRobot](https://uptimerobot.com) (free plan, EU company).
Better Stack works the same way if we ever switch.

| Monitor           | URL                                          | Type    | Interval | Alert    |
| ----------------- | -------------------------------------------- | ------- | -------- | -------- |
| Administra (prod) | `https://admin.jacwohlen.ch/api/health`      | Keyword | 5 min    | yes      |
| Administra (dev)  | `https://main.admin.jacwohlen.ch/api/health` | Keyword | 5 min    | optional |

Keyword monitor settings: keyword `"status":"ok"`, alert when the keyword is
**not** present. This also fails on a 503 or an error page, not only when
the site is completely down.

## Setup (once)

1. Create a free account at uptimerobot.com (ideally with a shared club
   address, so the next maintainer gets the alerts too).
2. Add New Monitor → type **Keyword**, URL as above, keyword
   `"status":"ok"`, "Alert when keyword does not exist", interval 5 minutes.
3. Alert contacts: your e-mail. Optional: the UptimeRobot app for push
   notifications.
4. Optional: a public status page (Status Pages → add the monitors).

## When an alert arrives

1. Open the URL in a browser. `{"status":"error"}` means the app runs but
   the database does not answer: check the Supabase dashboard (project
   paused? outage on status.supabase.com?).
2. No answer or a Netlify error page: check Netlify → Deploys (failed
   deploy?) and netlifystatus.com.
3. Netlify → Logs → Functions shows the "Health check failed" line with the
   reason.
4. Sentry may show the same problem from real users' requests.
