# Performance

How fast Alleda loads, how to measure it, and the rules that keep it fast.
Netlify's functions and the Supabase database both run in Frankfurt.

## Measuring

### Real users: Sentry traces

With `PUBLIC_SENTRY_DSN` set, `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (default
`0.2`, i.e. every fifth page load; `0` turns it off, `1` sends all) sends
traces to Sentry: page loads and navigations with their Web Vitals (LCP,
INP, CLS), the load functions, and every Supabase request of the page as a
span. In Sentry: _Insights → Frontend_ (Web Vitals per page) and _Explore
→ Traces_ (one page load as a timeline: which request waits for which).
Query values in request URLs are filtered before sending (see
`docs/ERROR_MONITORING.md`).

### In the lab: `npm run perf:measure`

`scripts/perf/measure.mjs` loads pages in Chromium with a cold cache and
prints the median of several runs: time to first byte, first paint (FCP),
largest paint (LCP), the time until the page is quiet (its data loaded),
JavaScript downloaded, and the Supabase requests (count, and the time from
the first to the last answer).

```sh
npm run perf:measure                                  # demo.alleda.ch, as trainer
npm run perf:measure -- --role admin --runs 7 --mobile
npm run perf:measure -- --base-url http://localhost:4173 --pages /dashboard,/dashboard/members
npm run perf:measure -- --json > before.json
```

- The demo (`PUBLIC_MODE=DEMO`) signs in through its role buttons. For any
  other site save a signed-in browser state once
  (`npx playwright codegen --save-storage=perf-login.json <url>`, sign in,
  close the window) and pass `--storage-state perf-login.json`. The file
  holds a session: it is in `.gitignore`, delete it afterwards.
- `--mobile` throttles to a phone on a fair mobile connection (150 ms
  latency, 1.6 Mbit/s, 4× slower CPU).
- Compare a change against `main` on the same machine, one after the other
  and several rounds (numbers vary by ±20 % between runs): build both
  against the same database (the demo works: `PUBLIC_MODE=DEMO`, its URL
  and publishable key), `npx vite preview` each on its own port, measure
  both. Absolute numbers depend on where you measure from; a cloud machine
  far from Frankfurt adds its distance to every request.

### Bundle: `npm run perf:bundle`

After `npm run build`, `scripts/perf/bundle-report.mjs` lists per route what
the first visit downloads, gzip-compressed: JavaScript and CSS of the
route's layouts and page with their static imports (dynamic imports such as
the statistics charts and the language file come on top). `--top 10`,
`--json`, and `--max-kb 300` fails when a route needs more JavaScript.

### Database

Supabase dashboard → _Advisors → Performance_ (or the Supabase MCP tool
`get_advisors`) and _Query Performance_ (`pg_stat_statements`: the slowest
and most frequent statements).

## What is done, and the rules

1. **No request waits for another without need.** On a first visit the
   browser gets the root layout's server data (`__data.json`), and only
   then do SvelteKit's universal loads run; a layout or page that awaits
   `parent()` waits for all layouts above it. So:
   - `src/hooks.client.ts` starts the club settings (`loadAppSettings()`)
     and, for a session on the dashboard, the integration configuration as
     the app boots; the layouts await the same requests (both loaders share
     an in-flight request).
   - Page loads ask what they can before `await parent()`: start the
     queries that need only `params` together with `parent()` in one
     `Promise.all` (see `exams/[examId]/+page.ts`, `sheet`, `print`,
     `events/[eventId]/+page.ts`), never one after the other.
   - Data for the first view belongs in `+page.ts`, not in the component
     (`onMount` or top-level calls): a component asks only once all loads
     are done and it is shown. The dashboard's day (`dashboard/+page.ts`,
     `dayOverview.ts`) is the example.

   Measured on the demo (15 cold loads each, 31.10.2026): the dashboard
   showed its content after 1.46 s, now after 0.80 s; members, events and
   trainings lists from about 1.45 s to 0.85 s.

2. **The server checks the session locally.** `safeGetSession()` in
   `src/hooks.server.ts` verifies the session's token with `getClaims()`:
   with Supabase's asymmetric JWT signing keys (ES256) that is a signature
   check against the cached public key, without a request to Supabase Auth.
   With the legacy shared secret (HS256) `getClaims()` still asks the Auth
   server like `getUser()` did. Switch a project over in the Supabase
   dashboard: _Project Settings → JWT Keys → Migrate JWT secret_, then
   rotate to the new key (existing sessions stay valid until they expire).
   The demo already uses ES256; production and the club projects should
   follow.

3. **Each language loads one file.** svelte-i18n loads the fallback
   language's messages along with the chosen one. The fallback follows the
   language (`src/lib/i18n/appLocale.ts`, `setAppLocale()`): German
   browsers load `de.json` only (about 30 KB gzip less on the first
   visit). Set the language with `setAppLocale()`, not `locale.set()`. Both
   files have the same keys (`i18n.test.ts`), so nothing is ever missing.

4. **Heavy libraries are loaded where they are used.** The statistics
   charts (Carbon, d3, about 150 KB gzip) are a dynamic import of the
   statistics page; keep big dependencies out of layouts and shared modules.

## Known, not changed

- **Check-in writes**: an insert into `logs` takes about 25 ms in the
  database, `set_attendance` about 55 ms, mostly the badge triggers
  (`trg_badges_on_log`, `trg_season_badges_on_log`) recomputing a member's
  badges. Fine per click; if it becomes noticeable, the badge refresh
  could move to a batched job.
- **Advisor notes**: five tables have two permissive SELECT policies (staff
  and own rows). Postgres combines them into one `OR` with the staff check
  evaluated once per statement (`(SELECT is_staff())`), so merging them
  gains nothing measurable. The unindexed foreign keys are audit columns
  (`created_by`, `updated_by`) that no query filters by.
- **Sentry in the entry chunk** (about 46 KB gzip): loading it later would
  lose errors of the first moments; kept.
