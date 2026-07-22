-- =====================================================================
-- WAAPC Training Centre — Payment ledger (real accounting)
-- Run this AFTER extra_schema_15.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Until now a payment_installment could only be all-or-nothing "paid".
-- That made it impossible to record a partial payment (e.g. a student
-- who owes 1,750,000 CFA but has only paid 750,000 so far) without
-- lying about the amount received. This adds a proper payments ledger:
-- every cash/transfer receipt is its own dated, receipted transaction
-- against a fee line item, so partial payments and arrears are tracked
-- accurately, receipts print per-transaction, and mistakes can be
-- voided (deleted) and re-entered correctly instead of overwritten.
-- =====================================================================

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  installment_id uuid not null references payment_installments(id) on delete cascade,
  amount numeric not null check (amount > 0),
  method text not null default 'Cash',
  payment_date date not null default current_date,
  receipt_number text unique,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table payments enable row level security;

drop policy if exists "payments admin all" on payments;
create policy "payments admin all" on payments for all using (is_admin()) with check (is_admin());

drop policy if exists "payments self read" on payments;
create policy "payments self read" on payments for select using (owns_student(student_id));

drop policy if exists "payments parent read" on payments;
create policy "payments parent read" on payments for select using (is_parent() and is_my_child(student_id));

-- Backfill: installments already marked paid=true had no ledger entry —
-- create one so historical income isn't lost under the new ledger-based
-- totals. (Safe to re-run: skips installments that already have a
-- matching backfilled entry.)
insert into payments (student_id, installment_id, amount, method, payment_date, receipt_number)
select i.student_id, pi.id, pi.amount, coalesce(pi.method, 'Cash'), coalesce(pi.paid_date, pi.created_at::date), pi.receipt_number
from payment_installments pi
join invoices i on i.id = pi.invoice_id
where pi.paid = true
  and not exists (select 1 from payments p where p.installment_id = pi.id);
