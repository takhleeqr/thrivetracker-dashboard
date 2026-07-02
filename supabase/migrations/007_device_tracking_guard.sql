begin;

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id text not null,
  device_fingerprint text not null,
  hostname text not null,
  os_username text,
  first_seen_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, install_id)
);

create index if not exists idx_user_devices_user_seen
on public.user_devices(user_id, last_seen_at desc, last_login_at desc);

drop trigger if exists set_user_devices_updated_at on public.user_devices;
create trigger set_user_devices_updated_at
before update on public.user_devices
for each row execute function public.set_updated_at();

alter table public.user_devices enable row level security;

drop policy if exists "admins_manage_user_devices" on public.user_devices;
create policy "admins_manage_user_devices"
on public.user_devices
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vas_read_own_user_devices" on public.user_devices;
create policy "vas_read_own_user_devices"
on public.user_devices
for select
to authenticated
using (user_id = auth.uid());

alter table public.time_entries
add column if not exists device_id uuid references public.user_devices(id),
add column if not exists device_hostname text,
add column if not exists device_os_username text,
add column if not exists device_fingerprint text;

create index if not exists idx_time_entries_device_id
on public.time_entries(device_id);

with ranked_open_entries as (
  select
    id,
    user_id,
    started_at,
    row_number() over (
      partition by user_id
      order by started_at desc, created_at desc, id desc
    ) as row_num
  from public.time_entries
  where stopped_at is null
),
duplicate_open_entries as (
  select
    time_entries.id,
    coalesce(profiles.last_seen_at, now()) as stopped_at,
    greatest(
      0,
      extract(epoch from (coalesce(profiles.last_seen_at, now()) - time_entries.started_at))
    )::integer as duration_seconds
  from public.time_entries
  inner join ranked_open_entries on ranked_open_entries.id = time_entries.id
  left join public.profiles on profiles.id = time_entries.user_id
  where ranked_open_entries.row_num > 1
)
update public.time_entries
set
  stopped_at = duplicate_open_entries.stopped_at,
  duration_seconds = duplicate_open_entries.duration_seconds,
  stop_reason = 'crash'
from duplicate_open_entries
where public.time_entries.id = duplicate_open_entries.id;

create unique index if not exists idx_time_entries_one_open_per_user
on public.time_entries(user_id)
where stopped_at is null;

create or replace function public.register_user_device(
  p_install_id text,
  p_device_fingerprint text,
  p_hostname text,
  p_os_username text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  device_id uuid;
begin
  if coalesce(trim(p_install_id), '') = '' then
    raise exception 'Device install id is required.';
  end if;

  if coalesce(trim(p_device_fingerprint), '') = '' then
    raise exception 'Device fingerprint is required.';
  end if;

  if coalesce(trim(p_hostname), '') = '' then
    raise exception 'Computer name is required.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'va'
      and is_active = true
  ) then
    raise exception 'Desktop agent access is for active VA accounts only.';
  end if;

  insert into public.user_devices (
    user_id,
    install_id,
    device_fingerprint,
    hostname,
    os_username,
    last_login_at
  )
  values (
    auth.uid(),
    trim(p_install_id),
    trim(p_device_fingerprint),
    left(trim(p_hostname), 120),
    nullif(left(trim(coalesce(p_os_username, '')), 120), ''),
    now()
  )
  on conflict (user_id, install_id) do update
  set
    device_fingerprint = excluded.device_fingerprint,
    hostname = excluded.hostname,
    os_username = excluded.os_username,
    last_login_at = now(),
    updated_at = now()
  returning id into device_id;

  return device_id;
end;
$$;

grant execute on function public.register_user_device(text, text, text, text) to authenticated;

create or replace function public.start_tracking_session(
  p_project_id uuid,
  p_install_id text,
  p_device_fingerprint text,
  p_hostname text,
  p_os_username text default null
)
returns table (
  id uuid,
  user_id uuid,
  project_id uuid,
  started_at timestamptz,
  stopped_at timestamptz,
  duration_seconds integer,
  is_manual boolean,
  stop_reason text,
  created_at timestamptz,
  device_id uuid,
  device_hostname text,
  device_os_username text,
  device_fingerprint text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_last_seen timestamptz;
  registered_device_id uuid;
  existing_entry record;
  stale_cutoff timestamptz := now() - make_interval(mins => 10);
  closed_at timestamptz;
  closed_duration integer;
begin
  if p_project_id is not null and not public.is_project_assigned(p_project_id) then
    raise exception 'This project is not assigned to this VA.';
  end if;

  registered_device_id := public.register_user_device(
    p_install_id,
    p_device_fingerprint,
    p_hostname,
    p_os_username
  );

  select last_seen_at
  into profile_last_seen
  from public.profiles
  where id = auth.uid();

  select
    time_entries.id,
    time_entries.user_id,
    time_entries.project_id,
    time_entries.started_at,
    time_entries.stopped_at,
    time_entries.duration_seconds,
    time_entries.is_manual,
    time_entries.stop_reason,
    time_entries.created_at,
    time_entries.device_id,
    time_entries.device_hostname,
    time_entries.device_os_username,
    time_entries.device_fingerprint,
    coalesce(user_devices.hostname, time_entries.device_hostname, 'another device') as active_device_name
  into existing_entry
  from public.time_entries
  left join public.user_devices on user_devices.id = time_entries.device_id
  where time_entries.user_id = auth.uid()
    and time_entries.stopped_at is null
  order by time_entries.started_at desc, time_entries.created_at desc
  limit 1;

  if found then
    if existing_entry.device_fingerprint = trim(p_device_fingerprint) then
      return query
      select
        time_entries.id,
        time_entries.user_id,
        time_entries.project_id,
        time_entries.started_at,
        time_entries.stopped_at,
        time_entries.duration_seconds,
        time_entries.is_manual,
        time_entries.stop_reason,
        time_entries.created_at,
        time_entries.device_id,
        time_entries.device_hostname,
        time_entries.device_os_username,
        time_entries.device_fingerprint
      from public.time_entries
      where time_entries.id = existing_entry.id;
      return;
    end if;

    if profile_last_seen is not null and profile_last_seen < stale_cutoff then
      closed_at := profile_last_seen;
      closed_duration := greatest(0, extract(epoch from (closed_at - existing_entry.started_at)))::integer;

      update public.time_entries
      set
        stopped_at = closed_at,
        duration_seconds = closed_duration,
        stop_reason = 'crash'
      where public.time_entries.id = existing_entry.id;
    else
      raise exception 'This account is already tracking on %.', existing_entry.active_device_name;
    end if;
  end if;

  return query
  insert into public.time_entries (
    user_id,
    project_id,
    started_at,
    is_manual,
    device_id,
    device_hostname,
    device_os_username,
    device_fingerprint
  )
  values (
    auth.uid(),
    p_project_id,
    now(),
    false,
    registered_device_id,
    left(trim(p_hostname), 120),
    nullif(left(trim(coalesce(p_os_username, '')), 120), ''),
    trim(p_device_fingerprint)
  )
  returning
    time_entries.id,
    time_entries.user_id,
    time_entries.project_id,
    time_entries.started_at,
    time_entries.stopped_at,
    time_entries.duration_seconds,
    time_entries.is_manual,
    time_entries.stop_reason,
    time_entries.created_at,
    time_entries.device_id,
    time_entries.device_hostname,
    time_entries.device_os_username,
    time_entries.device_fingerprint;
end;
$$;

grant execute on function public.start_tracking_session(uuid, text, text, text, text) to authenticated;

create or replace function public.record_heartbeat(p_install_id text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  heartbeat_at timestamptz := now();
begin
  update public.profiles
  set last_seen_at = heartbeat_at
  where id = auth.uid()
    and role = 'va'
    and is_active = true;

  if not found then
    raise exception 'Heartbeat rejected for this user';
  end if;

  if coalesce(trim(p_install_id), '') <> '' then
    update public.user_devices
    set
      last_seen_at = heartbeat_at,
      updated_at = now()
    where user_id = auth.uid()
      and install_id = trim(p_install_id);
  end if;

  return heartbeat_at;
end;
$$;

grant execute on function public.record_heartbeat(text) to authenticated;

commit;
