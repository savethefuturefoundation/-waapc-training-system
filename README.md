# WAAPC Training Centre System

Admin console + student portal for WAAPC Training Centre: registration, flexible
payment plans, invoices/receipts, practice & mock exams (including Listening
audio passages and Speaking recorded prompts), attendance, progress reports,
certificates, and a Question Bank editor with CSV bulk import.

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
4. In Supabase **Authentication → Providers → Email**, turn off "Confirm email" (so a student's or teacher's first-login signup works immediately).
5. Create your admin account: **Authentication → Users → Add user** (check "Auto Confirm User"), then in the SQL Editor:
   ```sql
   update profiles set role = 'admin' where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
   ```
   Teachers don't need this manual step — invite them from the Admin dashboard's **Teachers** tab instead.
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
