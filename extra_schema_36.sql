-- ---------------------------------------------------------------------
-- extra_schema_36.sql
-- Fixes "infinite recursion detected in policy" on assignments, caused
-- by extra_schema_35.sql. Run AFTER extra_schema_35.sql.
--
-- extra_schema_35 made assignment_targets/assignment_submissions/
-- assignment_grades check their parent assignment's subject by querying
-- the assignments table directly inside their own policy. But the
-- assignments policy ALSO queries assignment_targets (to check student
-- scope) — so evaluating one triggers the other, which triggers the
-- first again, forever, until Postgres aborts with an error. This broke
-- every assignments query for everyone, including admin.
--
-- Fix: a security-definer helper reads the assignment's subject_id
-- directly (bypassing RLS on assignments for that one lookup, the same
-- way every other helper function in this app already does), instead of
-- a correlated subquery that re-enters assignments' own policy.
-- ---------------------------------------------------------------------

create or replace function teacher_scoped_to_assignment_subject(target_assignment_id uuid) returns boolean
language sql security definer stable as $$
  select teacher_scoped_to_subject((select subject_id from assignments where id = target_assignment_id));
$$;

drop policy if exists "assignment targets teacher all" on assignment_targets;
create policy "assignment targets teacher all" on assignment_targets for all
  using (
    is_teacher() and teacher_scoped_to_student(assignment_targets.student_id)
    and teacher_scoped_to_assignment_subject(assignment_targets.assignment_id)
  )
  with check (
    is_teacher() and teacher_scoped_to_student(assignment_targets.student_id)
    and teacher_scoped_to_assignment_subject(assignment_targets.assignment_id)
  );

drop policy if exists "assignment submissions teacher read" on assignment_submissions;
create policy "assignment submissions teacher read" on assignment_submissions for select using (
  is_teacher() and teacher_scoped_to_student(assignment_submissions.student_id)
  and teacher_scoped_to_assignment_subject(assignment_submissions.assignment_id)
);

drop policy if exists "assignment grades teacher all" on assignment_grades;
create policy "assignment grades teacher all" on assignment_grades for all
  using (
    is_teacher() and teacher_scoped_to_student(assignment_grades.student_id)
    and teacher_scoped_to_assignment_subject(assignment_grades.assignment_id)
  )
  with check (
    is_teacher() and teacher_scoped_to_student(assignment_grades.student_id)
    and teacher_scoped_to_assignment_subject(assignment_grades.assignment_id)
  );
