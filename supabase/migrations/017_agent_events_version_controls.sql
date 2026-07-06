begin;

alter table public.agent_health_snapshots
add column if not exists app_version text;

alter table public.agent_app_launch_events
add column if not exists app_version text;

alter table public.profiles
add column if not exists desktop_force_reauth_nonce integer not null default 0,
add column if not exists desktop_force_reauth_reason text,
add column if not exists desktop_force_reauth_requested_at timestamptz;

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id text,
  hostname text,
  app_version text,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error', 'critical')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_events_user_occurred
on public.agent_events(user_id, occurred_at desc);

alter table public.agent_events enable row level security;

drop policy if exists "admins_read_agent_events" on public.agent_events;
create policy "admins_read_agent_events"
on public.agent_events
for select
to authenticated
using (public.is_admin());

insert into public.settings (key, value, description) values
  ('minimum_desktop_version', '', 'Minimum desktop agent version required before tracking can continue'),
  ('desktop_update_download_url', '', 'Download URL shown when a desktop agent update is required'),
  ('desktop_update_required_message', 'A newer ThriveTracker version is required. Please install the latest build before continuing.', 'Message shown when a desktop agent update is required')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();

create or replace function public.record_agent_app_launch(
  p_install_id text,
  p_hostname text default null,
  p_app_version text default null
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

  insert into public.agent_app_launch_events (user_id, install_id, hostname, app_version, launched_at)
  values (
    auth.uid(),
    trim(p_install_id),
    nullif(left(trim(coalesce(p_hostname, '')), 120), ''),
    nullif(left(trim(coalesce(p_app_version, '')), 40), ''),
    launch_at
  );

  return launch_at;
end;
$$;

grant execute on function public.record_agent_app_launch(text, text, text) to authenticated;

create or replace function public.record_heartbeat(
  p_install_id text default null,
  p_queue_size integer default 0,
  p_oldest_queue_item_at timestamptz default null,
  p_screenshot_failure_started_at timestamptz default null,
  p_screenshot_failure_count integer default 0,
  p_last_screenshot_uploaded_at timestamptz default null,
  p_hostname text default null,
  p_app_version text default null
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
      app_version,
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
      nullif(left(trim(coalesce(p_app_version, '')), 40), ''),
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
      app_version = excluded.app_version,
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

grant execute on function public.record_heartbeat(text, integer, timestamptz, timestamptz, integer, timestamptz, text, text) to authenticated;

create or replace function public.record_agent_event(
  p_install_id text default null,
  p_hostname text default null,
  p_app_version text default null,
  p_event_type text default null,
  p_message text default null,
  p_occurred_at timestamptz default null,
  p_severity text default 'info',
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'va'
      and is_active = true
  ) then
    raise exception 'Agent event rejected for this user';
  end if;

  if coalesce(trim(p_event_type), '') = '' then
    raise exception 'Agent event type is required.';
  end if;

  if coalesce(trim(p_message), '') = '' then
    raise exception 'Agent event message is required.';
  end if;

  insert into public.agent_events (
    user_id,
    install_id,
    hostname,
    app_version,
    event_type,
    severity,
    message,
    details,
    occurred_at
  )
  values (
    auth.uid(),
    nullif(left(trim(coalesce(p_install_id, '')), 120), ''),
    nullif(left(trim(coalesce(p_hostname, '')), 120), ''),
    nullif(left(trim(coalesce(p_app_version, '')), 40), ''),
    left(trim(p_event_type), 80),
    case
      when p_severity in ('info', 'warning', 'error', 'critical') then p_severity
      else 'info'
    end,
    left(trim(p_message), 400),
    coalesce(p_details, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  returning id into event_id;

  return event_id;
end;
$$;

grant execute on function public.record_agent_event(text, text, text, text, text, timestamptz, text, jsonb) to authenticated;

create or replace function public.get_agent_runtime_state()
returns table (
  force_reauth_nonce integer,
  force_reauth_reason text,
  force_reauth_requested_at timestamptz,
  minimum_desktop_version text,
  desktop_update_download_url text,
  desktop_update_required_message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'va'
      and is_active = true
  ) then
    raise exception 'Agent runtime state rejected for this user';
  end if;

  return query
  select
    profiles.desktop_force_reauth_nonce,
    profiles.desktop_force_reauth_reason,
    profiles.desktop_force_reauth_requested_at,
    coalesce((select settings.value from public.settings where settings.key = 'minimum_desktop_version' limit 1), ''),
    coalesce((select settings.value from public.settings where settings.key = 'desktop_update_download_url' limit 1), ''),
    coalesce((select settings.value from public.settings where settings.key = 'desktop_update_required_message' limit 1), '')
  from public.profiles
  where profiles.id = auth.uid()
  limit 1;
end;
$$;

grant execute on function public.get_agent_runtime_state() to authenticated;

create or replace function public.request_agent_force_reauth(
  p_user_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_nonce integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can force agent reauthentication.';
  end if;

  update public.profiles
  set
    desktop_force_reauth_nonce = desktop_force_reauth_nonce + 1,
    desktop_force_reauth_reason = nullif(left(trim(coalesce(p_reason, '')), 240), ''),
    desktop_force_reauth_requested_at = now(),
    updated_at = now()
  where id = p_user_id
    and role = 'va'
  returning desktop_force_reauth_nonce into next_nonce;

  if next_nonce is null then
    raise exception 'VA profile was not found.';
  end if;

  return next_nonce;
end;
$$;

grant execute on function public.request_agent_force_reauth(uuid, text) to authenticated;

commit;
