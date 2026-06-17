# Background Alerts Cron Setup

This makes Late, No Show, stale heartbeat, crash, and low-activity alerts update even when no manager has the dashboard open.

## What Was Added

- `web-dashboard/vercel.json` schedules `/api/alerts/recalculate` every 5 minutes.
- `web-dashboard/src/app/api/alerts/recalculate/route.ts` recalculates alerts and stores them in `dashboard_alerts`.
- `supabase/migrations/004_dashboard_alerts.sql` creates the persisted alerts table.

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

- Vercel Cron only runs on production deployments.
- The route also accepts Vercel's production cron request automatically.
- The `CRON_SECRET` is still useful for manual tests and external schedulers.
