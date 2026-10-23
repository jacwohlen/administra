# J+S export (attendance → NDS)

Administra exports the attendance of J+S courses as CSV files for the
import into the Nationale Datenbank Sport (NDS). The page is
`/dashboard/js` (avatar menu → _J+S-Export_).

## Why CSV, not an API

The NDS offers CSV uploads for youth courses (Jugendausbildung): persons,
activities and attendance (Anwesenheitskontrolle, AWK). Its REST API
(`api.baspo.admin.ch/nds/api`) only serves cadre courses (Kaderbildung),
read-only, to partner organisations with a contract. So courses cannot be
read from the NDS either; they are entered in Administra by hand, once per
course year.

Sources (BASPO, jugendundsport.ch/de/datenimport):

- Anleitung Import Anwesenheitskontrolle (11.09.2023)
- Anleitung Aktivitäten-Import (28.03.2023)
- Personenimport Jugendausbildung (26.07.2024)
- CSV templates `person_JA_DE.csv`, `aktivitaeten_JA_DE.csv`,
  `anwesenheitskontrolle_JA_DE.csv`

## Data

| What                                                                  | Where                                                                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| J+S person number                                                     | `members."jsPersonNumber"`, synced daily from the Webling field _Lizenznummer_ (`webling-sync/src/webling.py`) |
| J+S courses                                                           | `js_courses`: name, NDS course number, period, location, allowed durations                                     |
| Trainings of a course                                                 | `js_course_trainings`                                                                                          |
| Person data (AHV number, address, gender, nationality, mother tongue) | Webling only, fetched when an admin downloads the person file; never stored in Administra                      |

Staff (viewer and up) see courses and download activities and attendance;
trainers and admins maintain the courses; only admins download the person
file, because it holds AHV numbers.

## The files

All files: semicolon separated, UTF-8 with BOM, CRLF, header row exactly as
in BASPO's templates (`src/lib/jsExport.ts`).

1. **Persons** (`personen_*.csv`, `personen_leitende_*.csv`): everyone who
   attended or led a training of the course in its period. Only needed for
   persons not yet in the NDS course. Persons new to the club's NDS
   organisation need an AHV number (or PEID); the NDS checks it against the
   AHV register. After the import, enter the person number the NDS assigned
   as _Lizenznummer_ in Webling.
2. **Activities** (`aktivitaeten_*.csv`): one `Training` per training and
   date with at least one attendance, with start time, duration and the
   course location.
3. **Attendance** (`anwesenheitskontrolle_*.csv`): one row per person and
   session. Main trainers and assistants are `Leiter/in`, everyone else
   `Teilnehmer/in`. Persons without a J+S person number are left out and
   listed on the page.

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

### Webling fields for the person file

Looked up by name, ignoring case, umlauts and punctuation
(`src/lib/jsPersons.ts`, `WEBLING_FIELDS`):

| NDS column                    | Webling field (first match)                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| PERSONENNUMMER                | Lizenznummer                                                      |
| NAME / VORNAME / GEBURTSDATUM | Name / Vorname / Geburtstag                                       |
| GESCHLECHT                    | Geschlecht (m/w, männlich/weiblich), else Anrede (Herr/Frau)      |
| AHV_NR                        | AHV-Nummer, AHV-Nr., AHV, Sozialversicherungsnummer               |
| NATIONALITAET                 | Nationalität, Staatsangehörigkeit → CH, FL or Andere              |
| MUTTERSPRACHE                 | Muttersprache, Sprache → DE, FR, IT or Andere                     |
| STRASSE / HAUSNUMMER          | Strasse (house number split off unless a field Hausnummer exists) |
| PLZ / ORT / LAND              | PLZ / Ort / Land (empty = CH)                                     |

Members with missing required fields are still exported and listed after
the download, so they can be completed in Webling.

## Configuration

The person file needs read access to Webling on the server:

```
PRIVATE_WEBLING_DOMAIN=<subdomain of webling.ch>
PRIVATE_WEBLING_API_KEY=<API key>
```

Set them in Netlify for the **production** context only. Dev and Deploy
Previews hold anonymized members (fake names, no person numbers); with
Webling access their member ids would pull real data. Without the
variables the person download answers "Webling is not configured"; the
other files work without them.
