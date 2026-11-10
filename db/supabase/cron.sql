-- Supabase only: calls the app's heartbeat every minute, so deadline alarms fire on time even when
-- nobody is using the site. Applied by scripts/setup-cron.sh, which fills in the two settings.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'uproar-tick';

select cron.schedule(
  'uproar-tick',
  '* * * * *',
  format(
    $job$select net.http_post(url := %L, headers := jsonb_build_object('authorization', %L), timeout_milliseconds := 55000)$job$,
    current_setting('uproar.tick_url'),
    'Bearer ' || current_setting('uproar.cron_secret')
  )
);
