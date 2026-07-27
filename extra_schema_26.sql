-- ---------------------------------------------------------------------
-- extra_schema_26.sql
-- Run AFTER extra_schema_25.sql.
--
-- Classroom-style upgrades to assignments:
--   1. Topics/units to group assignments (like Classroom's Classwork page)
--   2. Multiple attachments (files and/or links) per assignment
--   3. Due date now carries a time, not just a date
--   4. Points-based grading + private per-student feedback, kept in their
--      own table so a student can read but never write their own grade
-- ---------------------------------------------------------------------

-- 1. Topics/units ------------------------------------------------------
create table if not exists assignment_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table assignment_topics enable row level security;

drop policy if exists "assignment topics read" on assignment_topics;
create policy "assignment topics read" on assignment_topics for select using (auth.role() = 'authenticated');

drop policy if exists "assignment topics staff write" on assignment_topics;
create policy "assignment topics staff write" on assignment_topics for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

alter table assignments add column if not exists topic_id uuid references assignment_topics(id) on delete set null;

-- 2. Multiple attachments ------------------------------------------------
create table if not exists assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  url text not null,
  name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table assignment_attachments enable row level security;

drop policy if exists "assignment attachments read" on assignment_attachments;
create policy "assignment attachments read" on assignment_attachments for select using (auth.role() = 'authenticated');

drop policy if exists "assignment attachments staff write" on assignment_attachments;
create policy "assignment attachments staff write" on assignment_attachments for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

-- Migrate the single attachment/link extra_schema_25.sql added into the
-- new multi-attachment table (safe to re-run — only inserts what's missing).
insert into assignment_attachments (assignment_id, kind, url, name)
select a.id, 'file', a.attachment_url, a.attachment_name
from assignments a
where a.attachment_url is not null
  and not exists (select 1 from assignment_attachments x where x.assignment_id = a.id and x.kind = 'file' and x.url = a.attachment_url);

insert into assignment_attachments (assignment_id, kind, url, name)
select a.id, 'link', a.link_url, null
from assignments a
where a.link_url is not null
  and not exists (select 1 from assignment_attachments x where x.assignment_id = a.id and x.kind = 'link' and x.url = a.link_url);

alter table assignments drop column if exists attachment_url;
alter table assignments drop column if exists attachment_name;
alter table assignments drop column if exists link_url;

-- 3. Due date + time -----------------------------------------------------
-- Abidjan is UTC+0 year-round, so no timezone conversion is needed between
-- the browser and the database. Existing due dates (day-only) become
-- end-of-day to preserve their original "due by the end of that day"
-- meaning; new assignments will carry an explicit time going forward.
alter table assignments alter column due_date type timestamptz
  using (due_date::timestamptz + interval '23 hours 59 minutes 59 seconds');

-- 4. Points-based grading + private feedback ------------------------------
alter table assignments add column if not exists points_possible numeric;

create table if not exists assignment_grades (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  points_earned numeric,
  teacher_feedback text,
  graded_at timestamptz,
  unique (assignment_id, student_id)
);

alter table assignment_grades enable row level security;

drop policy if exists "assignment grades staff all" on assignment_grades;
create policy "assignment grades staff all" on assignment_grades for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

drop policy if exists "assignment grades self read" on assignment_grades;
create policy "assignment grades self read" on assignment_grades for select using (owns_student(student_id));

drop policy if exists "assignment grades parent read" on assignment_grades;
create policy "assignment grades parent read" on assignment_grades for select using (is_parent() and is_my_child(student_id));
