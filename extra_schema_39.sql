-- ---------------------------------------------------------------------
-- extra_schema_39.sql
-- Finance security: audit trail + soft-void for payments and expenses,
-- audit trail for fee-line (installment) edits.
--
-- Previously, voiding a payment or deleting an expense permanently
-- erased the row — there was no record it had ever existed, let alone
-- who removed it or why. That's now a soft void: the row stays forever,
-- stamped with who voided it, when, and (optionally) why. The app is
-- updated to exclude voided rows from balances/totals while still
-- showing them in the ledger for accountability.
--
-- Editing a fee line's amount/category is now stamped with who last
-- touched it and when, via a trigger (so it can't be spoofed by the
-- client and can't be forgotten).
--
-- The app enforces a 24-hour "think twice" window on the client side —
-- editing/voiding something older than that requires an explicit
-- confirmation, which is what gets recorded. Admin can always do it;
-- this is about accountability, not a hard technical wall, since every
-- one of these actions is already admin-only.
-- ---------------------------------------------------------------------

alter table payments add column if not exists voided_by uuid references auth.users(id) on delete set null;
alter table payments add column if not exists voided_at timestamptz;
alter table payments add column if not exists void_reason text;

alter table expenses add column if not exists voided_by uuid references auth.users(id) on delete set null;
alter table expenses add column if not exists voided_at timestamptz;
alter table expenses add column if not exists void_reason text;
alter table expenses add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table payment_installments add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table payment_installments add column if not exists edited_by uuid references auth.users(id) on delete set null;
alter table payment_installments add column if not exists edited_at timestamptz;

-- Auto-stamp who voided a payment/expense, the moment voided_at is set
-- (not on every update, only the transition into voided) — can't be
-- spoofed by the client since it reads auth.uid() server-side.
create or replace function stamp_voided_by() returns trigger
language plpgsql security definer as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    new.voided_by = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists payments_stamp_void on payments;
create trigger payments_stamp_void before update on payments for each row execute function stamp_voided_by();

drop trigger if exists expenses_stamp_void on expenses;
create trigger expenses_stamp_void before update on expenses for each row execute function stamp_voided_by();

-- Auto-stamp who last edited a fee line and when, on every update
-- (the only update path today is amount/category).
create or replace function stamp_installment_edit() returns trigger
language plpgsql security definer as $$
begin
  new.edited_by = auth.uid();
  new.edited_at = now();
  return new;
end;
$$;

drop trigger if exists payment_installments_stamp_edit on payment_installments;
create trigger payment_installments_stamp_edit before update on payment_installments for each row execute function stamp_installment_edit();
