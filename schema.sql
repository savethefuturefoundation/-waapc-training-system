-- =====================================================================
-- WAAPC Training Centre — Supabase Schema
-- Covers: catalog, students, enrollments, flexible payments, invoices,
-- receipts, question banks, attempts, attendance, certificates.
-- Run this in Supabase: Project -> SQL Editor -> New query -> paste -> Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. Profiles (links a Supabase Auth user to a role: admin or student)
-- ---------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','student')) default 'student',
  full_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Test catalog (GED, SAT, ACT, IELTS, TOEFL, Intensive English, ESAT, GRE, UCAT...)
-- ---------------------------------------------------------------------
create table tests (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_price numeric not null default 0,
  default_duration_label text,           -- e.g. "3 months | 2 sessions/week"
  registration_only_price numeric not null default 10000,
  created_at timestamptz not null default now()
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (test_id, name)
);

-- ---------------------------------------------------------------------
-- 3. Question bank (admin-editable without redeploying the app)
-- ---------------------------------------------------------------------
create table questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  question_text text not null,
  options jsonb not null,               -- array of option strings
  correct_index int not null,
  difficulty text check (difficulty in ('easy','medium','hard')) default 'medium',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Students (the person record; auth_user_id is null until they set a login)
-- ---------------------------------------------------------------------
create table students (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  dob date,
  gender text,
  nationality text,
  email text not null unique,
  phone text,
  guardian_name text,
  guardian_relationship text,
  guardian_phone text,
  guardian_email text,
  address text,
  photo_url text,                        -- Supabase Storage path
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Enrollments (a student registered for a specific test/program)
-- ---------------------------------------------------------------------
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  test_id uuid not null references tests(id),
  level text,                            -- Beginner / Intermediate / Advanced
  sessions_per_week int,
  start_date date,
  end_date date,
  registration_only boolean not null default false,
  price numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Invoices (one per registration event, can bundle multiple enrollments)
-- ---------------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  invoice_number text not null unique,   -- e.g. INV-061
  invoice_date date not null default current_date,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  enrollment_id uuid references enrollments(id) on delete set null,
  description text not null,
  amount numeric not null default 0
);

-- ---------------------------------------------------------------------
-- 7. Payment plan — flexible installments per invoice
-- ---------------------------------------------------------------------
create table payment_installments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric not null,
  due_date date,
  paid boolean not null default false,
  paid_date date,
  method text,                           -- Bank Transfer / Cheque / Wave / Cash
  receipt_number text unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. Practice & mock attempts
-- ---------------------------------------------------------------------
create table attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  mode text not null check (mode in ('practice','mock')),
  score int,
  total int,
  taken_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. Attendance (per session, per enrollment)
-- ---------------------------------------------------------------------
create table attendance (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  session_date date not null,
  present boolean not null default true,
  marked_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (enrollment_id, session_date)
);

-- ---------------------------------------------------------------------
-- 10. Certificates (issued on program completion)
-- ---------------------------------------------------------------------
create table certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  certificate_number text not null unique,   -- e.g. CERT-2026-014
  issued_date date not null default current_date,
  final_mock_score int,
  final_mock_total int,
  attendance_pct numeric,
  notes text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table profiles enable row level security;
alter table tests enable row level security;
alter table subjects enable row level security;
alter table questions enable row level security;
alter table students enable row level security;
alter table enrollments enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table payment_installments enable row level security;
alter table attempts enable row level security;
alter table attendance enable row level security;
alter table certificates enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- Helper: does the current user own this student record?
create or replace function owns_student(target_student_id uuid) returns boolean as $$
  select exists (
    select 1 from students where id = target_student_id and auth_user_id = auth.uid()
  );
$$ language sql security definer stable;

-- Catalog & question bank: everyone logged in can read, only admins write
create policy "catalog read" on tests for select using (auth.role() = 'authenticated');
create policy "catalog write" on tests for all using (is_admin()) with check (is_admin());
create policy "subjects read" on subjects for select using (auth.role() = 'authenticated');
create policy "subjects write" on subjects for all using (is_admin()) with check (is_admin());
create policy "questions read" on questions for select using (auth.role() = 'authenticated');
create policy "questions write" on questions for all using (is_admin()) with check (is_admin());

-- Profiles: a user can read their own profile; admins read/write all
create policy "profile self read" on profiles for select using (id = auth.uid() or is_admin());
create policy "profile admin write" on profiles for all using (is_admin()) with check (is_admin());

-- Students: admins full access; a student can read/update only their own row
create policy "students admin all" on students for all using (is_admin()) with check (is_admin());
create policy "students self read" on students for select using (auth_user_id = auth.uid());
create policy "students self update" on students for update using (auth_user_id = auth.uid());

-- Enrollments: admins full access; students read their own
create policy "enrollments admin all" on enrollments for all using (is_admin()) with check (is_admin());
create policy "enrollments self read" on enrollments for select using (owns_student(student_id));

-- Invoices / items / installments: admins full access; students read their own
create policy "invoices admin all" on invoices for all using (is_admin()) with check (is_admin());
create policy "invoices self read" on invoices for select using (owns_student(student_id));

create policy "invoice_items admin all" on invoice_items for all using (is_admin()) with check (is_admin());
create policy "invoice_items self read" on invoice_items for select using (
  exists (select 1 from invoices i where i.id = invoice_id and owns_student(i.student_id))
);

create policy "installments admin all" on payment_installments for all using (is_admin()) with check (is_admin());
create policy "installments self read" on payment_installments for select using (
  exists (select 1 from invoices i where i.id = invoice_id and owns_student(i.student_id))
);

-- Attempts: admins full access; students manage only their own
create policy "attempts admin all" on attempts for all using (is_admin()) with check (is_admin());
create policy "attempts self all" on attempts for all using (owns_student(student_id)) with check (owns_student(student_id));

-- Attendance: admins full access; students read only their own
create policy "attendance admin all" on attendance for all using (is_admin()) with check (is_admin());
create policy "attendance self read" on attendance for select using (
  exists (select 1 from enrollments e where e.id = enrollment_id and owns_student(e.student_id))
);

-- Certificates: admins full access; students read only their own
create policy "certificates admin all" on certificates for all using (is_admin()) with check (is_admin());
create policy "certificates self read" on certificates for select using (owns_student(student_id));

-- =====================================================================
-- Seed the test catalog (safe to re-run; ignores duplicates)
-- =====================================================================
insert into tests (name, default_price, default_duration_label, registration_only_price) values
  ('GED', 500000, '3 months | 2 sessions/week', 10000),
  ('SAT', 250000, '2 weeks | 2 sessions', 10000),
  ('ACT', 300000, '3 weeks | 2 sessions/week', 10000),
  ('IELTS (Academic)', 450000, '1 month | 2 sessions/week', 10000),
  ('TOEFL', 400000, '1 month | 2 sessions/week', 10000),
  ('Intensive English Training', 350000, '12 weeks | 2 sessions/week', 10000),
  ('ESAT', 450000, '1 month | 2 sessions/week', 10000),
  ('GRE', 500000, '1 month | 2 sessions/week', 10000),
  ('UCAT', 450000, '1 month | 2 sessions/week', 10000)
on conflict (name) do nothing;

-- Seed subjects per test
insert into subjects (test_id, name, sort_order)
select t.id, s.name, s.sort_order from tests t
join (values
  ('GED','Reasoning Through Language Arts',1),
  ('GED','Mathematical Reasoning',2),
  ('GED','Science',3),
  ('GED','Social Studies',4),
  ('SAT','Reading & Writing',1),
  ('SAT','Math',2),
  ('ACT','English',1),
  ('ACT','Math',2),
  ('ACT','Reading',3),
  ('ACT','Science',4),
  ('IELTS (Academic)','Listening',1),
  ('IELTS (Academic)','Reading',2),
  ('IELTS (Academic)','Writing',3),
  ('IELTS (Academic)','Speaking',4),
  ('TOEFL','Reading',1),
  ('TOEFL','Listening',2),
  ('TOEFL','Speaking',3),
  ('TOEFL','Writing',4),
  ('Intensive English Training','Grammar & Structures',1),
  ('Intensive English Training','Vocabulary Building',2),
  ('Intensive English Training','Reading Comprehension',3),
  ('Intensive English Training','Listening Comprehension',4),
  ('Intensive English Training','Writing Practice',5),
  ('Intensive English Training','Speaking Practice',6),
  ('ESAT','Mathematics 1',1),
  ('ESAT','Physics',2),
  ('ESAT','Chemistry',3),
  ('ESAT','Biology',4),
  ('GRE','Verbal Reasoning',1),
  ('GRE','Quantitative Reasoning',2),
  ('GRE','Analytical Writing',3),
  ('UCAT','Verbal Reasoning',1),
  ('UCAT','Decision Making',2),
  ('UCAT','Quantitative Reasoning',3),
  ('UCAT','Situational Judgement',4)
) as s(test_name, name, sort_order) on s.test_name = t.name
on conflict (test_id, name) do nothing;
