-- =====================================================================
-- WAAPC Training Centre — Announcements + Calendar
-- Run this AFTER extra_schema_9.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Both are read by everyone (all 4 roles) and posted by admin/teacher
-- only.
-- =====================================================================

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table announcements enable row level security;

drop policy if exists "announcements read" on announcements;
create policy "announcements read" on announcements for select using (auth.role() = 'authenticated');

drop policy if exists "announcements staff write" on announcements;
create policy "announcements staff write" on announcements for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table calendar_events enable row level security;

drop policy if exists "calendar events read" on calendar_events;
create policy "calendar events read" on calendar_events for select using (auth.role() = 'authenticated');

drop policy if exists "calendar events staff write" on calendar_events;
create policy "calendar events staff write" on calendar_events for all
  using (is_admin() or is_teacher())
  with check (is_admin() or is_teacher());
