begin;

do $$
declare
  existing_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $sql$
      select jobid
      from cron.job
      where jobname = 'close-stale-time-entries-every-5-minutes'
      limit 1
    $sql$
    into existing_job_id;

    if existing_job_id is not null then
      execute format('select cron.unschedule(%s)', existing_job_id);
    end if;

    execute $sql$
      select cron.schedule(
        'close-stale-time-entries-every-5-minutes',
        '*/5 * * * *',
        'select public.close_stale_time_entries(10);'
      )
    $sql$;
  end if;
end
$$;

commit;
