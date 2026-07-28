-- ---------------------------------------------------------------------
-- extra_schema_32.sql
-- Subject-level teacher scoping. Run AFTER extra_schema_28.sql.
--
-- Until now, teacher_test_assignments only scoped a teacher to a whole
-- program (e.g. "GED"), so any teacher assigned to GED could see and
-- grade every GED subject, even ones taught by a different teacher.
-- Real life: each GED subject (Social Studies, Science, Mathematical
-- Reasoning, RLA) has its own teacher, and one shouldn't be able to
-- grade another's subject.
--
-- Adds an optional subject_id to teacher_test_assignments:
--   - subject_id IS NULL  -> whole-program access (unchanged behavior;
--     every existing row stays exactly as it is, nothing breaks).
--   - subject_id set      -> access limited to just that one subject
--     within the program.
-- A teacher can hold both kinds of rows across different programs at
-- once. Applied to the Gradebook (grades table) only, since that's
-- where "average for Social Studies" lives — assignments/attendance
-- stay scoped at the whole-program level for now.
-- ---------------------------------------------------------------------

alter table teacher_test_assignments add column if not exists subject_id uuid references subjects(id) on delete cascade;

create or replace function teacher_scoped_to_subject(target_subject_id uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from teacher_test_assignments ta
    join subjects s on s.id = target_subject_id
    where ta.teacher_id = auth.uid()
      and ta.test_id = s.test_id
      and (ta.subject_id is null or ta.subject_id = target_subject_id)
  );
$$;

-- Grades (Gradebook) — previously any teacher could read/write any
-- student's grade in any subject, unscoped. Now scoped to both the
-- student (whole-program membership, reusing extra_schema_28's helper)
-- and the specific subject.
drop policy if exists "grades staff all" on grades;

drop policy if exists "grades admin all" on grades;
create policy "grades admin all" on grades for all using (is_admin()) with check (is_admin());

drop policy if exists "grades teacher all" on grades;
create policy "grades teacher all" on grades for all
  using (is_teacher() and teacher_scoped_to_subject(grades.subject_id) and teacher_scoped_to_student(grades.student_id))
  with check (is_teacher() and teacher_scoped_to_subject(grades.subject_id) and teacher_scoped_to_student(grades.student_id));
