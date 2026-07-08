-- =====================================================================
-- WAAPC Training Centre — Teacher role
-- Run this AFTER extra_schema_3.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Teachers can: mark attendance, view progress reports (read students,
-- enrollments, attempts, attendance), and review Speaking submissions.
-- Teachers cannot: manage payments/invoices, edit the question bank,
-- issue certificates, or register students.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'student', 'teacher'));

create or replace function is_teacher() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'teacher'
  );
$$ language sql security definer stable;

-- Read-only access to student/enrollment/attempt data, needed to list
-- students and compute progress reports.
drop policy if exists "students teacher read" on students;
create policy "students teacher read" on students for select using (is_teacher());

drop policy if exists "enrollments teacher read" on enrollments;
create policy "enrollments teacher read" on enrollments for select using (is_teacher());

drop policy if exists "attempts teacher read" on attempts;
create policy "attempts teacher read" on attempts for select using (is_teacher());

-- Attendance: teachers can mark it, not just view it.
drop policy if exists "attendance teacher all" on attendance;
create policy "attendance teacher all" on attendance for all using (is_teacher()) with check (is_teacher());

-- Speaking submissions: teachers can review and mark reviewed, same as admin.
drop policy if exists "speaking submissions teacher all" on speaking_submissions;
create policy "speaking submissions teacher all" on speaking_submissions for all using (is_teacher()) with check (is_teacher());

-- Teachers need to play back private speaking recordings during review.
drop policy if exists "speaking recordings teacher read" on storage.objects;
create policy "speaking recordings teacher read" on storage.objects for select
  using (bucket_id = 'speaking-recordings' and is_teacher());
