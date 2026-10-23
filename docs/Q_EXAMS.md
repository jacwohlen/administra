# Q-Prüfungen (kyu gradings)

The grading process from registration to the new belt, without paper:

1. **Exam day** – the TK (technical committee) creates an exam day under
   _Q-Prüfungen_, usually by picking the event from Webling, which fills in
   title, date, location and registration deadline. _Hinweise für Mitglieder_
   (e.g. "CHF 10.– am Prüfungstag mitbringen") is shown with the
   registration.
2. **Registration** – members (parents) register in the club area (`/club`,
   card _Q-Prüfung_) until the deadline: target grade (defaults to the next
   belt), belt length for the new belt and a remark. Trainers can add
   candidates in the dashboard at any time. The _Anmeldeliste_ (print icon)
   is the sheet for the dojo wall, with empty rows for late entries.
3. **Call-up** – select candidates and tap _Einteilen_ to give them a group
   (e.g. "Kinder Halbgelb") and a time, and mark them as called up. Members
   see group and time on their profile.
4. **Exam day** – each examiner opens the exam day on the phone, ticks the
   pair (or two pairs) they take over and taps _Bewerten_. That puts them on
   the candidates as examiner and opens one sheet with the candidates side
   by side: every item has 0 / 1 / 2 buttons per side (L / R) or one row for
   single-scored items, and a note for the feedback round. Totals, part
   minimums and a pass/fail suggestion update with every tap. _Meine_ lists
   the candidates the signed-in examiner has taken over.
5. **Result** – after the feedback, _Bestanden_ / _Nicht bestanden_ closes
   the sheet. Passing records the grade in `member_grades` with the exam
   date, so the new belt shows on the profile, in the member directory and
   on the training check-in right away. _Wieder öffnen_ undoes it (and takes
   that grade out again) for corrections.
6. **Afterwards** – members read their sheet with points, notes and the
   feedback on their profile (_Bisherige Prüfungen_), and the program of the
   next belt to prepare with.

## Programs

_Q-Prüfungen → Prüfungsprogramme_ holds what has to be shown for each grade,
transcribed from the TK's exam sheets (Halbgelb 5.5 Kyu up to Braun 1. Kyu).
A program has parts (Nage-waza, Ukemi, …) with items; an item is scored on
both sides ("links + rechts", 0–4 points) or once (0–2 points), as in the
legend of the sheets: 0 = not understood / wrong, 1 = understood, 2 =
understood and executed very well.

A candidate passes with at least the program's minimum points and every
part minimum (on the sheets: Nage-waza and Katame-waza, about 80 %). The
overall minimum on the sheets is 75 % of the maximum, rounded down; the
editor offers that value. The app only suggests the result, the examiners
decide.

Trainers and admins edit programs in the app. A sheet keeps the program it
was started with (snapshot in `exam_candidates.program`), so editing never
changes running or finished exams. Candidates scored side by side share one
snapshot; a candidate not started yet takes the snapshot of the sheet they
are scored on. New items get random keys, so a deleted item's key is never
handed to another technique. Grades without a program (e.g. Aikido)
can still be graded: the sheet then only records the result and feedback.

The half belts (5.5 Kyu Halbgelb, 4.5 Kyu Halborange, 3.5 Kyu Halbgrün) are
rungs of the Judo grade ladder with two colours (`grade_definitions."beltColor2"`).

## Data and access

`supabase/migrations/20261021120000_q_exams.sql`,
`20261023090000_q_exams_review_fixes.sql` and
`20261023150000_q_exams_score_lock.sql`:

| Table             | Content                                                  | Members                      | Staff        |
| ----------------- | -------------------------------------------------------- | ---------------------------- | ------------ |
| `exam_programs`   | parts and items per grade (jsonb), minimum points        | read                         | writers edit |
| `exams`           | exam days, optionally linked to an event                 | read                         | writers edit |
| `exam_candidates` | registration, call-up, program snapshot, result, total   | own rows (`my_member_ids()`) | writers edit |
| `exam_examiners`  | who graded a candidate (examiners add only themselves)   | own finished sheets          | writers add  |
| `exam_scores`     | points and note per item; the feedback (`_feedback` row) | own finished sheets          | writers edit |

- Members register and withdraw only through `register_for_exam()` and
  `withdraw_exam_registration()`, which check that the member is theirs,
  the deadline and the grade. Members change only registrations that are
  still _Angemeldet_; once called up or withdrawn, changes (and a new
  registration) go through the trainers. Withdrawing is possible until
  grading starts.
- Scores, notes and the feedback can only change while the sheet is open
  (`result` is null), and members read them only once the result is in.
  Each score write locks the open candidate row (`lock_open_exam_sheet`),
  so closing a sheet waits for a score saved in the same moment and counts
  it, and nothing is written into a closed sheet.
- `sync_exam_candidate_result` adds up the points from `exam_scores` and the
  snapshot when the result is set, and records the grade on a pass;
  `remove_exam_candidate_grade` removes that grade when the sheet is
  reopened. An already recorded grade is left alone (and not removed on
  reopening).
- A sheet is started (program frozen, grade fixed) with its first score or
  note, and only for the grade the examiner sees; a candidate whose grade has
  no program is never started, so the grade can still be corrected. An exam
  day's section is fixed once candidates are registered.
- Deleting an exam day deletes registrations and sheets, not the grades.
