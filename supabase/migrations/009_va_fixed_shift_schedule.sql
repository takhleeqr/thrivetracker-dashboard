begin;

alter table public.profiles
add column if not exists schedule_type text not null default 'flexible',
add column if not exists shift_start_time time,
add column if not exists shift_end_time time;

alter table public.profiles
drop constraint if exists profiles_schedule_type_check;

alter table public.profiles
add constraint profiles_schedule_type_check
check (schedule_type in ('flexible', 'fixed'));

with company_defaults as (
  select
    coalesce((select value from public.settings where key = 'work_start_time' limit 1), '09:00')::time as start_time,
    coalesce((select value from public.settings where key = 'work_end_time' limit 1), '17:00')::time as end_time
)
update public.profiles as profile
set
  schedule_type = case
    when coalesce(array_length(profile.working_days, 1), 0) > 0 then 'fixed'
    else 'flexible'
  end,
  shift_start_time = case
    when coalesce(array_length(profile.working_days, 1), 0) > 0 then defaults.start_time
    else null
  end,
  shift_end_time = case
    when coalesce(array_length(profile.working_days, 1), 0) > 0 then defaults.end_time
    else null
  end
from company_defaults as defaults
where profile.role = 'va';

alter table public.profiles
drop constraint if exists profiles_shift_window_check;

alter table public.profiles
add constraint profiles_shift_window_check
check (
  (schedule_type = 'flexible' and shift_start_time is null and shift_end_time is null)
  or
  (schedule_type = 'fixed' and shift_start_time is not null and shift_end_time is not null and shift_end_time > shift_start_time)
);

commit;
