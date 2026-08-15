-- =====================================================================
-- extra_schema_43.sql
-- Admin self-signup (an existing admin invites by email), mirroring the
-- teacher self-signup flow in extra_schema_5.sql exactly: an admin adds
-- a pending invite (email + name), the invited person does a first-time
-- signUp() on the Admin portal, which promotes their profile to role
-- 'admin' and consumes the invite. No one — including this assistant —
-- ever sets or sees the new admin's password; they choose it themselves
-- on signup.
-- =====================================================================

create table if not exists admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now()
);

alter table admin_invites enable row level security;

drop policy if exists "admin invites admin all" on admin_invites;
create policy "admin invites admin all" on admin_invites for all using (is_admin()) with check (is_admin());

-- admin_account_status(email): callable by anonymous visitors so the
-- Admin portal login screen can decide whether to show a "set your
-- password" (first login) form or a normal "enter password" form.
create or replace function admin_account_status(p_email text) returns text
language plpgsql security definer as $$
declare
  has_acct boolean;
  invited boolean;
begin
  select exists (
    select 1 from auth.users u join profiles p on p.id = u.id
    where lower(u.email) = lower(p_email) and p.role = 'admin'
  ) into has_acct;

  if has_acct then
    return 'has_account';
  end if;

  select exists (select 1 from admin_invites where lower(email) = lower(p_email)) into invited;

  if invited then
    return 'needs_signup';
  else
    return 'not_invited';
  end if;
end;
$$;

revoke all on function admin_account_status(text) from public;
grant execute on function admin_account_status(text) to anon, authenticated;

-- claim_admin_account(): called right after a first-time signUp() succeeds
-- on the Admin portal, while the new user is authenticated. Promotes their
-- profile to 'admin' and removes the consumed invite. Runs as SECURITY
-- DEFINER because the normal profiles RLS only allows admins to write —
-- gated on a matching invite row, which only an existing admin can create.
create or replace function claim_admin_account() returns void
language plpgsql security definer as $$
declare
  uid uuid := auth.uid();
  uemail text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;

  if not exists (select 1 from admin_invites where lower(email) = lower(uemail)) then
    raise exception 'No admin invite found for this email';
  end if;

  update profiles set role = 'admin' where id = uid;
  delete from admin_invites where lower(email) = lower(uemail);
end;
$$;

revoke all on function claim_admin_account() from public;
grant execute on function claim_admin_account() to authenticated;
