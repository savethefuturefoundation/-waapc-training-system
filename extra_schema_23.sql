-- =====================================================================
-- WAAPC Training Centre — Graduation status per enrollment
-- Run this AFTER extra_schema_22.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- A student can be enrolled in more than one program at once, so
-- "graduated" is tracked per enrollment, not per student — finishing
-- GED doesn't affect a student's still-active Intensive English
-- enrollment. Graduating doesn't restrict login: the student (and
-- parent) can always view final grades, attendance, and the
-- certificate. Only the "take practice test / mock exam" actions for
-- that specific completed program are retired in the UI.
-- =====================================================================

alter table enrollments add column if not exists status text not null default 'active' check (status in ('active', 'graduated'));
alter table enrollments add column if not exists graduated_date date;
