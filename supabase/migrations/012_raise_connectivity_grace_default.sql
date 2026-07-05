begin;

update public.settings
set value = '10',
    description = 'Minutes to allow brief connection loss before tracked time is stopped',
    updated_at = now()
where key = 'connectivity_grace_minutes';

insert into public.settings (key, value, description)
select
  'connectivity_grace_minutes',
  '10',
  'Minutes to allow brief connection loss before tracked time is stopped'
where not exists (
  select 1
  from public.settings
  where key = 'connectivity_grace_minutes'
);

commit;
