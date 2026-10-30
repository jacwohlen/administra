# J+S export (attendance → NDS)

Alleda exports the attendance of J+S courses as CSV files for the import
into the Nationale Datenbank Sport (NDS). It is an **optional module**: the
connection `js` on the Integrations page (`/dashboard/integrations`), off
after the migration; an admin switches it on there. While it is on,
**trainers and admins** find it at `/dashboard/js` (avatar menu →
_J+S-Export_); viewers never see it. While it is off the menu entry is gone
and its pages redirect to the dashboard. Courses stay in the database either
way.

The module needs nothing from Webling: it identifies persons by the
member's **Lizenznummer** (`members.license_number`), which is the J+S
person number. That is an ordinary member field:

- with the Webling integration, Webling owns it like the name (field
  _Lizenznummer_, synced nightly, read-only in Alleda while the member is
  linked);
- without it (or for members created in Alleda) staff enter it in the
  member form.

## Why CSV, not an API

The NDS offers CSV uploads for youth courses (Jugendausbildung): persons,
activities and attendance (Anwesenheitskontrolle, AWK). Its REST API
(`api.baspo.admin.ch/nds/api`) only serves cadre courses (Kaderbildung),
read-only, to partner organisations with a contract. So courses cannot be
read from the NDS either; they are entered in Alleda by hand, once per
course year.

Sources (BASPO, jugendundsport.ch/de/datenimport):

- Anleitung Import Anwesenheitskontrolle (11.09.2023)
- Anleitung Aktivitäten-Import (28.03.2023)
- Personenimport Jugendausbildung (26.07.2024)
- CSV templates `person_JA_DE.csv`, `aktivitaeten_JA_DE.csv`,
  `anwesenheitskontrolle_JA_DE.csv`

## Data

| What                  | Where                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| J+S person number     | `members.license_number` (Lizenznummer), see above                         |
| J+S courses           | `js_courses`: name, NDS course number, period, location, allowed durations |
| Trainings of a course | `js_course_trainings`                                                      |
| Module on or off      | `integration_connections` row `js` (`integration_set_enabled`, admins)     |

Only trainers and admins see the courses, maintain them and download the
files (RLS `is_writer()` for reading and writing,
`20261105120000_js_module_trainers_only.sql`); viewers see neither the menu
entry nor the pages. The licence number itself is part of the member record
and visible to all staff, like the birthday. Alleda keeps no AHV numbers, addresses,
nationality or mother tongue.

## The files

All files: semicolon separated, UTF-8 with BOM, CRLF, header row exactly as
in BASPO's templates (`src/lib/jsExport.ts`).

1. **Persons** (`personen_*.csv`, `personen_leitende_*.csv`): everyone who
   attended or led a training of the course in its period, with licence
   number, name and birthday; the other columns stay empty. Only needed for
   persons not yet in the NDS course: the NDS finds persons already linked
   to the club by number, or by name and birthday. A person **new to the
   club's NDS organisation** needs an AHV number (or PEID), which the NDS
   checks against the AHV register: enter such persons in the NDS directly,
   then their new person number as Lizenznummer (in Webling for members
   from Webling, else in Alleda).
2. **Activities** (`aktivitaeten_*.csv`): one `Training` per training and
   date with at least one attendance, with start time, duration and the
   course location.
3. **Attendance** (`anwesenheitskontrolle_*.csv`): one row per person and
   session. Main trainers and assistants are `Leiter/in`, everyone else
   `Teilnehmer/in`. Persons without a Lizenznummer are left out and listed
   on the page.

Importing activities in the NDS replaces all activities **and attendance**
of the course; importing attendance replaces all attendance. The files
therefore always cover the whole course. Import in the order above.

### Durations

The NDS only accepts certain durations, depending on the course's user
group (NG) and main sport. The default per course is NG 1, Art. 1 Abs. 1
J+S-V-BASPO (Judo, Aikido): 60, 75, 90 minutes. A training is exported with
the longest allowed duration it covers (105 min → 90); trainings shorter
than the shortest value, or without an end time, are left out. The page
lists each case.
