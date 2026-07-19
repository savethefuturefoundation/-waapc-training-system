-- =====================================================================
-- WAAPC Training Centre — Parent portal (read-only access + self-signup)
-- Run this AFTER extra_schema_6.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Parents don't need an admin invite — the guardian email is already
-- captured at student registration (students.guardian_email). A parent
-- signs up with that email on the Parent portal, which promotes their
-- profile to role 'parent'; RLS below matches them to every student
-- record naming them as guardian, by email.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'student', 'teacher', 'parent'));

create or replace function is_parent() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'parent'
  );
$$ language sql security definer stable;

-- Is the given student one of the current (parent) user's children,
-- matched by guardian email against the caller's own JWT email?
create or replace function is_my_child(target_student_id uuid) returns boolean as $$
  select exists (
    select 1 from students
    where id = target_student_id
      and lower(guardian_email) = lower(auth.jwt() ->> 'email')
  );
$$ language sql security definer stable;

-- parent_account_status(email): callable by anonymous visitors so the
-- Parent portal login screen can decide whether to show a "set your
-- password" (first login) form or a normal "enter password" form.
create or replace function parent_account_status(p_email text) returns text
language plpgsql security definer as $$
declare
  has_acct boolean;
  is_guardian boolean;
begin
  select exists (
    select 1 from auth.users u join profiles p on p.id = u.id
    where lower(u.email) = lower(p_email) and p.role = 'parent'
  ) into has_acct;

  if has_acct then
    return 'has_account';
  end if;

  select exists (select 1 from students where lower(guardian_email) = lower(p_email)) into is_guardian;

  if is_guardian then
    return 'needs_signup';
  else
    return 'not_registered';
  end if;
end;
$$;

revoke all on function parent_account_status(text) from public;
grant execute on function parent_account_status(text) to anon, authenticated;

-- claim_parent_account(): called right after a first-time signUp() succeeds
-- on the Parent portal, while the new user is authenticated. Promotes their
-- profile to 'parent'. No row-linking needed — RLS matches guardian_email
-- against the JWT email at query time (see is_my_child above).
create or replace function claim_parent_account() returns void
language plpgsql security definer as $$
declare
  uid uuid := auth.uid();
  uemail text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;

  if not exists (select 1 from students where lower(guardian_email) = lower(uemail)) then
    raise exception 'No student record lists this email as parent/guardian';
  end if;

  update profiles set role = 'parent' where id = uid;
end;
$$;

revoke all on function claim_parent_account() from public;
grant execute on function claim_parent_account() to authenticated;

-- Read-only access to their own children's records.
drop policy if exists "students parent read" on students;
create policy "students parent read" on students for select using (is_parent() and is_my_child(id));

drop policy if exists "enrollments parent read" on enrollments;
create policy "enrollments parent read" on enrollments for select using (is_parent() and is_my_child(student_id));

drop policy if exists "attempts parent read" on attempts;
create policy "attempts parent read" on attempts for select using (is_parent() and is_my_child(student_id));

drop policy if exists "attendance parent read" on attendance;
create policy "attendance parent read" on attendance for select using (is_parent() and is_my_child(student_id));
