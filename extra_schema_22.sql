-- =====================================================================
-- WAAPC Training Centre — Fix "column reference email is ambiguous"
-- Run this AFTER extra_schema_21.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- list_message_contacts() declares RETURNS TABLE(..., email text, ...).
-- In plpgsql, each RETURNS TABLE column becomes an implicit variable
-- visible throughout the function body — so the unqualified `email` in
-- "where lower(email) = lower(u.email)" collided with that variable as
-- well as students.email, which Postgres reports as ambiguous. Fixed by
-- qualifying every column with its table alias.
-- =====================================================================

create or replace function list_message_contacts()
returns table(user_id uuid, email text, display_name text, role text)
language plpgsql security definer as $$
declare
  my_role text;
begin
  select p.role into my_role from profiles p where p.id = auth.uid();

  if my_role = 'admin' then
    return query
      select u.id::uuid, u.email::text,
        coalesce(
          p.full_name,
          (select s.full_name from students s where lower(s.email) = lower(u.email) limit 1),
          (select s.guardian_name from students s where lower(s.guardian_email) = lower(u.email) limit 1),
          u.email
        )::text,
        p.role::text
      from auth.users u join profiles p on p.id = u.id
      where p.role in ('teacher','parent','student') and u.id <> auth.uid();
  elsif my_role = 'teacher' then
    return query
      select u.id::uuid, u.email::text,
        coalesce(
          p.full_name,
          (select s.full_name from students s where lower(s.email) = lower(u.email) limit 1),
          (select s.guardian_name from students s where lower(s.guardian_email) = lower(u.email) limit 1),
          u.email
        )::text,
        p.role::text
      from auth.users u join profiles p on p.id = u.id
      where p.role in ('admin','parent','student') and u.id <> auth.uid();
  elsif my_role in ('parent','student') then
    return query
      select u.id::uuid, u.email::text, coalesce(p.full_name, u.email)::text, p.role::text
      from auth.users u join profiles p on p.id = u.id
      where p.role in ('admin','teacher') and u.id <> auth.uid();
  end if;
end;
$$;
