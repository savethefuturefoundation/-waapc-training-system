-- ---------------------------------------------------------------------
-- extra_schema_38.sql
-- Fixes a structural gap from extra_schema_32.sql: teacher_test_assignments
-- still had its original unique(teacher_id, test_id) constraint from
-- before subject-level scoping existed, which only ever allowed ONE row
-- per (teacher, program) — meaning a teacher could never be granted two
-- different subjects within the same program (e.g. GED Social Studies
-- AND GED Science), and any attempt to switch a teacher from
-- whole-program to a specific subject relied entirely on the app first
-- deleting the old row in the same request. Widening the constraint to
-- include subject_id makes multiple subject-specific grants within one
-- program possible, matching how attendance's equivalent constraint was
-- already done in extra_schema_34.sql.
-- ---------------------------------------------------------------------

alter table teacher_test_assignments drop constraint if exists teacher_test_assignments_teacher_id_test_id_key;
alter table teacher_test_assignments drop constraint if exists teacher_test_assignments_teacher_id_test_id_subject_id_key;
alter table teacher_test_assignments add constraint teacher_test_assignments_teacher_id_test_id_subject_id_key
  unique (teacher_id, test_id, subject_id);
