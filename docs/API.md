# API for other systems

Alleda answers other systems under `/api/v1/` of each instance (JAC Wohlen:
`https://admin.jacwohlen.ch/api/v1/…`, a club instance on its own domain).
The first endpoint is the training plan, for the club's website: who leads
which training on which date, the topic, and what is dropped. The second
gives the participants of an event, for a program writing reports about
events. More endpoints follow the same rules: versioned path, API key with
scopes, JSON, only what the key's scope names.

## API keys

Admins manage keys on _Integrationen_ (`/dashboard/integrations`, section
_API-Schlüssel_):

- **New key**: a name (e.g. "Vereinswebseite"), what it may read (scopes,
  below), how trainers are named (training plan) and which websites may
  read in the browser (not for personal data). The key (`alleda_` and 48 hex characters) is shown
  **once**; the database keeps only its SHA-256 and the first 8 characters
  to recognise it in the list.
- **Edit**: name, scopes, trainer names and websites; the key stays the
  same.
- **Delete**: revokes it at once. A lost key is deleted and replaced.
- The list shows when each key was last used (noted at most once a
  minute).

A system sends the key in a header, never in the URL:

```
Authorization: Bearer alleda_…
```

### Scopes

| Scope                     | Endpoints                                                    | Gives                                                                        |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `training_plan:read`      | `GET /api/v1/training-plan`                                  | Planned trainings, every date with time, who leads, topic, dropped, holidays |
| `event_participants:read` | `GET /api/v1/events`, `GET /api/v1/events/{id}/participants` | Events with date, place and counts; per event the names of who took part     |

`event_participants:read` gives personal data, so such a key is **for
servers only**: the database refuses websites for it
(`api_keys_personal_data_server_only`), and with no website listed every
request from a browser is refused (`403 origin_not_allowed`, below). The
key stays on the program's server, like a password.

A new scope needs the scope in the `api_keys.scopes` check, in `API_SCOPES`
(`src/lib/publicApi.ts`; in `SERVER_ONLY_SCOPES` and the
`api_keys_personal_data_server_only` check when it gives personal data), a
`SECURITY DEFINER` function that calls `api_key_use(p_key, '<scope>')`
first, and its line in `supabase/checks/member_data.sql`.

### Trainer names

Per key: _full_ (`Anna Muster`), _initial_ (`Anna M.`) or _none_. The
database formats the names, so with _none_ neither names nor member ids
leave it.

### Browser or server

The key is the only credential. **A website that fetches in the browser
puts the key into its page source**, so it is public: other websites cannot
use it (CORS, below), but any program can. That is acceptable only because
a `training_plan:read` key returns what may be public anyway. Better, and
needed for any future scope with non-public data: the website's server
fetches (a WordPress plugin, a build step, a small proxy) and keeps the key
secret. Such a key lists no websites.

### CORS

Per key, the websites (origins: `https://www.example.ch`, scheme, host and
port without a path) whose pages may read the answer in the browser.

- A preflight (`OPTIONS`) has no `Authorization` header, so it cannot know
  the key: it allows every origin to send `Authorization` with `GET`.
- The `GET` itself answers with `Access-Control-Allow-Origin` only for an
  origin the key lists. A request from any other page (`Origin` sent but
  not listed) is refused with `403 origin_not_allowed`, so a key copied
  from the club's website does not work on another site.
- Requests without `Origin` (servers, `curl`) are not affected.
- No wildcard: every website is listed.

## GET /api/v1/training-plan

```
GET /api/v1/training-plan?from=2026-11-02&to=2026-12-31&training=26,27
Authorization: Bearer alleda_…
```

| Parameter  | Default          | Meaning                                             |
| ---------- | ---------------- | --------------------------------------------------- |
| `from`     | today (Zurich)   | First date, `YYYY-MM-DD`                            |
| `to`       | `from` + 55 days | Last date, inclusive; at most 366 days after `from` |
| `training` | all planned      | Training ids, separated by commas (see `trainings`) |

Answer (`application/json`):

```json
{
  "from": "2026-11-02",
  "to": "2026-12-31",
  "timezone": "Europe/Zurich",
  "trainings": [
    {
      "id": 26,
      "title": "Judo Randori",
      "weekday": "Wednesday",
      "start": "20:00",
      "end": "21:30",
      "section": "Judo"
    }
  ],
  "sessions": [
    {
      "date": "2026-11-04",
      "trainingId": 26,
      "title": "Judo Randori",
      "start": "20:00",
      "end": "21:30",
      "trainer": "Anna Muster",
      "topic": "Uchi-mata",
      "cancelled": false,
      "cancelReason": null,
      "holiday": null
    },
    {
      "date": "2026-12-23",
      "trainingId": 26,
      "title": "Judo Randori",
      "start": "20:00",
      "end": "21:30",
      "trainer": "Anna Muster",
      "topic": null,
      "cancelled": true,
      "cancelReason": "Weihnachten",
      "holiday": null
    }
  ],
  "holidays": [
    { "title": "Weihnachten", "from": "2026-12-21", "to": "2027-01-03", "dojoClosed": true }
  ]
}
```

- `trainings`: the trainings in the plan (_Trainings & Ferien_). `weekday`
  in English as in Alleda; `start` / `end` local time `HH:MM`, `null` when
  the training has none.
- `sessions`: one per training and date in the period, by date and start
  time, computed by `buildPlan()` exactly as the plan page and the calendar
  feeds (`docs/TRAINING_PLAN.md`):
  - `trainer`: the planned trainer, else the training's main trainer;
    `null` when open, or when the key shows no names
  - `topic`: `null` without one
  - `cancelled`: dropped, by the TK (_Fällt aus_) or by a holiday closing
    the dojo; `cancelReason` is that holiday's title, `null` when the TK
    dropped the date (their note may say why, but notes stay internal)
  - `holiday`: the holidays the training takes place in (school holidays,
    or a closed dojo the TK held the date in)
- `holidays`: every holiday overlapping the period (`dojoClosed`: planned
  trainings are dropped).

Not in the answer, whatever the key: notes, e-mail addresses, member ids,
attendance, events, anything about members other than the trainers'
names.

### Errors

`{ "error": { "code": "…", "message": "…" } }`, readable by every origin:

| Status | Code                 | When                                                         |
| ------ | -------------------- | ------------------------------------------------------------ |
| 400    | `invalid_request`    | A parameter or the event id malformed, period too long       |
| 401    | `unauthorized`       | No key, a malformed or unknown one, or one without the scope |
| 403    | `origin_not_allowed` | Sent from a website the key does not list                    |
| 404    | `not_found`          | No event with this id (participants)                         |
| 503    | `unavailable`        | The database did not answer (retry later)                    |

### Caching

`Cache-Control: private, max-age=300`: browsers and the website's server
may keep an answer for five minutes; shared caches (CDNs) must not, since
the answer depends on the key. Changes in the plan show after at most that.
A website that fetches on every page view should cache on its side as well.

## GET /api/v1/events

Finds an event (its `id`) for the participants below.

```
GET /api/v1/events?from=2026-06-01&to=2026-07-31
Authorization: Bearer alleda_…
```

| Parameter | Default           | Meaning                                             |
| --------- | ----------------- | --------------------------------------------------- |
| `from`    | 90 days ago       | First date, `YYYY-MM-DD`                            |
| `to`      | `from` + 179 days | Last date, inclusive; at most 366 days after `from` |

Every event overlapping the period (a camp that began before `from` too),
by date and start time:

```json
{
  "from": "2026-06-01",
  "to": "2026-07-31",
  "timezone": "Europe/Zurich",
  "events": [
    {
      "id": 10000005,
      "title": "Sommerlager",
      "date": "2026-07-06",
      "dateTo": "2026-07-10",
      "allDay": true,
      "start": null,
      "end": null,
      "location": "Tenero",
      "section": "Judo",
      "registered": 24,
      "attended": 22
    }
  ]
}
```

- `dateTo`: the last day, the same as `date` for a one-day event.
- `start` / `end`: local time `HH:MM`, `null` all day or without a time.
- `registered`: registrations not cancelled; `attended`: members recorded
  as present (_Anwesenheit_ on the event page).
- Not in the answer: the description (it can hold anything).

## GET /api/v1/events/{id}/participants

Who took part in an event, e.g. for the participants section of a report.

```
GET /api/v1/events/10000005/participants?attended=true
Authorization: Bearer alleda_…
```

| Parameter  | Default | Meaning                                                    |
| ---------- | ------- | ---------------------------------------------------------- |
| `attended` | `false` | `true`: only members recorded as present; else all of them |

```json
{
  "event": { "id": 10000005, "title": "Sommerlager", "date": "2026-07-06", "…": "as above" },
  "participants": [
    {
      "memberId": 4711,
      "firstname": "Anna",
      "lastname": "Muster",
      "registered": true,
      "attended": true,
      "coach": false
    }
  ]
}
```

- `participants`: every member registered (not cancelled) or recorded as
  present, by last and first name. A cancelled registration without
  attendance is no participant.
  - `registered`: registered for the event (also _abwesend_: registered,
    not there)
  - `attended`: recorded as present (also without registration, e.g.
    added on the day)
  - `coach`: present as coach / leader
  - `memberId`: the member's id in Alleda (the Webling id for members from
    Webling), to tell two people with the same name apart
- Not in the answer, whatever the key: e-mail, phone, address, birthday,
  notes, grades, anything else about members.
- `404 not_found`: no event with this id. Both endpoints answer
  `Cache-Control: no-store`.

## Examples

Server (PHP, e.g. in a WordPress plugin), the key in the configuration:

```php
$response = wp_remote_get(
  'https://admin.jacwohlen.ch/api/v1/training-plan',
  ['headers' => ['Authorization' => 'Bearer ' . ALLEDA_API_KEY], 'timeout' => 10]
);
$plan = json_decode(wp_remote_retrieve_body($response), true);
set_transient('alleda_training_plan', $plan, 15 * MINUTE_IN_SECONDS);
```

Report program (Python), the key from the environment, never in the code:

```python
import os, requests

r = requests.get(
    f"https://admin.jacwohlen.ch/api/v1/events/{event_id}/participants",
    params={"attended": "true"},
    headers={"Authorization": f"Bearer {os.environ['ALLEDA_API_KEY']}"},
    timeout=10,
)
r.raise_for_status()
names = [f"{p['firstname']} {p['lastname']}" for p in r.json()["participants"]]
```

Browser (the key is public, see above; the website listed on the key):

```js
const response = await fetch('https://admin.jacwohlen.ch/api/v1/training-plan', {
  headers: { Authorization: 'Bearer alleda_…' }
});
const { sessions } = await response.json();
for (const s of sessions) {
  console.log(s.date, s.start, s.title, s.cancelled ? 'fällt aus' : s.trainer, s.topic ?? '');
}
```

## Implementation

- `supabase/migrations/20261110120000_api_keys.sql`:
  - `api_keys`: admins read (without `key_hash`: column grants), change
    name, scopes, origins and trainer names, and delete; inserts only
    through `api_key_create()`. The checks refuse unknown scopes, origins
    with a path or a wildcard, and unknown name modes.
  - `api_key_create(p_name, p_scopes, p_allowed_origins, p_trainer_names)`:
    admins; returns `{ id, key }`, the only time the key is seen.
  - `api_key_use(p_key, p_scope)`: the key's row for a well-formed key with
    the scope, notes the use; internal (no grant to the API roles).
  - `api_training_plan(p_key, p_from, p_to)`: granted to `anon`; `NULL` for
    any other key, `22023` for a period over 400 days. Returns the key's
    origins (for CORS), the planned trainings, the sessions of the period
    without notes, the overlapping holidays and the trainers' names as the
    key says.
- `supabase/migrations/20261111120000_api_event_participants.sql`: the
  scope `event_participants:read` (no websites with it),
  `api_events(p_key, p_from, p_to)` and
  `api_event_participants(p_key, p_event_id)`, granted to `anon` like the
  plan; `NULL` for any other key. They read `events`, `event_participants`
  (registrations) and `event_logs` (attendance) and return members' id and
  name only.
- `src/routes/api/v1/training-plan/+server.ts`: reads the key and the
  query, calls the function with the anon key (no session), checks the
  origin, builds the answer with `buildApiTrainingPlan()`
  (`src/lib/publicApi.ts`). The key goes to the database in the RPC's POST
  body, never in a URL; Sentry keeps no `Authorization` header
  (`docs/ERROR_MONITORING.md`).
- `src/routes/api/v1/events/+server.ts`,
  `src/routes/api/v1/events/[eventId]/participants/+server.ts`: the same
  for events, without a preflight (no browser may read them) and without
  caching; answers built by `buildApiEvents()` /
  `buildApiEventParticipants()`.
- `src/lib/server/api.ts`: JSON answers, errors, preflight and the origin
  check for every `/api/v1/` endpoint.
- `src/routes/dashboard/integrations/ApiKeys.svelte`: the admin section.
- Checks: `supabase/checks/api_keys.sql` (keys per role, the hash
  unreadable, the plan per key, refused keys and periods, events and
  participants: servers only, names only) and the list of
  anon functions in `supabase/checks/member_data.sql`.

### Limits

- No rate limit of its own: a key is 192 random bits, so guessing is
  hopeless, and Netlify's function limits apply. A key a website abuses is
  deleted.
- One instance, one club: a key reads the instance it was made on.
- Read only; writing endpoints would need keys that are never in a browser.
