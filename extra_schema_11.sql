-- =====================================================================
-- WAAPC Training Centre — Gradebook (real grades, not just auto-scored
-- practice/mock attempts)
-- Run this AFTER extra_schema_10.sql, in the Supabase SQL Editor.
-- Safe to re-run.
-- =====================================================================

create table if not exists grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  label text not null,
  score numeric not null,
  max_score numeric not null default 100,
  notes text,
  entered_by uuid references auth.users(id) on delete set null,
  entered_at timestamptz not null default now()
);

alter table grades enable row level security;

drop policy if exists "grades staff all" on grades;
create policy "grades staff all" on grades for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

drop policy if exists "grades self read" on grades;
create policy "grades self read" on grades for select using (owns_student(student_id));

drop policy if exists "grades parent read" on grades;
create policy "grades parent read" on grades for select using (is_parent() and is_my_child(student_id));
