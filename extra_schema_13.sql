-- =====================================================================
-- WAAPC Training Centre — Timetable
-- Run this AFTER extra_schema_12.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Read by everyone, edited by admin/teacher. Seeded with the real WAAPC
-- GED weekly timetable from the Student Handbook (Mon-Thu instruction
-- days, Friday assessment day) if the GED program exists and no
-- timetable rows have been added for it yet.
-- =====================================================================

create table if not exists timetable_entries (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references tests(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  start_time time not null,
  end_time time not null,
  activity text not null,
  kind text not null default 'class' check (kind in ('class', 'test', 'plan', 'rest')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table timetable_entries enable row level security;

drop policy if exists "timetable read" on timetable_entries;
create policy "timetable read" on timetable_entries for select using (auth.role() = 'authenticated');

drop policy if exists "timetable staff write" on timetable_entries;
create policy "timetable staff write" on timetable_entries for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

do $$
declare
  ged_id uuid;
  d text;
begin
  select id into ged_id from tests where name = 'GED';
  if ged_id is null then
    return;
  end if;
  if exists (select 1 from timetable_entries where test_id = ged_id limit 1) then
    return;
  end if;

  foreach d in array array['Mon', 'Tue', 'Wed', 'Thu'] loop
    insert into timetable_entries (test_id, day_of_week, start_time, end_time, activity, kind, sort_order) values
    (ged_id, d, '08:00', '08:20', 'Morning Meeting & Daily Goals', 'plan', 1),
    (ged_id, d, '08:20', '09:40', 'Reading & Language Arts', 'class', 2),
    (ged_id, d, '09:40', '09:55', 'Break', 'rest', 3),
    (ged_id, d, '09:55', '11:15', 'Mathematics', 'class', 4),
    (ged_id, d, '11:15', '12:00', 'Lunch', 'rest', 5),
    (ged_id, d, '12:00', '13:15', 'Science', 'class', 6),
    (ged_id, d, '13:15', '14:30', 'Social Studies', 'class', 7),
    (ged_id, d, '14:30', '14:45', 'Break', 'rest', 8),
    (ged_id, d, '14:45', '15:45', 'Writing Workshop & Vocabulary', 'class', 9),
    (ged_id, d, '15:45', '16:30', 'Guided Homework Session', 'plan', 10),
    (ged_id, d, '16:30', '17:00', 'Reflection & Homework Briefing', 'plan', 11);
  end loop;

  insert into timetable_entries (test_id, day_of_week, start_time, end_time, activity, kind, sort_order) values
  (ged_id, 'Fri', '08:00', '08:20', 'Weekly Goal Review', 'plan', 1),
  (ged_id, 'Fri', '08:20', '10:00', 'Reading & Language Arts Practice Test', 'test', 2),
  (ged_id, 'Fri', '10:00', '10:15', 'Break', 'rest', 3),
  (ged_id, 'Fri', '10:15', '11:45', 'Mathematics Practice Test', 'test', 4),
  (ged_id, 'Fri', '11:45', '12:30', 'Lunch', 'rest', 5),
  (ged_id, 'Fri', '12:30', '13:30', 'Science Practice Test', 'test', 6),
  (ged_id, 'Fri', '13:30', '14:30', 'Social Studies Practice Test', 'test', 7),
  (ged_id, 'Fri', '14:30', '14:45', 'Break', 'rest', 8),
  (ged_id, 'Fri', '14:45', '16:00', 'Error Analysis & Teacher Conferences', 'plan', 9),
  (ged_id, 'Fri', '16:00', '17:00', 'Individual Intervention & Homework Briefing', 'plan', 10);
end $$;
