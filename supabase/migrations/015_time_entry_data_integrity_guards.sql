create or replace function public.validate_time_entry_bounds()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stopped_at is not null and new.stopped_at < new.started_at then
    raise exception 'Time entry stopped_at cannot be earlier than started_at.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_time_entry_bounds on public.time_entries;

create trigger trg_validate_time_entry_bounds
before insert or update on public.time_entries
for each row
execute function public.validate_time_entry_bounds();

create or replace function public.validate_activity_log_entry_window()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  entry_started_at timestamptz;
  entry_stopped_at timestamptz;
begin
  select started_at, stopped_at
  into entry_started_at, entry_stopped_at
  from public.time_entries
  where id = new.time_entry_id;

  if entry_started_at is null then
    raise exception 'Referenced time entry does not exist.';
  end if;

  if new.timestamp < entry_started_at then
    raise exception 'Activity log timestamp cannot be earlier than its time entry start.';
  end if;

  if entry_stopped_at is not null and new.timestamp > entry_stopped_at then
    raise exception 'Activity log timestamp cannot be later than its time entry stop.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_activity_log_entry_window on public.activity_logs;

create trigger trg_validate_activity_log_entry_window
before insert or update on public.activity_logs
for each row
execute function public.validate_activity_log_entry_window();

create or replace function public.validate_screenshot_entry_window()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  entry_started_at timestamptz;
  entry_stopped_at timestamptz;
begin
  select started_at, stopped_at
  into entry_started_at, entry_stopped_at
  from public.time_entries
  where id = new.time_entry_id;

  if entry_started_at is null then
    raise exception 'Referenced time entry does not exist.';
  end if;

  if new.captured_at < entry_started_at then
    raise exception 'Screenshot time cannot be earlier than its time entry start.';
  end if;

  if entry_stopped_at is not null and new.captured_at > entry_stopped_at then
    raise exception 'Screenshot time cannot be later than its time entry stop.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_screenshot_entry_window on public.screenshots;

create trigger trg_validate_screenshot_entry_window
before insert or update on public.screenshots
for each row
execute function public.validate_screenshot_entry_window();
