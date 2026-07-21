-- =====================================================================
-- WAAPC Training Centre — Direct messaging (Admin/Teacher/Parent/Student)
-- Run this AFTER extra_schema_8.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Messaging is restricted by role: Admin <-> Teacher/Parent/Student,
-- Teacher <-> Admin/Parent/Student, Parent/Student <-> Admin/Teacher
-- only (no parent-parent or student-student messaging).
-- =====================================================================

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

drop policy if exists "messages participant read" on messages;
create policy "messages participant read" on messages for select using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "messages send" on messages;
create policy "messages send" on messages for insert with check (sender_id = auth.uid());

drop policy if exists "messages recipient mark read" on messages;
create policy "messages recipient mark read" on messages for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------
-- Persist the teacher's name onto their profile at signup time, so the
-- messaging directory can show it. Previously the name only lived on the
-- teacher_invites row, which claim_teacher_account() deletes on claim.
-- ---------------------------------------------------------------------
create or replace function claim_teacher_account() returns void
language plpgsql security definer as $$
declare
  uid uuid := auth.uid();
  uemail text;
  invited_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;

  select full_name into invited_name from teacher_invites where lower(email) = lower(uemail);
  if invited_name is null then
    raise exception 'No teacher invite found for this email';
  end if;

  update profiles set role = 'teacher', full_name = coalesce(invited_name, full_name) where id = uid;
  delete from teacher_invites where lower(email) = lower(uemail);
end;
$$;

-- ---------------------------------------------------------------------
-- list_message_contacts(): who the current user is allowed to message,
-- based on their role, with a best-effort display name resolved from
-- profiles.full_name, or the students table (self or guardian) as a
-- fallback, or their email as a last resort.
-- ---------------------------------------------------------------------
create or replace function list_message_contacts()
returns table(user_id uuid, email text, display_name text, role text)
language plpgsql security definer as $$
declare
  my_role text;
begin
  select p.role into my_role from profiles p where p.id = auth.uid();

  if my_role = 'admin' then
    return query
      select u.id, u.email,
        coalesce(
          p.full_name,
          (select full_name from students where lower(email) = lower(u.email) limit 1),
          (select guardian_name from students where lower(guardian_email) = lower(u.email) limit 1),
          u.email
        ),
        p.role
      from auth.users u join profiles p on p.id = u.id
      where p.role in ('teacher','parent','student') and u.id <> auth.uid();
  elsif my_role = 'teacher' then
    return query
      select u.id, u.email,
        coalesce(
          p.full_name,
          (select full_name from students where lower(email) = lower(u.email) limit 1),
          (select guardian_name from students where lower(guardian_email) = lower(u.email) limit 1),
          u.email
        ),
        p.role
      from auth.users u join profiles p on p.id = u.id
      where p.role in ('admin','parent','student') and u.id <> auth.uid();
  elsif my_role in ('parent','student') then
    return query
      select u.id, u.email, coalesce(p.full_name, u.email), p.role
      from auth.users u join profiles p on p.id = u.id
      where p.role in ('admin','teacher') and u.id <> auth.uid();
  end if;
end;
$$;

revoke all on function list_message_contacts() from public;
grant execute on function list_message_contacts() to authenticated;
