-- =====================================================================
-- WAAPC Training Centre — Remove stray Speaking subjects from tests that
-- don't have a speaking component in real life.
-- Run this AFTER extra_schema_5.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- GED, SAT, and ACT have no Speaking section in the real exam, so any
-- "Speaking" subject accidentally created under them is removed here
-- (cascades to delete its questions, per the subjects->questions FK).
--
-- TOEFL, IELTS (Academic), and Intensive English Training are left alone —
-- TOEFL and IELTS both have a real Speaking section in the actual exam,
-- and Intensive English Training is a course (not a standardized test)
-- where spoken-English practice is intentional.
-- =====================================================================

delete from subjects
where name ilike '%speaking%'
  and test_id in (select id from tests where name in ('GED', 'SAT', 'ACT'));
