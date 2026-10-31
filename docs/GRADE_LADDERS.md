# Grade ladders

Every section has its own ladder of grades (belts), lowest grade first:
`grade_definitions` rows with the section, the grade's name, its rank, the
belt colour (a second colour for a two-coloured half belt) and whether it is
a dan grade. Gradings (`member_grades`), exam registrations
(`exam_candidates`) and exam programs (`exam_programs`) refer to a grade by
section and name.

Judo and Aikido come with the migrations. Any other sport gets its ladder
in the app, so a club with Karate, Ju-Jitsu or BJJ sections needs no SQL.

## Editing (admins)

_Settings → Grade ladders_ (`/dashboard/settings/grades`, linked from the
exam programs too) lists the club's sections (`club.sections`, Settings →
Club) and every section that has a ladder. For a section without one, start
from a kyu/dan template, copy another section's ladder or start empty. Per
grade: name, belt colour, optional second colour, dan; move grades up and
down to set the order, add and remove grades. Save writes the whole ladder
at once.

- **Rename:** the new name moves along everywhere (`ON UPDATE CASCADE` on
  all three references). Grades can swap names in one save.
- **Order:** ranks are renumbered 1..n on every save, so the next grade
  (`get_member_current_grades()."nextGrade"`, rank + 1) follows the new
  order. The current grade of a member is the highest rank they hold, so a
  reorder can change it.
- **Remove:** only grades nothing uses. A grade with gradings, exam
  registrations or an exam program shows how often it is used and cannot be
  removed (the database refuses as well). Removing every grade deletes the
  ladder.
- **Dan:** dan grades count for the black belt badge and get stripes on the
  belt by their number ("2. Dan"). Changing the flag refreshes the badge of
  everyone graded in that section.
- A ladder whose section is no longer a club section is kept and can still
  be edited or removed.

## Database

`save_grade_ladder(p_section, p_grades)` (migration
`20261109120000_editable_grade_ladders.sql`) is the only write path:
`grade_definitions` has a read policy only. The function checks
`is_admin()`, validates names (non-empty, at most 40 characters, unique
regardless of case), colours (`#rgb`, `#rrggbb` or a colour name) and the
dan flag, refuses to delete a used grade (`23503`, the message lists them)
and refuses an outdated editor (`40001`, a grade renamed or deleted in
between). Each element carries `previous`, the grade's saved name (null for
a new grade), so a rename is told apart from a delete plus an insert.

Checks: `supabase/checks/grade_ladders.sql` (CI); the editor's logic is in
`src/lib/gradeLadders.ts` with unit tests.

## Not covered

- Section names are free text from the settings; renaming a section does not
  rename its ladder (or gradings). Add the ladder under the new name and
  move the gradings with SQL, or keep the old name.
- The member pass import of the Daten-Assistent still reads Judo passes
  only (`src/lib/assistant/grades.ts`).
