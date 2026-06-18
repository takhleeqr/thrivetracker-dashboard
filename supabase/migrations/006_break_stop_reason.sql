begin;

alter table public.time_entries
drop constraint if exists time_entries_stop_reason_check;

alter table public.time_entries
add constraint time_entries_stop_reason_check
check (
  stop_reason is null
  or stop_reason in ('manual', 'idle', 'app_close', 'crash', 'break')
);

commit;
