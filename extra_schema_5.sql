-- =====================================================================
-- WAAPC Training Centre — Teacher self-signup (admin invites by email)
-- Run this AFTER extra_schema_4.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Mirrors the student self-signup flow (see extra_schema.sql section 3):
-- the admin adds a pending invite (email + name), then the teacher does a
-- first-time signUp() on the Teacher portal, which promotes their profile
-- to role 'teacher' and consumes the invite.
-- =====================================================================

create table if not exists teacher_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now()
);

alter table teacher_invites enable row level security;

drop policy if exists "teacher invites admin all" on teacher_invites;
create policy "teacher invites admin all" on teacher_invites for all using (is_admin()) with check (is_admin());

-- teacher_account_status(email): callable by anonymous visitors so the
-- Teacher portal login screen can decide whether to show a "set your
-- password" (first login) form or a normal "enter password" form.
create or replace function teacher_account_status(p_email text) returns text
language plpgsql security definer as $$
declare
  has_acct boolean;
  invited boolean;
begin
  select exists (
    select 1 from auth.users u join profiles p on p.id = u.id
    where lower(u.email) = lower(p_email) and p.role = 'teacher'
  ) into has_acct;

  if has_acct then
    return 'has_account';
  end if;

  select exists (select 1 from teacher_invites where lower(email) = lower(p_email)) into invited;

  if invited then
    return 'needs_signup';
  else
    return 'not_invited';
  end if;
end;
$$;

revoke all on function teacher_account_status(text) from public;
grant execute on function teacher_account_status(text) to anon, authenticated;

-- claim_teacher_account(): called right after a first-time signUp() succeeds
-- on the Teacher portal, while the new user is authenticated. Promotes their
-- profile to 'teacher' and removes the consumed invite. Runs as SECURITY
-- DEFINER because the normal profiles RLS only allows admins to write.
create or replace function claim_teacher_account() returns void
language plpgsql security definer as $$
declare
  uid uuid := auth.uid();
  uemail text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;

  if not exists (select 1 from teacher_invites where lower(email) = lower(uemail)) then
    raise exception 'No teacher invite found for this email';
  end if;

  update profiles set role = 'teacher' where id = uid;
  delete from teacher_invites where lower(email) = lower(uemail);
end;
$$;

revoke all on function claim_teacher_account() from public;
grant execute on function claim_teacher_account() to authenticated;
