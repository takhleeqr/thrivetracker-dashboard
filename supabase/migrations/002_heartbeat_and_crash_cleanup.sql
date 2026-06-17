begin;

alter table public.profiles
add column if not exists last_seen_at timestamptz;

create index if not exists idx_profiles_last_seen_at
on public.profiles(last_seen_at desc);

alter table public.time_entries
drop constraint if exists time_entries_stop_reason_check;

alter table public.time_entries
add constraint time_entries_stop_reason_check
check (stop_reason is null or stop_reason in ('manual', 'idle', 'app_close', 'crash'));

create or replace function public.record_heartbeat()
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

  return heartbeat_at;
end;
$$;

grant execute on function public.record_heartbeat() to authenticated;

create or replace function public.close_stale_time_entries(stale_after_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can close stale time entries';
  end if;

  with stale_entries as (
    select
      time_entries.id,
      greatest(0, extract(epoch from (profiles.last_seen_at - time_entries.started_at)))::integer as duration_seconds,
      profiles.last_seen_at as stopped_at
    from public.time_entries
    inner join public.profiles on profiles.id = time_entries.user_id
    where time_entries.stopped_at is null
      and profiles.last_seen_at is not null
      and profiles.last_seen_at < now() - make_interval(mins => stale_after_minutes)
  ),
  updated_entries as (
    update public.time_entries
    set
      stopped_at = stale_entries.stopped_at,
      duration_seconds = stale_entries.duration_seconds,
      stop_reason = 'crash'
    from stale_entries
    where public.time_entries.id = stale_entries.id
    returning public.time_entries.id
  )
  select count(*) into closed_count from updated_entries;

  return closed_count;
end;
$$;

grant execute on function public.close_stale_time_entries(integer) to authenticated;

commit;
