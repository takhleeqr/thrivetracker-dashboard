# Owner Setup Guide

This guide is for the manual things you need to do while I build the code. Keep credentials private. Do not paste secret keys into chat unless you intentionally want them exposed in this thread.

## What You Need To Register For

### 1. Supabase

Use Supabase for database, login/auth, user accounts, and security rules.

- Website: https://supabase.com/dashboard/sign-up
- You can sign up with GitHub or with email/password.
- Supabase's signup page supports GitHub login or email/password signup.
- You will create one Supabase project per company.

You need to collect these values:

- Project URL
- Publishable key, or legacy anon key
- Secret key, or legacy service role key
- Database password that you create while making the project

### 2. Supabase Storage

Use Supabase Storage for storing screenshots.

- Website: https://supabase.com/dashboard
- Product path inside Supabase: `Storage`
- Create a private bucket named `screenshots`.

You need to collect these values:

- Bucket name: `screenshots`

### 3. Vercel

Use Vercel later for hosting the admin web dashboard.

- Website: https://vercel.com/signup
- You can sign up with GitHub, GitLab, Bitbucket, Google, or Apple.
- We do not need this immediately for Phase 1 and Phase 2.
- It becomes necessary in Phase 4 when the dashboard is ready to deploy.

You need to collect these values later:

- Vercel account access
- Production dashboard URL after deployment
- Environment variables added in Vercel project settings

### 4. GitHub

GitHub is optional right now but useful later for Vercel deployment.

- Website: https://github.com/signup
- Vercel works nicely when it can import a GitHub repository.
- If you already have GitHub, no new account is needed.

## Phase 1: Supabase Steps For You

### Step 1: Create Supabase Account

1. Open https://supabase.com/dashboard/sign-up
2. Sign up using GitHub or email/password.
3. Confirm your email if Supabase asks.
4. Log in to the Supabase dashboard.

### Step 2: Create Organization

1. If Supabase asks for an organization, create one.
2. Suggested organization name: `ThriveTracker`.
3. Use the free plan unless you already know you need a paid plan.

### Step 3: Create Project

1. Click `New project`.
2. Project name: `ThriveTracker First Company` or the actual company name.
3. Generate a strong database password.
4. Save the database password in a password manager.
5. Choose a region close to the company/admin users.
6. Create the project.
7. Wait until Supabase finishes provisioning.

### Step 4: Copy Supabase Keys

1. Open the project.
2. Go to `Project Settings` > `API Keys`, or use the project's `Connect` dialog if Supabase shows that instead.
3. Copy the project URL.
4. Copy the publishable key.
5. Copy the secret key.
6. If your dashboard shows legacy keys instead, copy the anon key and service role key.

Put them into your local `.env` file like this:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
```

If you only see legacy keys:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Step 5: Run The Database SQL

1. In Supabase, open `SQL Editor`.
2. Create a new query.
3. Open this local file: `supabase/migrations/001_initial_schema.sql`.
4. Copy the whole SQL into Supabase SQL Editor.
5. Click `Run`.
6. Confirm it finishes without errors.

This creates tables, settings, indexes, profile automation, and security policies.

### Step 6: Create Your First Admin User

1. Go to `Authentication` > `Users`.
2. Click `Add user`.
3. Add your admin email and password.
4. Confirm/create the user.
5. Go back to `SQL Editor`.
6. Run this query, replacing the email and name:

```sql
update public.profiles
set role = 'admin',
    full_name = 'Your Name',
    is_active = true
where email = 'your-email@example.com';
```

### Step 7: Create Test VA Users

Create two VA users for testing:

- `va1@yourdomain.com`
- `va2@yourdomain.com`

New users automatically become `role = 'va'`.

You can change their display names with:

```sql
update public.profiles
set full_name = 'VA One'
where email = 'va1@yourdomain.com';

update public.profiles
set full_name = 'VA Two'
where email = 'va2@yourdomain.com';
```

### Step 8: Create Test Projects

Run this after creating your admin user:

```sql
insert into public.projects (name, description, color, created_by)
select 'Client Work', 'General client delivery work', '#2563EB', id
from public.profiles
where email = 'your-email@example.com';

insert into public.projects (name, description, color, created_by)
select 'Admin Work', 'Internal operations and reporting', '#16A34A', id
from public.profiles
where email = 'your-email@example.com';
```

### Step 9: Assign Test VAs To Projects

Run this after creating VA users and projects:

```sql
insert into public.project_assignments (user_id, project_id)
select va.id, project.id
from public.profiles va
cross join public.projects project
where va.email in ('va1@yourdomain.com', 'va2@yourdomain.com')
  and project.name in ('Client Work', 'Admin Work')
on conflict do nothing;
```

## Phase 2: Supabase Storage Steps For You

### Step 1: Open Supabase Storage

1. Open your Supabase project.
2. Go to `Storage`.

### Step 2: Create Screenshots Bucket

1. Click `New bucket`.
2. Bucket name: `screenshots`.
3. Keep the bucket private.
4. Create the bucket.
5. Open `SQL Editor`.
6. Run `supabase/storage/001_screenshots_bucket_policies.sql`.

### Step 3: Confirm `.env`

Make sure `.env` contains:

```text
SUPABASE_STORAGE_BUCKET=screenshots
```

### Step 4: Tell Me When Done

When you finish Supabase setup and Storage bucket setup, send me:

- Supabase project URL only
- Whether your Supabase keys are `publishable/secret` or `anon/service_role`
- Confirmation that the SQL migration ran successfully
- Confirmation that the `screenshots` bucket exists
- Do not send secret keys in chat

## What I Can Do After You Finish These Steps

- Build the desktop agent login flow.
- Connect the agent to Supabase Auth.
- Fetch assigned projects from Supabase.
- Start implementing timer and time entries.
- Test Supabase Storage uploads using your local `.env` if credentials are present on this machine.
- Keep updating `BUILD_CHECKLIST.md` as each chunk is completed.

## Quick Progress Tracker For You

- [ ] Supabase account created.
- [ ] Supabase project created.
- [ ] Supabase project URL copied into `.env`.
- [ ] Supabase publishable/anon key copied into `.env`.
- [ ] Supabase secret/service role key copied into `.env`.
- [ ] SQL migration ran successfully.
- [ ] Admin user created.
- [ ] Admin profile changed to `role = 'admin'`.
- [ ] Two test VA users created.
- [ ] Test projects created.
- [ ] Test VAs assigned to projects.
- [ ] Supabase Storage bucket `screenshots` created.
- [ ] Supabase Storage bucket policies SQL ran successfully.
- [ ] `SUPABASE_STORAGE_BUCKET=screenshots` added to `.env`.
