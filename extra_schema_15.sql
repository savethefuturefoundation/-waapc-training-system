-- =====================================================================
-- WAAPC Training Centre — Finance (expenses, admin only)
-- Run this AFTER extra_schema_14.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Income is already tracked via paid payment_installments (now broken
-- down by fee category). This adds the other half: expenses going out,
-- so admin can see income vs. expenses in one place. Restricted to
-- admin only - more sensitive than day-to-day operational data.
-- =====================================================================

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text,
  amount numeric not null,
  expense_date date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table expenses enable row level security;

drop policy if exists "expenses admin all" on expenses;
create policy "expenses admin all" on expenses for all using (is_admin()) with check (is_admin());
