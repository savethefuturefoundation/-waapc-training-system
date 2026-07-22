-- =====================================================================
-- WAAPC Training Centre — GED Ready official score tracking
-- Run this AFTER extra_schema_19.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Every GED student must take the real, authorized GED Ready practice
-- test before starting training, so the school knows their starting
-- level and can track strengths/weaknesses going in. This tags a grade
-- entry as an official GED Ready score (vs. a regular teacher-entered
-- grade like a Friday test), so the dashboard can show the "Most Recent
-- GED Ready Practice Test Scores" cards separately from day-to-day grades.
-- =====================================================================

alter table grades add column if not exists source text not null default 'manual' check (source in ('manual', 'ged_ready'));
