-- =====================================================================
-- WAAPC Training Centre — Payment fee categories
-- Run this AFTER extra_schema_13.sql, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Tags each installment with what it's for (Registration/Training/Test/
-- Other), so invoices, receipts, and balances can show exactly what a
-- payment covers. Existing installments default to 'training'.
-- =====================================================================

alter table payment_installments add column if not exists category text not null default 'training'
  check (category in ('registration', 'training', 'test', 'other'));
