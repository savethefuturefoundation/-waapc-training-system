-- ---------------------------------------------------------------------
-- extra_schema_42.sql
-- Parents could never actually see a child's balance/arrears — payments
-- had a parent-read policy, but invoices and payment_installments never
-- did, so the embedded fee schedule always came back empty for a parent
-- session regardless of what the app tried to display. Adds the missing
-- read policies, same pattern as the existing "attendance parent read".
-- ---------------------------------------------------------------------

drop policy if exists "invoices parent read" on invoices;
create policy "invoices parent read" on invoices for select using (is_parent() and is_my_child(student_id));

drop policy if exists "installments parent read" on payment_installments;
create policy "installments parent read" on payment_installments for select using (
  is_parent() and exists (select 1 from invoices i where i.id = invoice_id and is_my_child(i.student_id))
);
