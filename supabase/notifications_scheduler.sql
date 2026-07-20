-- Run this in Supabase SQL Editor after:
-- 1. Adding CRON_SECRET to Vercel.
-- 2. Replacing REPLACE_WITH_THE_SAME_CRON_SECRET below with that exact value.
--
-- Supabase Pro supports pg_cron + pg_net, allowing 10-minute notification checks
-- without relying on Vercel Hobby cron frequency limits.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Remove prior copies if this setup is run again.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'lit757-buzz-notifications'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

-- Store the endpoint and secret encrypted in Supabase Vault.
do $$
declare
  site_secret_id uuid;
  cron_secret_id uuid;
begin
  select id into site_secret_id from vault.secrets where name = 'lit757_site_url' limit 1;
  if site_secret_id is null then
    perform vault.create_secret('https://lit757.vercel.app', 'lit757_site_url', 'LIT757 production URL');
  else
    perform vault.update_secret(site_secret_id, 'https://lit757.vercel.app', 'lit757_site_url', 'LIT757 production URL');
  end if;

  select id into cron_secret_id from vault.secrets where name = 'lit757_cron_secret' limit 1;
  if cron_secret_id is null then
    perform vault.create_secret('REPLACE_WITH_THE_SAME_CRON_SECRET', 'lit757_cron_secret', 'Authorizes Buzz notification checks');
  else
    perform vault.update_secret(cron_secret_id, 'REPLACE_WITH_THE_SAME_CRON_SECRET', 'lit757_cron_secret', 'Authorizes Buzz notification checks');
  end if;
end $$;

select cron.schedule(
  'lit757-buzz-notifications',
  '*/10 * * * *',
  $schedule$
  select net.http_get(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'lit757_site_url'
      limit 1
    ) || '/api/notifications/check',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'lit757_cron_secret'
        limit 1
      )
    ),
    timeout_milliseconds := 25000
  );
  $schedule$
);

-- Verify the job exists.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'lit757-buzz-notifications';
