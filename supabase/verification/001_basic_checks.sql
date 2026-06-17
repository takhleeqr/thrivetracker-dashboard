-- Run these after supabase/migrations/001_initial_schema.sql.
-- Replace the email placeholders before running.

-- 1. Confirm tables exist.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'projects',
    'project_assignments',
    'time_entries',
    'activity_logs',
    'screenshots',
    'settings'
  )
order by table_name;

-- 2. Confirm default settings exist.
select key, value
from public.settings
order by key;

-- 3. Confirm users and roles.
select id, email, full_name, role, is_active
from public.profiles
order by created_at;

-- 4. Promote your first admin.
-- update public.profiles
-- set role = 'admin', full_name = 'Your Name', is_active = true
-- where email = 'your-email@example.com';

-- 5. Confirm projects.
select id, name, description, color, is_active
from public.projects
order by created_at;

-- 6. Confirm assignments.
select
  va.email as va_email,
  va.full_name as va_name,
  project.name as project_name
from public.project_assignments assignment
join public.profiles va on va.id = assignment.user_id
join public.projects project on project.id = assignment.project_id
order by va.email, project.name;

-- 7. Create one sample time entry for a VA.
-- insert into public.time_entries (user_id, project_id, started_at, stopped_at, duration_seconds, stop_reason)
-- select va.id, project.id, now() - interval '1 hour', now(), 3600, 'manual'
-- from public.profiles va
-- join public.project_assignments assignment on assignment.user_id = va.id
-- join public.projects project on project.id = assignment.project_id
-- where va.email = 'va1@yourdomain.com'
-- limit 1;

-- 8. Confirm today's hours by VA.
select
  profile.email,
  profile.full_name,
  coalesce(sum(entry.duration_seconds), 0) as total_seconds,
  round(coalesce(sum(entry.duration_seconds), 0) / 3600.0, 2) as total_hours
from public.profiles profile
left join public.time_entries entry
  on entry.user_id = profile.id
  and entry.started_at >= date_trunc('day', now())
where profile.role = 'va'
group by profile.id, profile.email, profile.full_name
order by profile.email;

