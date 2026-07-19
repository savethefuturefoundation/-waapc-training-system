-- =====================================================================
-- WAAPC Training Centre — Assignments (teacher/admin -> student)
-- Run this AFTER extra_schema_7.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- A teacher or admin creates an assignment (title, description, optional
-- external link e.g. to another practice site, optional due date) and
-- targets specific students. Students see it on their dashboard, mark it
-- done, and can optionally leave a text response and/or upload a file.
-- Parents get read-only visibility into their own child's assignments.
-- =====================================================================

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  link_url text,
  due_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table assignments enable row level security;

drop policy if exists "assignments staff all" on assignments;
create policy "assignments staff all" on assignments for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

create table if not exists assignment_targets (
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (assignment_id, student_id)
);

alter table assignment_targets enable row level security;

drop policy if exists "assignment targets staff all" on assignment_targets;
create policy "assignment targets staff all" on assignment_targets for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

drop policy if exists "assignment targets self read" on assignment_targets;
create policy "assignment targets self read" on assignment_targets for select using (owns_student(student_id));

drop policy if exists "assignment targets parent read" on assignment_targets;
create policy "assignment targets parent read" on assignment_targets for select using (is_parent() and is_my_child(student_id));

-- Students (and parents) read assignments through their targets.
drop policy if exists "assignments self read" on assignments;
create policy "assignments self read" on assignments for select using (
  exists (select 1 from assignment_targets t where t.assignment_id = assignments.id and owns_student(t.student_id))
);

drop policy if exists "assignments parent read" on assignments;
create policy "assignments parent read" on assignments for select using (
  is_parent() and exists (select 1 from assignment_targets t where t.assignment_id = assignments.id and is_my_child(t.student_id))
);

create table if not exists assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'done')),
  response_text text,
  file_url text,
  submitted_at timestamptz,
  unique (assignment_id, student_id)
);

alter table assignment_submissions enable row level security;

drop policy if exists "assignment submissions staff read" on assignment_submissions;
create policy "assignment submissions staff read" on assignment_submissions for select using (is_admin() or is_teacher());

drop policy if exists "assignment submissions self all" on assignment_submissions;
create policy "assignment submissions self all" on assignment_submissions for all
  using (owns_student(student_id))
  with check (owns_student(student_id));

drop policy if exists "assignment submissions parent read" on assignment_submissions;
create policy "assignment submissions parent read" on assignment_submissions for select using (is_parent() and is_my_child(student_id));

-- ---------------------------------------------------------------------
-- Storage bucket for optional file submissions.
-- Path convention '<student_id>/<filename>' so policies can match a file
-- to its owning student via the folder name, same as speaking-recordings.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('assignment-files', 'assignment-files', false)
on conflict (id) do nothing;

drop policy if exists "assignment files self all" on storage.objects;
create policy "assignment files self all" on storage.objects for all
  using (bucket_id = 'assignment-files' and owns_student((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'assignment-files' and owns_student((storage.foldername(name))[1]::uuid));

drop policy if exists "assignment files staff read" on storage.objects;
create policy "assignment files staff read" on storage.objects for select
  using (bucket_id = 'assignment-files' and (is_admin() or is_teacher()));
