begin;

alter table public.profiles
add column if not exists hourly_rate numeric(10, 2) not null default 0,
add column if not exists expected_hours_per_week numeric(5, 2) not null default 0,
add column if not exists working_days text[] not null default array[]::text[];

alter table public.profiles
drop constraint if exists profiles_hourly_rate_check;

alter table public.profiles
add constraint profiles_hourly_rate_check
check (hourly_rate >= 0 and hourly_rate <= 10000);

alter table public.profiles
drop constraint if exists profiles_expected_hours_per_week_check;

alter table public.profiles
add constraint profiles_expected_hours_per_week_check
check (expected_hours_per_week >= 0 and expected_hours_per_week <= 168);

alter table public.profiles
drop constraint if exists profiles_working_days_check;

alter table public.profiles
add constraint profiles_working_days_check
check (
  working_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[]
);

create index if not exists idx_profiles_working_days
on public.profiles using gin (working_days);

alter table public.time_entries
add column if not exists manual_note text;

insert into public.settings (key, value, description) values
  ('low_activity_threshold', '30', 'Activity percent below this can trigger low activity alerts'),
  ('low_activity_minimum_minutes', '15', 'Consecutive low-activity minutes before a low activity alert fires'),
  ('late_start_time', '10:00', 'Scheduled-day start time after which a VA is marked late if they have not started tracking'),
  ('app_categories_unproductive', '[]', 'JSON array of app names marked as unproductive'),
  ('timezone', 'Asia/Karachi', 'Company timezone for dashboard display and schedule checks')
on conflict (key) do update set
  description = excluded.description,
  updated_at = now();

update public.settings
set value = 'Asia/Karachi',
    updated_at = now()
where key = 'timezone'
  and value = 'UTC';

commit;
