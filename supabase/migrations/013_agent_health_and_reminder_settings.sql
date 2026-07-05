begin;

create table if not exists public.agent_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id text not null,
  hostname text,
  queue_size integer not null default 0 check (queue_size >= 0),
  oldest_queue_item_at timestamptz,
  screenshot_failure_started_at timestamptz,
  screenshot_failure_count integer not null default 0 check (screenshot_failure_count >= 0),
  last_screenshot_uploaded_at timestamptz,
  last_health_ping_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, install_id)
);

create index if not exists idx_agent_health_snapshots_user_ping
on public.agent_health_snapshots(user_id, last_health_ping_at desc);

drop trigger if exists set_agent_health_snapshots_updated_at on public.agent_health_snapshots;
create trigger set_agent_health_snapshots_updated_at
before update on public.agent_health_snapshots
for each row execute function public.set_updated_at();

alter table public.agent_health_snapshots enable row level security;

drop policy if exists "admins_read_agent_health_snapshots" on public.agent_health_snapshots;
create policy "admins_read_agent_health_snapshots"
on public.agent_health_snapshots
for select
to authenticated
using (public.is_admin());

create table if not exists public.agent_app_launch_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id text not null,
  hostname text,
  launched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_app_launch_events_user_launched
on public.agent_app_launch_events(user_id, launched_at desc);

alter table public.agent_app_launch_events enable row level security;

drop policy if exists "admins_read_agent_app_launch_events" on public.agent_app_launch_events;
create policy "admins_read_agent_app_launch_events"
on public.agent_app_launch_events
for select
to authenticated
using (public.is_admin());

alter table public.dashboard_alerts
drop constraint if exists dashboard_alerts_type_check;

alter table public.dashboard_alerts
add constraint dashboard_alerts_type_check
check (
  type in (
    'low_activity',
    'stale_heartbeat',
    'missing_heartbeat',
    'crash_closed',
    'late_start',
    'no_show',
    'screenshot_sync',
    'queue_backlog',
    'restart_loop'
  )
);

insert into public.settings (key, value, description) values
  ('screenshot_failure_alert_minutes', '15', 'Minutes of ongoing screenshot upload failures before an admin alert fires'),
  ('offline_queue_alert_count', '5', 'Queued sync items before an admin alert fires'),
  ('offline_queue_alert_minutes', '10', 'Minutes the oldest queued sync item can remain before an admin alert fires'),
  ('restart_loop_alert_count', '3', 'App launches within one shift before a restart-loop alert fires'),
  ('shift_start_reminder_delay_minutes', '10', 'Minutes after a fixed shift starts before the VA gets a reminder')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();

create or replace function public.record_agent_app_launch(
  p_install_id text,
  p_hostname text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  launch_at timestamptz := now();
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'va'
      and is_active = true
  ) then
    raise exception 'Agent launch rejected for this user';
  end if;

  if coalesce(trim(p_install_id), '') = '' then
    raise exception 'Device install id is required.';
  end if;

  insert into public.agent_app_launch_events (user_id, install_id, hostname, launched_at)
  values (
    auth.uid(),
    trim(p_install_id),
    nullif(left(trim(coalesce(p_hostname, '')), 120), ''),
    launch_at
  );

  return launch_at;
end;
$$;

grant execute on function public.record_agent_app_launch(text, text) to authenticated;

create or replace function public.record_heartbeat(
  p_install_id text default null,
  p_queue_size integer default 0,
  p_oldest_queue_item_at timestamptz default null,
  p_screenshot_failure_started_at timestamptz default null,
  p_screenshot_failure_count integer default 0,
  p_last_screenshot_uploaded_at timestamptz default null,
  p_hostname text default null
)
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

    insert into public.agent_health_snapshots (
      user_id,
      install_id,
      hostname,
      queue_size,
      oldest_queue_item_at,
      screenshot_failure_started_at,
      screenshot_failure_count,
      last_screenshot_uploaded_at,
      last_health_ping_at
    )
    values (
      auth.uid(),
      trim(p_install_id),
      nullif(left(trim(coalesce(p_hostname, '')), 120), ''),
      greatest(coalesce(p_queue_size, 0), 0),
      p_oldest_queue_item_at,
      p_screenshot_failure_started_at,
      greatest(coalesce(p_screenshot_failure_count, 0), 0),
      p_last_screenshot_uploaded_at,
      heartbeat_at
    )
    on conflict (user_id, install_id) do update
    set
      hostname = excluded.hostname,
      queue_size = excluded.queue_size,
      oldest_queue_item_at = excluded.oldest_queue_item_at,
      screenshot_failure_started_at = excluded.screenshot_failure_started_at,
      screenshot_failure_count = excluded.screenshot_failure_count,
      last_screenshot_uploaded_at = excluded.last_screenshot_uploaded_at,
      last_health_ping_at = heartbeat_at,
      updated_at = now();
  end if;

  return heartbeat_at;
end;
$$;

grant execute on function public.record_heartbeat(text, integer, timestamptz, timestamptz, integer, timestamptz, text) to authenticated;

commit;
