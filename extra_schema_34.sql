-- ---------------------------------------------------------------------
-- extra_schema_34.sql
-- Per-subject attendance. Run AFTER extra_schema_32.sql.
--
-- Attendance used to be one Present/Absent per student per day for the
-- whole program — so a student absent for first-period Social Studies
-- but present for everything else that day just showed up as "present"
-- (or one ambiguous record). Real case that prompted this: a student
-- missed Social Studies (period 1) but attended the rest of the day.
--
-- Adds an optional subject_id to attendance so a class can be marked
-- per subject/period, not just once a day. Existing rows keep
-- subject_id = null (unchanged, still count normally in every
-- attendance-rate calculation, which just averages present/absent
-- across all of a student's attendance rows regardless of subject).
--
-- Enforcement, mirroring extra_schema_32's Gradebook scoping:
--   - A teacher scoped to a whole program can mark general
--     (subject_id null) OR any subject within it.
--   - A teacher scoped to just one subject (e.g. GED Social Studies)
--     can ONLY mark attendance tagged with that subject — not general
--     attendance, and not another subject's.
-- ---------------------------------------------------------------------

alter table attendance add column if not exists subject_id uuid references subjects(id) on delete cascade;

alter table attendance drop constraint if exists attendance_enrollment_id_session_date_key;
alter table attendance add constraint attendance_enrollment_id_session_date_subject_id_key unique (enrollment_id, session_date, subject_id);

create or replace function teacher_scoped_to_enrollment(target_enrollment_id uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from enrollments e
    join teacher_test_assignments ta on ta.test_id = e.test_id
    where e.id = target_enrollment_id and ta.teacher_id = auth.uid()
  );
$$;

create or replace function teacher_has_whole_program_access(target_test_id uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from teacher_test_assignments ta
    where ta.teacher_id = auth.uid() and ta.test_id = target_test_id and ta.subject_id is null
  );
$$;

drop policy if exists "attendance teacher all" on attendance;
create policy "attendance teacher all" on attendance for all
  using (
    is_teacher()
    and teacher_scoped_to_enrollment(attendance.enrollment_id)
    and (
      (attendance.subject_id is not null and teacher_scoped_to_subject(attendance.subject_id))
      or (attendance.subject_id is null and teacher_has_whole_program_access((select test_id from enrollments where id = attendance.enrollment_id)))
    )
  )
  with check (
    is_teacher()
    and teacher_scoped_to_enrollment(attendance.enrollment_id)
    and (
      (attendance.subject_id is not null and teacher_scoped_to_subject(attendance.subject_id))
      or (attendance.subject_id is null and teacher_has_whole_program_access((select test_id from enrollments where id = attendance.enrollment_id)))
    )
  );
