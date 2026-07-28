-- ---------------------------------------------------------------------
-- extra_schema_35.sql
-- Subject-level teacher scoping for Assignments. Run AFTER extra_schema_32.sql.
--
-- Same idea as the Gradebook (extra_schema_32) and Attendance
-- (extra_schema_34): a teacher assigned to just one subject (e.g. GED
-- Social Studies) should only see and manage assignments for that
-- subject — not every assignment across the whole program, and
-- definitely not another teacher's.
--
-- Adds subject_id to assignments. A teacher can now only create, read,
-- update, or delete an assignment tagged with a subject they're scoped
-- to (whole-program teachers can use any subject in their program).
--
-- IMPORTANT: any assignment created before this migration has
-- subject_id = null (nothing to backfill it from automatically — the
-- app never captured a subject on assignments before now). Once this
-- runs, those existing assignments become admin-only until someone
-- opens each one from the admin account and sets its subject in the
-- edit form — teachers won't see them until then. This does NOT touch
-- or lose any existing submissions, grades, or attachments; it only
-- affects who can currently see the assignment row.
-- ---------------------------------------------------------------------

alter table assignments add column if not exists subject_id uuid references subjects(id) on delete set null;

drop policy if exists "assignments teacher insert" on assignments;
create policy "assignments teacher insert" on assignments for insert with check (
  is_teacher() and teacher_scoped_to_subject(subject_id)
);

drop policy if exists "assignments teacher read" on assignments;
create policy "assignments teacher read" on assignments for select using (
  is_teacher() and teacher_scoped_to_subject(assignments.subject_id) and exists (
    select 1 from assignment_targets t where t.assignment_id = assignments.id and teacher_scoped_to_student(t.student_id)
  )
);

drop policy if exists "assignments teacher update" on assignments;
create policy "assignments teacher update" on assignments for update using (
  is_teacher() and teacher_scoped_to_subject(assignments.subject_id) and exists (
    select 1 from assignment_targets t where t.assignment_id = assignments.id and teacher_scoped_to_student(t.student_id)
  )
);

drop policy if exists "assignments teacher delete" on assignments;
create policy "assignments teacher delete" on assignments for delete using (
  is_teacher() and teacher_scoped_to_subject(assignments.subject_id) and exists (
    select 1 from assignment_targets t where t.assignment_id = assignments.id and teacher_scoped_to_student(t.student_id)
  )
);

-- Targets/submissions/grades: same student-scoping as before, plus the
-- parent assignment's subject must also be in scope.
drop policy if exists "assignment targets teacher all" on assignment_targets;
create policy "assignment targets teacher all" on assignment_targets for all
  using (
    is_teacher() and teacher_scoped_to_student(assignment_targets.student_id)
    and exists (select 1 from assignments a where a.id = assignment_targets.assignment_id and teacher_scoped_to_subject(a.subject_id))
  )
  with check (
    is_teacher() and teacher_scoped_to_student(assignment_targets.student_id)
    and exists (select 1 from assignments a where a.id = assignment_targets.assignment_id and teacher_scoped_to_subject(a.subject_id))
  );

drop policy if exists "assignment submissions teacher read" on assignment_submissions;
create policy "assignment submissions teacher read" on assignment_submissions for select using (
  is_teacher() and teacher_scoped_to_student(assignment_submissions.student_id)
  and exists (select 1 from assignments a where a.id = assignment_submissions.assignment_id and teacher_scoped_to_subject(a.subject_id))
);

drop policy if exists "assignment grades teacher all" on assignment_grades;
create policy "assignment grades teacher all" on assignment_grades for all
  using (
    is_teacher() and teacher_scoped_to_student(assignment_grades.student_id)
    and exists (select 1 from assignments a where a.id = assignment_grades.assignment_id and teacher_scoped_to_subject(a.subject_id))
  )
  with check (
    is_teacher() and teacher_scoped_to_student(assignment_grades.student_id)
    and exists (select 1 from assignments a where a.id = assignment_grades.assignment_id and teacher_scoped_to_subject(a.subject_id))
  );
