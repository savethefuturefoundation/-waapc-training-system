-- =====================================================================
-- WAAPC Training Centre — Schema extensions for real auth + numbering
-- Run this AFTER schema.sql, in Supabase: Project -> SQL Editor -> New query
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Counters — replaces the prototype's in-memory invoice/receipt/cert
--    sequence numbers (INV-061, RCT-001, CERT-2026-014, ...).
-- ---------------------------------------------------------------------
create table if not exists counters (
  key text primary key,
  value int not null default 0
);

insert into counters (key, value) values
  ('invoice_seq', 60),
  ('receipt_seq', 0),
  ('cert_seq', 0)
on conflict (key) do nothing;

alter table counters enable row level security;

drop policy if exists "counters admin all" on counters;
create policy "counters admin all" on counters for all using (is_admin()) with check (is_admin());

-- Atomically increments and returns the next value. Restricted to admins
-- (only admin-side actions — new invoice, receipt, certificate — call this).
create or replace function next_seq(p_key text) returns int
language plpgsql security definer as $$
declare
  v int;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  update counters set value = value + 1 where key = p_key returning value into v;

  if v is null then
    insert into counters (key, value) values (p_key, 1) returning value into v;
  end if;

  return v;
end;
$$;

revoke all on function next_seq(text) from public;
grant execute on function next_seq(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Auto-create a profile row whenever someone signs up via Supabase Auth.
--    Defaults to 'student' — promote specific users to 'admin' manually
--    (see README setup instructions).
-- ---------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into profiles (id, role) values (new.id, 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- 3. Student self-service login flow.
--
--    student_account_status(email): callable by anonymous visitors (before
--    they're signed in) so the login screen can decide whether to show a
--    "set your password" (first login) form or a normal "enter password"
--    form — without exposing any student data.
--
--    claim_student_account(): called right after a first-time signUp()
--    succeeds, while the new user is authenticated. Links their new auth
--    user id to the matching students row. Runs as SECURITY DEFINER because
--    the normal students RLS policy requires auth_user_id = auth.uid()
--    already, which isn't true yet on first login.
-- ---------------------------------------------------------------------
create or replace function student_account_status(p_email text) returns text
language plpgsql security definer as $$
declare
  s students%rowtype;
begin
  select * into s from students where lower(email) = lower(p_email);

  if not found then
    return 'not_registered';
  elsif s.auth_user_id is null then
    return 'needs_signup';
  else
    return 'has_account';
  end if;
end;
$$;

revoke all on function student_account_status(text) from public;
grant execute on function student_account_status(text) to anon, authenticated;

create or replace function claim_student_account() returns void
language plpgsql security definer as $$
declare
  uid uuid := auth.uid();
  uemail text;
  updated int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into uemail from auth.users where id = uid;

  update students set auth_user_id = uid
    where lower(email) = lower(uemail) and auth_user_id is null;

  get diagnostics updated = row_count;

  if updated = 0 then
    raise exception 'No unclaimed student record found for this email';
  end if;
end;
$$;

revoke all on function claim_student_account() from public;
grant execute on function claim_student_account() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Storage bucket for student passport photos.
--    Path convention: '<student_id>/<filename>' so policies can match a
--    photo to its owning student via the folder name.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false)
on conflict (id) do nothing;

drop policy if exists "student photos admin all" on storage.objects;
create policy "student photos admin all" on storage.objects for all
  using (bucket_id = 'student-photos' and is_admin())
  with check (bucket_id = 'student-photos' and is_admin());

drop policy if exists "student photos self read" on storage.objects;
create policy "student photos self read" on storage.objects for select
  using (bucket_id = 'student-photos' and owns_student((storage.foldername(name))[1]::uuid));
