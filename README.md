# WAAPC Training Centre System

Admin, Teacher, Parent, and Student portals for WAAPC Training Centre: registration,
flexible payment plans, invoices/receipts, practice & mock exams (including Listening
audio passages and Speaking recorded prompts), attendance, progress reports,
certificates, a Question Bank editor with CSV bulk import, and teacher-assigned
homework (with optional external links, text responses, and file uploads).

Built with vanilla JS + [Vite](https://vitejs.dev/) and [Supabase](https://supabase.com/)
(Postgres, Auth, Storage, Row Level Security).

## Local setup

Requirements: [Node.js](https://nodejs.org/) (LTS) and a Supabase project.

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in your Supabase project's URL and anon key
   (Project Settings → API in the Supabase dashboard):
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. In the Supabase SQL Editor, run these files **in order**:
   - `schema.sql` — core tables + RLS policies
   - `extra_schema.sql` — invoice/receipt/certificate numbering, student self-signup RPCs, student photo storage bucket
   - `seed_questions.sql` — seeds the built-in practice question bank
   - `extra_schema_2.sql` — Listening passages, Speaking prompts/submissions, storage buckets
   - `extra_schema_3.sql` — Listening passage groups (e.g. "Test A" / "Test B")
   - `extra_schema_4.sql` — Teacher role (attendance, progress reports, Speaking review)
   - `extra_schema_5.sql` — Teacher self-signup (admin invites by email from the Teachers tab)
   - `extra_schema_6.sql` — Removes any stray Speaking subject from GED/SAT/ACT
   - `extra_schema_7.sql` — Parent role + self-signup (matched by the guardian email already on file)
   - `extra_schema_8.sql` — Assignments (teacher/admin → student, with optional link/file, storage bucket)
   - `extra_schema_9.sql` — Direct messaging between Admin/Teacher/Parent/Student
   - `extra_schema_10.sql` — Announcements + Calendar (posted by admin/teacher, read by everyone)
   - `extra_schema_11.sql` — Gradebook (real grades a teacher enters, separate from auto-scored practice/mock attempts)
   - `extra_schema_12.sql` — GED Admission & Placement Assessment (GAPA): computer-graded English/academic readiness test for GED students, seeded with WAAPC's real 50-question assessment
   - `extra_schema_13.sql` — Timetable, seeded with WAAPC's real GED weekly schedule
   - `extra_schema_14.sql` — Payment fee categories (Registration/Training/Test/Other) on installments
   - `extra_schema_15.sql` — Finance: expenses tracking (admin only)
   - `extra_schema_16.sql` — Payment ledger: every payment is now its own dated, receipted transaction, so partial payments and arrears are tracked accurately (existing "paid" installments are backfilled into the ledger automatically)
   - `extra_schema_17.sql` — Teachers directory (subjects taught, `list_teachers()`) and a tutor name on each timetable entry
   - `extra_schema_18.sql` — Announcement audience targeting (post to everyone or one program only)
4. In Supabase **Authentication → Providers → Email**, turn off "Confirm email" (so a student's, teacher's, or parent's first-login signup works immediately).
5. Create your admin account: **Authentication → Users → Add user** (check "Auto Confirm User"), then in the SQL Editor:
   ```sql
   update profiles set role = 'admin' where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
   ```
   Teachers don't need this manual step — invite them from the Admin dashboard's **Teachers** tab instead.
   Parents don't either — they sign up directly on the Parent portal using the guardian email captured at registration.
6. Run the dev server:
   ```
   npm run dev
   ```
   Open the printed local URL and log in as admin.

## Deploying (Cloudflare Pages)

This app is a static site — Vite builds it to plain HTML/CSS/JS in `dist/`, and all
backend logic lives in Supabase. No server-side code or Cloudflare Workers/Functions
are needed.

1. Push this repo to GitHub (already done if you're reading this from there).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, and select this repository.
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Add environment variables (Pages project → Settings → Environment variables), same as your `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Save and deploy. Every push to `main` will auto-deploy.

Optional: in Supabase, under **Authentication → URL Configuration**, add your Cloudflare Pages URL
(e.g. `https://your-project.pages.dev`) to the allowed URLs — not required for the email/password
login flow this app uses, but good practice if you add email links or OAuth later.

## Keeping local and live in sync

Cloudflare Pages only deploys what's pushed to `main` on GitHub — a feature finished
locally won't appear on the live site until it's pushed.

One-time setup, so `git commit` reminds you when you're ahead of `origin`:
```
git config core.hooksPath .githooks
```

To check manually at any time, list commits that exist locally but haven't been pushed:
```
git log origin/main..HEAD --oneline
```

To confirm what's actually live, open the Cloudflare Pages project's **Deployments** tab —
each deployment lists the commit hash it was built from. Compare it to your local
`git rev-parse --short HEAD` to see whether the live site matches your latest commit.
