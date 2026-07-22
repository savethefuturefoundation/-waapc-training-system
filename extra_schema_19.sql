-- =====================================================================
-- WAAPC Training Centre — Teacher scoping + account display names
-- Run this AFTER extra_schema_18.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Three things:
-- 1. update_my_name(): lets any signed-in user set their own display
--    name without granting broader profile-write access (which would
--    otherwise let someone change their own role).
-- 2. list_teachers() is now admin-only — teachers shouldn't see each
--    other's contact info, only their own assigned programs.
-- 3. teacher_test_assignments: which program(s) a teacher is
--    responsible for. Once a teacher has at least one assignment, their
--    visibility into students/enrollments is scoped to those programs
--    only. A teacher with zero assignments configured keeps seeing
--    everyone (unrestricted), so nothing breaks until admin sets this up.
-- =====================================================================

create or replace function update_my_name(new_name text) returns void
language plpgsql security definer as $$
begin
  update profiles set full_name = new_name where id = auth.uid();
end;
$$;

revoke all on function update_my_name(text) from public;
grant execute on function update_my_name(text) to authenticated;

create or replace function list_teachers()
returns table(id uuid, email text, full_name text, subjects_taught text)
language plpgsql security definer as $$
declare
  my_role text;
begin
  select p.role into my_role from profiles p where p.id = auth.uid();
  if my_role <> 'admin' then
    raise exception 'Not authorized';
  end if;

  return query
    select u.id, u.email, p.full_name, p.subjects_taught
    from auth.users u join profiles p on p.id = u.id
    where p.role = 'teacher'
    order by p.full_name;
end;
$$;

create table if not exists teacher_test_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null references tests(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_id, test_id)
);

alter table teacher_test_assignments enable row level security;

drop policy if exists "teacher assignments admin all" on teacher_test_assignments;
create policy "teacher assignments admin all" on teacher_test_assignments for all
  using (is_admin()) with check (is_admin());

drop policy if exists "teacher assignments self read" on teacher_test_assignments;
create policy "teacher assignments self read" on teacher_test_assignments for select
  using (teacher_id = auth.uid());

create or replace function teacher_has_assignments() returns boolean
language sql security definer stable as $$
  select exists (select 1 from teacher_test_assignments where teacher_id = auth.uid());
$$;

drop policy if exists "students teacher read" on students;
create policy "students teacher read" on students for select using (
  is_teacher() and (
    not teacher_has_assignments()
    or exists (
      select 1 from enrollments e
      join teacher_test_assignments ta on ta.test_id = e.test_id
      where e.student_id = students.id and ta.teacher_id = auth.uid()
    )
  )
);

drop policy if exists "enrollments teacher read" on enrollments;
create policy "enrollments teacher read" on enrollments for select using (
  is_teacher() and (
    not teacher_has_assignments()
    or exists (select 1 from teacher_test_assignments ta where ta.test_id = enrollments.test_id and ta.teacher_id = auth.uid())
  )
);
