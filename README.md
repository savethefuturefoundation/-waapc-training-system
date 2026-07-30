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
   - `extra_schema_19.sql` — Self-service display name, Teachers directory restricted to admin only, and teacher-to-program assignments (scopes a teacher's student list once admin assigns them)
   - `extra_schema_20.sql` — Tags a grade entry as an official GED Ready practice test score, for the "Most Recent GED Ready Practice Test Scores" dashboard
   - `extra_schema_21.sql` — Fixes a type-mismatch bug ("structure of query does not match function result type") in `list_teachers()` and `list_message_contacts()`
   - `extra_schema_22.sql` — Fixes a "column reference email is ambiguous" bug in `list_message_contacts()`
   - `extra_schema_23.sql` — Graduation status per enrollment (`status`, `graduated_date` on `enrollments`)
   - `extra_schema_24.sql` — Adds a `score` column to `speaking_submissions` so a reviewed recording can be graded, not just marked reviewed
   - `extra_schema_25.sql` — Lets a teacher/admin attach a document to an assignment (`attachment_url`/`attachment_name` on `assignments`, plus the `assignment-attachments` storage bucket)
   - `extra_schema_26.sql` — Classroom-style assignment upgrades: topics/units (`assignment_topics`), multiple attachments per assignment (`assignment_attachments`, replacing the single-attachment columns from extra_schema_25), a due date that carries a time (not just a date), and points-based grading + private per-student feedback (`assignment_grades`)
   - `extra_schema_27.sql` — Duration/package pricing tiers per test (`test_duration_packages`), seeded with IELTS (Academic)'s real pricing (450k/2mo, 550k/3mo, 650k/4mo, 800k/6mo, 1.5M/1yr); registering a student can pick a package and the price + end date fill in automatically
   - `extra_schema_28.sql` — **Security fix.** Removes the old "teacher with no assigned programs sees every student" fallback and adds real database-level scoping to assignments/assignment_targets/assignment_submissions/assignment_grades, so a teacher can only ever see or act on their own assigned students' data, even via a direct API call. Any teacher with zero rows in `teacher_test_assignments` will see no students until assigned a program from the admin Teachers tab.
   - `extra_schema_30.sql` — Scheduled posting: announcements and assignments can be given a future `publish_at` and stay invisible to students/parents (enforced at the database level) until that time. A student's Announcements page also merges in their own newly-published assignments as a combined feed, Classroom-Stream style.
   - `extra_schema_31.sql` — GED timetable: the whole day shifts 40 minutes later (first class now 9:00 AM instead of 8:20 AM), every day Mon-Fri. Session lengths and breaks unchanged.
   - `extra_schema_32.sql` — Subject-level teacher scoping for the Gradebook: a teacher can now be assigned to just one subject within a program (e.g. GED Social Studies only) instead of the whole program, so they can't see or grade other teachers' subjects. Existing whole-program assignments are unaffected — this is purely additive until you assign someone to a specific subject from the Teachers tab.
   - `extra_schema_33.sql` — Corrects a timetable drift from extra_schema_31.sql: sets the GED schedule's absolute times so the first real class lands exactly on 9:00 AM (session lengths/breaks unchanged), instead of shifting relative to whatever was already in the database.
   - `extra_schema_34.sql` — Per-subject attendance: a class can now be marked present/absent per subject/period, not just once a day for the whole program — so a student who misses first-period Social Studies but attends the rest of the day shows that accurately. Also fixes attendance so a teacher can only mark/view it for their own assigned program/subject (previously any teacher could touch any student's attendance, unscoped). Existing daily records are untouched.
   - `extra_schema_35.sql` — Subject-level teacher scoping for Assignments, same idea as the Gradebook: a teacher assigned to just one subject can only create, see, and grade assignments tagged with that subject — not another teacher's. **Any assignment created before this migration has no subject tag and becomes admin-only** until an admin opens it from the admin Assignments tab and sets its subject in the edit form (existing submissions/grades/attachments are untouched — this only affects who can currently see the row).
   - `extra_schema_36.sql` — **Bug fix, run right after extra_schema_35.sql.** That migration caused "infinite recursion detected in policy" on every assignments query (for every role, including admin) — the assignments and assignment_targets row-level security rules ended up checking each other in a loop. This fixes it.
   - `extra_schema_37.sql` — Restores the GED content days (Mon-Thu) to their full timetable structure (a second afternoon break, plus a new 10-minute break between the last two classes) and sets every period to its correct absolute time so the first class starts at 9:00 AM. Friday is left untouched.
   - `extra_schema_38.sql` — Fixes a structural gap in `teacher_test_assignments`: its unique constraint never included `subject_id`, which silently blocked assigning a teacher to two different subjects within the same program, and was the underlying reason the Teachers-tab "whole program" and per-subject checkboxes could conflict without any error.
   - `extra_schema_39.sql` — Finance security: voiding a payment or expense no longer deletes the row — it stays permanently, stamped with who voided it, when, and why (shown in the ledger, excluded from totals). Editing a fee line's amount/category is now stamped with who last touched it and when. The app additionally requires an explicit confirmation before editing/voiding anything more than 24 hours old (admin can always proceed; this is about accountability, not a hard lock).
   - `extra_schema_40.sql` — Sidebar notification badges: a red counter appears on "Announcements" and "Messages" for every role the moment something new is posted, clearing once that page is visited. Adds `mark_announcements_seen()`, following the same restrained pattern as `update_my_name()` — a signed-in user can only ever update their own "last seen" timestamp, not any other profile field.
   - `extra_schema_41.sql` — Fixes swapped Break/class labels on the GED content days (discovered on Thursday, corrected uniformly for Mon-Thu) — the times set by extra_schema_37.sql were right, but "Break" and one of the four rotating subject slots had ended up on each other's rows.
   - `extra_schema_42.sql` — Grants parents read access to `invoices` and `payment_installments` — previously only `payments` had a parent-read policy, so a parent's fee schedule/balance always came back empty even though the app never surfaced it either. Paired with a Parent portal update showing each child's balance owed and full fee schedule.
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

## Automated parent emails (optional)

Admins and teachers can send a parent a progress-update email straight from the app —
the "📤 Send progress update to parent" button on a student's Progress view. Until this
is set up, that button shows a clear error and "✉️ Open as draft in my email instead"
still works with zero setup.

To turn on automatic sending (through a Gmail account, so it doesn't need a custom domain):

1. Pick a Gmail account to send from — a dedicated one for the school (e.g.
   `waapctrainingcentre@gmail.com`) is recommended over a personal account, so it stays
   separate and isn't affected if Gmail ever rate-limits automated sending.
2. On that account, turn on **2-Step Verification** (required for the next step):
   https://myaccount.google.com/security
3. Generate an **App Password**: https://myaccount.google.com/apppasswords — this is a
   16-character code Google generates for exactly this purpose. It is *not* the account's
   normal login password, and it's the only credential this integration ever uses.
4. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and link it to your project:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
5. Deploy the function and set its secrets:
   ```
   supabase functions deploy send-parent-email
   supabase secrets set GMAIL_USER=your-school-account@gmail.com
   supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
   ```
   (the app password, spaces removed)

That's it — no code changes needed. The button starts working the moment the secrets are set.

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
