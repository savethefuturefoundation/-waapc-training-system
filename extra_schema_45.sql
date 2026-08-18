-- ---------------------------------------------------------------------
-- extra_schema_45.sql
-- Class Notes — a lesson-plan/materials feed per class (subject),
-- separate from Assignments (which are gradable, due-dated, and
-- submitted). A teacher or admin posts a title + body text and an
-- optional link and/or file attachment to one specific class; everyone
-- enrolled in that class's program can read it. No due date, no
-- grading, no student submission — just a running feed of notes for
-- that classroom.
--
-- Read model mirrors timetable_entries exactly (any authenticated user
-- can read; the app filters client-side to the viewer's own enrolled
-- program(s)). Write model mirrors Assignments' subject-level teacher
-- scoping from extra_schema_35.sql (reuses its teacher_scoped_to_subject
-- helper) — a teacher assigned to one subject can only post/edit/delete
-- notes for that subject; a whole-program teacher can use any subject
-- in their program; admin can do anything.
-- ---------------------------------------------------------------------

create table if not exists class_notes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  title text not null,
  body text,
  link_url text,
  attachment_url text,
  attachment_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table class_notes enable row level security;

drop policy if exists "class notes read" on class_notes;
create policy "class notes read" on class_notes for select using (auth.role() = 'authenticated');

drop policy if exists "class notes admin all" on class_notes;
create policy "class notes admin all" on class_notes for all using (is_admin()) with check (is_admin());

drop policy if exists "class notes teacher write" on class_notes;
create policy "class notes teacher write" on class_notes for all using (
  is_teacher() and teacher_scoped_to_subject(subject_id)
) with check (
  is_teacher() and teacher_scoped_to_subject(subject_id)
);

-- Not sensitive content, so the bucket is public — same reasoning as
-- assignment-attachments and listening-audio.
insert into storage.buckets (id, name, public)
values ('class-note-attachments', 'class-note-attachments', true)
on conflict (id) do nothing;

drop policy if exists "class note attachments staff write" on storage.objects;
create policy "class note attachments staff write" on storage.objects for all
  using (bucket_id = 'class-note-attachments' and (is_admin() or is_teacher()))
  with check (bucket_id = 'class-note-attachments' and (is_admin() or is_teacher()));

drop policy if exists "class note attachments public read" on storage.objects;
create policy "class note attachments public read" on storage.objects for select
  using (bucket_id = 'class-note-attachments');
