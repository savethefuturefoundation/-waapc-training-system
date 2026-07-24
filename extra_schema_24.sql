-- ---------------------------------------------------------------------
-- extra_schema_24.sql
-- Lets admins/teachers score a Speaking recording after reviewing it,
-- not just mark it "reviewed". Score is a 0-100 rubric score.
-- ---------------------------------------------------------------------
alter table speaking_submissions add column if not exists score numeric;
