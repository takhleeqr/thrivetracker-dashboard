begin;

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

  select public.profiles.last_seen_at
  into profile_last_seen
  from public.profiles
  where public.profiles.id = auth.uid();

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

commit;
