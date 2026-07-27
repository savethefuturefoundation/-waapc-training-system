-- ---------------------------------------------------------------------
-- extra_schema_25.sql
-- Lets a teacher/admin attach a document (course material) when creating
-- an assignment, not just an external link. Not sensitive content, so the
-- bucket is public — same reasoning as listening-audio.
-- ---------------------------------------------------------------------
alter table assignments add column if not exists attachment_url text;
alter table assignments add column if not exists attachment_name text;

insert into storage.buckets (id, name, public)
values ('assignment-attachments', 'assignment-attachments', true)
on conflict (id) do nothing;

drop policy if exists "assignment attachments staff write" on storage.objects;
create policy "assignment attachments staff write" on storage.objects for all
  using (bucket_id = 'assignment-attachments' and (is_admin() or is_teacher()))
  with check (bucket_id = 'assignment-attachments' and (is_admin() or is_teacher()));

drop policy if exists "assignment attachments public read" on storage.objects;
create policy "assignment attachments public read" on storage.objects for select
  using (bucket_id = 'assignment-attachments');
