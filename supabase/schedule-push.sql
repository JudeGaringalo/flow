-- OPTIONAL Web Push retry schedule. This invokes Next.js on Vercel, NOT Deno.
-- 1. Enable Supabase Cron (pg_cron), pg_net and Vault.
-- 2. In Dashboard > Vault create/update (never commit real secrets):
--    flow_app_origin = https://YOUR-PRODUCTION-APP.vercel.app (no trailing slash)
--    flow_push_worker_secret = the Vercel PUSH_WORKER_SECRET (32+ random chars)
--    For protected deployments, optional: flow_vercel_automation_bypass
--      = Vercel's protection-bypass automation secret.
-- 3. Run after production deploy and manual endpoint verification.
-- No Vercel Cron dependency: Hobby's daily-only cron is unsuitable for this retry.

-- Stop the old Edge Function retry schedule, retaining all existing queue data.
do $$
declare
  j record;
begin
  for j in
    select jobid
    from cron.job
    where jobname in ('flow-push-dispatch', 'flow-housekeeping')
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end
$$;

select cron.schedule('flow-push-dispatch', '* * * * *', $$
  select net.http_post(
      url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='flow_app_origin'),
        '/') || '/api/push-dispatch',
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name='flow_push_worker_secret')
      ) || case when exists(select 1 from vault.decrypted_secrets where name='flow_vercel_automation_bypass')
        then
          jsonb_build_object('x-vercel-protection-bypass', (select decrypted_secret from vault.decrypted_secrets
            where name='flow_vercel_automation_bypass'))
          else '{}'::jsonb end,
      body := '{}'::jsonb,
      timeout_milliseconds := 45000
  ) where exists(select 1 from vault.decrypted_secrets where name='flow_app_origin')
      and exists(select 1 from vault.decrypted_secrets where name='flow_push_worker_secret');
$$);

-- Operational retention only. Sensor observation history is NOT deleted.
select cron.schedule('flow-housekeeping', '17 3 * * *', $$
  delete from public.flow_ai_cache where expires_at < now()-interval '1 day';
  delete from public.flow_receipts where created_at < now()-interval '2 days';
  delete from public.flow_rate_limits where starts_at < now()-interval '1 day';
  update public.flow_push_jobs set state='failed', last_error='Attempt limit reached', leased_until=null
    where state='running' and leased_until<now() and attempts>=5;
  delete from public.flow_push_jobs where state in ('sent', 'skipped', 'failed') and created_at<now()-interval
    '7 days';
$$);

-- Inspect cron.job_run_details for scheduling errors AND net._http_response for
-- HTTP errors. A successful cron invocation alone does not prove push delivery.
