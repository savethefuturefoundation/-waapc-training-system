-- =====================================================================
-- WAAPC Training Centre — Announcement audience targeting
-- Run this AFTER extra_schema_17.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Announcements can now be aimed at a specific program (e.g. "GED
-- students only") instead of always going to everyone. Leaving the
-- audience unset keeps the old behavior — visible to all roles.
-- =====================================================================

alter table announcements add column if not exists target_test_id uuid references tests(id) on delete set null;
