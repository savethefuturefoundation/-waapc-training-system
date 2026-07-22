-- =====================================================================
-- WAAPC Training Centre — Teachers directory + timetable tutors
-- Run this AFTER extra_schema_16.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Adds a "what do they teach" field to teachers (set at invite time,
-- editable by admin afterward), a list_teachers() RPC so the Teachers
-- directory can show active teachers (mirrors list_message_contacts'
-- pattern of joining auth.users from inside a security-definer
-- function), and a teacher_name on each timetable entry so students
-- see who's actually teaching a given session in their timetable.
-- =====================================================================

alter table teacher_invites add column if not exists subjects_taught text;
alter table profiles add column if not exists subjects_taught text;
alter table timetable_entries add column if not exists teacher_name text;

-- addTeacherInvite() now also captures what the teacher teaches.
create or replace function claim_teacher_account() returns void
language plpgsql security definer as $$
declare
  uid uuid := auth.uid();
  uemail text;
  inv record;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;

  select * into inv from teacher_invites where lower(email) = lower(uemail);
  if inv is null then
    raise exception 'No teacher invite found for this email';
  end if;

  update profiles
    set role = 'teacher',
        full_name = coalesce(profiles.full_name, inv.full_name),
        subjects_taught = inv.subjects_taught
    where id = uid;
  delete from teacher_invites where lower(email) = lower(uemail);
end;
$$;

-- list_teachers(): active teachers (already signed up), for the
-- Teachers directory. Admin/teacher only, like the Parents directory.
create or replace function list_teachers()
returns table(id uuid, email text, full_name text, subjects_taught text)
language plpgsql security definer as $$
declare
  my_role text;
begin
  select p.role into my_role from profiles p where p.id = auth.uid();
  if my_role not in ('admin', 'teacher') then
    raise exception 'Not authorized';
  end if;

  return query
    select u.id, u.email, p.full_name, p.subjects_taught
    from auth.users u join profiles p on p.id = u.id
    where p.role = 'teacher'
    order by p.full_name;
end;
$$;

revoke all on function list_teachers() from public;
grant execute on function list_teachers() to authenticated;

-- Admin can update an active teacher's name/subjects directly (profiles
-- RLS already grants admin full write access to profiles).
