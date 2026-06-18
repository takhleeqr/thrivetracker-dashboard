# Background Alerts Cron Setup

This makes Late, No Show, stale heartbeat, crash, and low-activity alerts update even when no manager has the dashboard open.

## What Was Added

- `web-dashboard/src/app/api/alerts/recalculate/route.ts` recalculates alerts and stores them in `dashboard_alerts`.
- `supabase/migrations/004_dashboard_alerts.sql` creates the persisted alerts table.
- `CRON_SECRET` protects the endpoint from public use.

## One-Time Setup

1. In Supabase SQL Editor, run:
   - `supabase/migrations/004_dashboard_alerts.sql`
2. In Vercel project settings, add these Production environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=screenshots`
   - `CRON_SECRET`
3. Redeploy the production dashboard.
4. Create a cron-job.org job that calls the alert endpoint every 5 minutes.

## cron-job.org Setup

1. Open `https://cron-job.org`.
2. Create a free account or log in.
3. Click `Create cronjob`.
4. Use this URL:

```text
https://your-vercel-domain.vercel.app/api/alerts/recalculate
```

5. Set schedule to every `5 minutes`.
6. Set method to `GET`.
7. Add this request header:

```text
Authorization: Bearer your-cron-secret
```

8. Save the cron job.
9. Run it once manually from cron-job.org to confirm it returns success.

## Manual Test

After deployment, open PowerShell and run:

```powershell
$secret = "your-cron-secret"
Invoke-RestMethod -Uri "https://your-vercel-domain.vercel.app/api/alerts/recalculate" -Headers @{Authorization="Bearer $secret"}
```

Expected result:

```json
{
  "ok": true,
  "activeAlerts": 0,
  "timezone": "Asia/Karachi"
}
```

`activeAlerts` can be more than `0` if someone is late, no-show, has low activity, or has a stale/crashed timer.

## Notes

- Vercel Hobby plan does not support the cron schedule we need.
- `web-dashboard/vercel.json` intentionally does not contain a `crons` section.
- cron-job.org will call the protected endpoint every 5 minutes.
- Keep `CRON_SECRET` private.
