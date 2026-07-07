-- =====================================================================
-- WAAPC Training Centre — Listening & Speaking practice
-- Run this AFTER schema.sql, extra_schema.sql, and seed_questions.sql.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Subject kind — lets the app tell a normal multiple-choice subject
--    apart from a Listening (audio passage) or Speaking (recorded prompt)
--    subject, without guessing from the subject name.
-- ---------------------------------------------------------------------
alter table subjects add column if not exists kind text not null default 'quiz'
  check (kind in ('quiz', 'listening', 'speaking'));

update subjects set kind = 'listening' where name ilike '%listening%';
update subjects set kind = 'speaking' where name ilike '%speaking%';

-- ---------------------------------------------------------------------
-- 2. Listening passages — one audio clip shared by a group of questions.
--    Existing `questions` rows get an optional passage_id: null for
--    ordinary quiz questions, set for questions that belong to a listening
--    passage.
-- ---------------------------------------------------------------------
create table if not exists listening_passages (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  title text,
  audio_url text not null,
  created_at timestamptz not null default now()
);

alter table questions add column if not exists passage_id uuid references listening_passages(id) on delete cascade;

alter table listening_passages enable row level security;

drop policy if exists "listening passages read" on listening_passages;
create policy "listening passages read" on listening_passages for select using (auth.role() = 'authenticated');

drop policy if exists "listening passages write" on listening_passages;
create policy "listening passages write" on listening_passages for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 3. Speaking prompts (cue-card style topics) and student recordings.
--    Recordings are not auto-graded — admin listens back and reviews.
-- ---------------------------------------------------------------------
create table if not exists speaking_prompts (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  prompt_text text not null,
  created_at timestamptz not null default now()
);

alter table speaking_prompts enable row level security;

drop policy if exists "speaking prompts read" on speaking_prompts;
create policy "speaking prompts read" on speaking_prompts for select using (auth.role() = 'authenticated');

drop policy if exists "speaking prompts write" on speaking_prompts;
create policy "speaking prompts write" on speaking_prompts for all using (is_admin()) with check (is_admin());

create table if not exists speaking_submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  prompt_id uuid not null references speaking_prompts(id) on delete cascade,
  audio_url text not null,
  reviewed boolean not null default false,
  admin_notes text,
  submitted_at timestamptz not null default now()
);

alter table speaking_submissions enable row level security;

drop policy if exists "speaking submissions admin all" on speaking_submissions;
create policy "speaking submissions admin all" on speaking_submissions for all using (is_admin()) with check (is_admin());

drop policy if exists "speaking submissions self insert" on speaking_submissions;
create policy "speaking submissions self insert" on speaking_submissions for insert with check (owns_student(student_id));

drop policy if exists "speaking submissions self read" on speaking_submissions;
create policy "speaking submissions self read" on speaking_submissions for select using (owns_student(student_id));

-- ---------------------------------------------------------------------
-- 4. Storage buckets.
--    listening-audio: admin-uploaded practice audio — not sensitive, so
--    it's public (simplifies playback: no signed URLs needed).
--    speaking-recordings: student voice recordings — private. Path
--    convention '<student_id>/<prompt_id>/<filename>' so policies can
--    match a recording to its owning student via the folder name.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listening-audio', 'listening-audio', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('speaking-recordings', 'speaking-recordings', false)
on conflict (id) do nothing;

drop policy if exists "listening audio admin write" on storage.objects;
create policy "listening audio admin write" on storage.objects for all
  using (bucket_id = 'listening-audio' and is_admin())
  with check (bucket_id = 'listening-audio' and is_admin());

drop policy if exists "listening audio public read" on storage.objects;
create policy "listening audio public read" on storage.objects for select
  using (bucket_id = 'listening-audio');

drop policy if exists "speaking recordings admin all" on storage.objects;
create policy "speaking recordings admin all" on storage.objects for all
  using (bucket_id = 'speaking-recordings' and is_admin())
  with check (bucket_id = 'speaking-recordings' and is_admin());

drop policy if exists "speaking recordings self write" on storage.objects;
create policy "speaking recordings self write" on storage.objects for insert
  with check (bucket_id = 'speaking-recordings' and owns_student((storage.foldername(name))[1]::uuid));

drop policy if exists "speaking recordings self read" on storage.objects;
create policy "speaking recordings self read" on storage.objects for select
  using (bucket_id = 'speaking-recordings' and owns_student((storage.foldername(name))[1]::uuid));
