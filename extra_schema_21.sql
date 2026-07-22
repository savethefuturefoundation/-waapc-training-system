-- =====================================================================
-- WAAPC Training Centre — Fix RETURNS TABLE type mismatches
-- Run this AFTER extra_schema_20.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Both list_teachers() and list_message_contacts() were throwing (or
-- would throw) "structure of query does not match function result
-- type" — auth.users.email is character varying, not text, and Postgres
-- wants an exact match inside RETURN QUERY for a plpgsql function's
-- declared RETURNS TABLE types. Explicit casts fix it.
--
-- (If you haven't run extra_schema_9.sql yet — the Messaging module —
-- run that first; list_message_contacts() lives there and this just
-- corrects it in place.)
-- =====================================================================

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
    select u.id::uuid, u.email::text, p.full_name::text, p.subjects_taught::text
    from auth.users u join profiles p on p.id = u.id
    where p.role = 'teacher'
    order by p.full_name;
end;
$$;

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
          (select full_name from students where lower(email) = lower(u.email) limit 1),
          (select guardian_name from students where lower(guardian_email) = lower(u.email) limit 1),
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
          (select full_name from students where lower(email) = lower(u.email) limit 1),
          (select guardian_name from students where lower(guardian_email) = lower(u.email) limit 1),
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
