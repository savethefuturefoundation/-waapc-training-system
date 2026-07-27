-- ---------------------------------------------------------------------
-- extra_schema_30.sql
-- Scheduled posting for announcements and assignments — set a future
-- publish time and it stays invisible to students/parents until then,
-- like a Classroom draft/scheduled post. NULL means post immediately
-- (unchanged default behavior). Staff always see their own scheduled
-- items so they can manage them.
-- ---------------------------------------------------------------------
alter table announcements add column if not exists publish_at timestamptz;
alter table assignments add column if not exists publish_at timestamptz;

drop policy if exists "announcements read" on announcements;
create policy "announcements read" on announcements for select using (
  is_admin() or is_teacher() or publish_at is null or publish_at <= now()
);

drop policy if exists "assignments self read" on assignments;
create policy "assignments self read" on assignments for select using (
  (publish_at is null or publish_at <= now())
  and exists (select 1 from assignment_targets t where t.assignment_id = assignments.id and owns_student(t.student_id))
);

drop policy if exists "assignments parent read" on assignments;
create policy "assignments parent read" on assignments for select using (
  is_parent()
  and (publish_at is null or publish_at <= now())
  and exists (select 1 from assignment_targets t where t.assignment_id = assignments.id and is_my_child(t.student_id))
);
