begin;

alter table public.time_entries
alter column started_at set default now();

commit;
