# Supabase Setup

Use this guide for Phase 1. Each company should get its own Supabase project.

For the easiest click-by-click owner instructions, start with `docs/OWNER_SETUP_GUIDE.md`.

## Manual Setup

1. Create a new Supabase project.
2. Enable email/password auth.
3. Copy the project URL, publishable key, and secret key into `.env`.
   - If your Supabase dashboard only shows legacy keys, use anon key and service role key instead.
4. Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor or through the Supabase CLI.
5. Create the first admin user in Supabase Auth.
6. Update that user's profile row:

```sql
update public.profiles
set role = 'admin', full_name = 'Admin Name', is_active = true
where email = 'admin@example.com';
```

7. Create VA users through Auth. New users default to `role = 'va'`.
8. Create projects and project assignments as an admin.

## Security Notes

- RLS is enabled for every public table.
- Admin users can manage all data.
- VA users can only read their own profile, assigned projects, own time entries, own activity logs, own screenshots, and settings.
- The desktop agent should use the VA's Supabase JWT.
- The dashboard should use the user's Supabase session for normal reads/writes.
- Service role key must only be used from trusted server-side code or local admin scripts.

## Verification Checklist

- [ ] Run `supabase/verification/001_basic_checks.sql` after the main migration.
- [ ] Admin can sign in.
- [ ] Admin can read all profiles.
- [ ] Admin can create projects.
- [ ] Admin can assign VAs to projects.
- [ ] VA can sign in.
- [ ] VA can read own profile.
- [ ] VA cannot read another VA profile.
- [ ] VA can read assigned projects.
- [ ] VA cannot read unassigned projects.
- [ ] VA can create own time entry.
- [ ] VA cannot create time entry for another user.
- [ ] VA can insert own activity logs.
- [ ] VA can insert own screenshot metadata.
- [ ] VA can read settings.
