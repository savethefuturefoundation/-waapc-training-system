-- =====================================================================
-- WAAPC Training Centre — Listening passage groups (e.g. "Test A" / "Test B")
-- Run this AFTER extra_schema_2.sql, in the Supabase SQL Editor.
-- Safe to re-run.
-- =====================================================================

alter table listening_passages add column if not exists group_label text;

-- Backfill from existing passage titles that already start with "Test A —" / "Test B —"
-- (only the recently-imported TOEFL practice tests use this convention so far).
update listening_passages
set group_label = split_part(title, ' —', 1)
where group_label is null and title ~ '^Test [A-Za-z0-9]+ —';
