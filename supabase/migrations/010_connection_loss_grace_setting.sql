begin;

insert into public.settings (key, value, description) values
  ('connectivity_grace_minutes', '2', 'Minutes to allow brief connection loss before tracked time is stopped')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();

commit;
