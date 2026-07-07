begin;

alter table public.activity_logs
add column if not exists app_version text;

alter table public.screenshots
add column if not exists app_version text;

commit;
