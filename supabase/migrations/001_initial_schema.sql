begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'va' check (role in ('admin', 'va')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  color text not null default '#2563EB',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (user_id, project_id)
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id),
  started_at timestamptz not null,
  stopped_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  is_manual boolean not null default false,
  stop_reason text check (stop_reason is null or stop_reason in ('manual', 'idle', 'app_close')),
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  timestamp timestamptz not null,
  keystrokes_count integer not null default 0 check (keystrokes_count >= 0),
  mouse_clicks_count integer not null default 0 check (mouse_clicks_count >= 0),
  mouse_moved boolean not null default false,
  activity_percent real not null default 0 check (activity_percent >= 0 and activity_percent <= 100),
  active_window_title text,
  active_app_name text
);

create table if not exists public.screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  project_id uuid references public.projects(id),
  captured_at timestamptz not null,
  storage_url text,
  storage_key text not null,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),
  activity_percent_at_capture real check (
    activity_percent_at_capture is null
    or (activity_percent_at_capture >= 0 and activity_percent_at_capture <= 100)
  )
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_active on public.profiles(is_active);
create index if not exists idx_project_assignments_user on public.project_assignments(user_id);
create index if not exists idx_project_assignments_project on public.project_assignments(project_id);
create index if not exists idx_time_entries_user_started on public.time_entries(user_id, started_at desc);
create index if not exists idx_time_entries_project_started on public.time_entries(project_id, started_at desc);
create index if not exists idx_activity_logs_user_timestamp on public.activity_logs(user_id, timestamp desc);
create index if not exists idx_activity_logs_entry_timestamp on public.activity_logs(time_entry_id, timestamp desc);
create index if not exists idx_screenshots_user_captured on public.screenshots(user_id, captured_at desc);
create index if not exists idx_screenshots_project_captured on public.screenshots(project_id, captured_at desc);
create unique index if not exists idx_screenshots_storage_key on public.screenshots(storage_key);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists set_settings_updated_at on public.settings;
create trigger set_settings_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

insert into public.settings (key, value, description) values
  ('screenshot_interval_minutes', '5', 'Minutes between screenshot captures'),
  ('screenshot_quality', '60', 'JPEG quality from 1 to 100'),
  ('idle_timeout_minutes', '5', 'Minutes of no activity before auto-pause'),
  ('low_activity_threshold', '30', 'Activity percent below this triggers alerts'),
  ('data_retention_days', '90', 'Auto-delete screenshots older than this'),
  ('work_start_time', '09:00', 'Expected work start time'),
  ('work_end_time', '17:00', 'Expected work end time'),
  ('max_screenshots_per_day', '200', 'Safety cap per VA per day'),
  ('timezone', 'UTC', 'Company timezone for reports')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    'va'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active = true
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
  );
$$;

create or replace function public.is_project_assigned(project_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_assignments
    where user_id = auth.uid()
      and project_id = project_uuid
  );
$$;

create or replace function public.is_time_entry_owner(time_entry_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.time_entries
    where id = time_entry_uuid
      and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;
alter table public.time_entries enable row level security;
alter table public.activity_logs enable row level security;
alter table public.screenshots enable row level security;
alter table public.settings enable row level security;

drop policy if exists "admins_manage_profiles" on public.profiles;
create policy "admins_manage_profiles"
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "users_read_own_profile" on public.profiles;
create policy "users_read_own_profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "admins_manage_projects" on public.projects;
create policy "admins_manage_projects"
on public.projects
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vas_read_assigned_projects" on public.projects;
create policy "vas_read_assigned_projects"
on public.projects
for select
to authenticated
using (is_active = true and public.is_project_assigned(id));

drop policy if exists "admins_manage_project_assignments" on public.project_assignments;
create policy "admins_manage_project_assignments"
on public.project_assignments
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vas_read_own_project_assignments" on public.project_assignments;
create policy "vas_read_own_project_assignments"
on public.project_assignments
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins_manage_time_entries" on public.time_entries;
create policy "admins_manage_time_entries"
on public.time_entries
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vas_read_own_time_entries" on public.time_entries;
create policy "vas_read_own_time_entries"
on public.time_entries
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "vas_insert_own_time_entries" on public.time_entries;
create policy "vas_insert_own_time_entries"
on public.time_entries
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_active_user()
  and (project_id is null or public.is_project_assigned(project_id))
);

drop policy if exists "vas_update_own_time_entries" on public.time_entries;
create policy "vas_update_own_time_entries"
on public.time_entries
for update
to authenticated
using (user_id = auth.uid() and public.is_active_user())
with check (
  user_id = auth.uid()
  and (project_id is null or public.is_project_assigned(project_id))
);

drop policy if exists "admins_manage_activity_logs" on public.activity_logs;
create policy "admins_manage_activity_logs"
on public.activity_logs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vas_read_own_activity_logs" on public.activity_logs;
create policy "vas_read_own_activity_logs"
on public.activity_logs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "vas_insert_own_activity_logs" on public.activity_logs;
create policy "vas_insert_own_activity_logs"
on public.activity_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_active_user()
  and public.is_time_entry_owner(time_entry_id)
);

drop policy if exists "admins_manage_screenshots" on public.screenshots;
create policy "admins_manage_screenshots"
on public.screenshots
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vas_read_own_screenshots" on public.screenshots;
create policy "vas_read_own_screenshots"
on public.screenshots
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "vas_insert_own_screenshots" on public.screenshots;
create policy "vas_insert_own_screenshots"
on public.screenshots
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_active_user()
  and public.is_time_entry_owner(time_entry_id)
  and (project_id is null or public.is_project_assigned(project_id))
);

drop policy if exists "admins_manage_settings" on public.settings;
create policy "admins_manage_settings"
on public.settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "active_users_read_settings" on public.settings;
create policy "active_users_read_settings"
on public.settings
for select
to authenticated
using (public.is_active_user());

commit;

