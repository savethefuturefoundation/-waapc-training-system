-- ---------------------------------------------------------------------
-- extra_schema_28.sql
-- Strict teacher scoping. Run AFTER extra_schema_27.sql.
--
-- extra_schema_19.sql deliberately let a teacher with zero assigned
-- programs see EVERY student ("so nothing breaks until admin sets this
-- up"). That leniency is now removed: a teacher only ever sees students
-- in programs they're explicitly assigned to, full stop. If any teacher
-- currently has no rows in teacher_test_assignments, they will see NO
-- students until you assign them a program from the admin Teachers tab.
--
-- Separately, assignments/assignment_targets/assignment_submissions/
-- assignment_grades never had teacher scoping at all — any teacher could
-- read or write any assignment for any student system-wide, even via a
-- direct API call bypassing the UI. That's now scoped the same way.
-- ---------------------------------------------------------------------

create or replace function teacher_scoped_to_student(target_student_id uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from enrollments e
    join teacher_test_assignments ta on ta.test_id = e.test_id
    where e.student_id = target_student_id and ta.teacher_id = auth.uid()
  );
$$;

-- 1. Students / enrollments — remove the "unrestricted if unconfigured" leniency.
drop policy if exists "students teacher read" on students;
create policy "students teacher read" on students for select using (
  is_teacher() and teacher_scoped_to_student(students.id)
);

drop policy if exists "enrollments teacher read" on enrollments;
create policy "enrollments teacher read" on enrollments for select using (
  is_teacher() and exists (
    select 1 from teacher_test_assignments ta where ta.test_id = enrollments.test_id and ta.teacher_id = auth.uid()
  )
);

-- 2. Assignments — admin keeps full access. A teacher can create an
-- assignment row (no targets yet at that point) and can read/update/
-- delete it once it has at least one target within their scope.
drop policy if exists "assignments staff all" on assignments;

drop policy if exists "assignments admin all" on assignments;
create policy "assignments admin all" on assignments for all using (is_admin()) with check (is_admin());

drop policy if exists "assignments teacher insert" on assignments;
create policy "assignments teacher insert" on assignments for insert with check (is_teacher());

drop policy if exists "assignments teacher read" on assignments;
create policy "assignments teacher read" on assignments for select using (
  is_teacher() and exists (
    select 1 from assignment_targets t where t.assignment_id = assignments.id and teacher_scoped_to_student(t.student_id)
  )
);

drop policy if exists "assignments teacher update" on assignments;
create policy "assignments teacher update" on assignments for update using (
  is_teacher() and exists (
    select 1 from assignment_targets t where t.assignment_id = assignments.id and teacher_scoped_to_student(t.student_id)
  )
);

drop policy if exists "assignments teacher delete" on assignments;
create policy "assignments teacher delete" on assignments for delete using (
  is_teacher() and exists (
    select 1 from assignment_targets t where t.assignment_id = assignments.id and teacher_scoped_to_student(t.student_id)
  )
);

-- 3. Assignment targets — this is what actually stops a teacher from
-- assigning homework to a student that isn't theirs.
drop policy if exists "assignment targets staff all" on assignment_targets;

drop policy if exists "assignment targets admin all" on assignment_targets;
create policy "assignment targets admin all" on assignment_targets for all using (is_admin()) with check (is_admin());

drop policy if exists "assignment targets teacher all" on assignment_targets;
create policy "assignment targets teacher all" on assignment_targets for all
  using (is_teacher() and teacher_scoped_to_student(assignment_targets.student_id))
  with check (is_teacher() and teacher_scoped_to_student(assignment_targets.student_id));

-- 4. Assignment submissions — teachers only read their own students' work.
drop policy if exists "assignment submissions staff read" on assignment_submissions;

drop policy if exists "assignment submissions admin read" on assignment_submissions;
create policy "assignment submissions admin read" on assignment_submissions for select using (is_admin());

drop policy if exists "assignment submissions teacher read" on assignment_submissions;
create policy "assignment submissions teacher read" on assignment_submissions for select using (
  is_teacher() and teacher_scoped_to_student(assignment_submissions.student_id)
);

-- 5. Assignment grades — teachers only grade their own students.
drop policy if exists "assignment grades staff all" on assignment_grades;

drop policy if exists "assignment grades admin all" on assignment_grades;
create policy "assignment grades admin all" on assignment_grades for all using (is_admin()) with check (is_admin());

drop policy if exists "assignment grades teacher all" on assignment_grades;
create policy "assignment grades teacher all" on assignment_grades for all
  using (is_teacher() and teacher_scoped_to_student(assignment_grades.student_id))
  with check (is_teacher() and teacher_scoped_to_student(assignment_grades.student_id));
