# ThriveTracker Production Deployment Guide

Use this when you are ready to move from local testing to a real hosted dashboard.

## Before You Start

Make sure these are done first:

- Supabase project exists.
- `screenshots` Storage bucket exists and is private.
- Desktop app can write `time_entries`, `activity_logs`, and screenshots locally.
- Web dashboard builds locally with `npm run build`.

## Step 1: Run Latest Supabase SQL

Open Supabase Dashboard:

1. Go to your project.
2. Open `SQL Editor`.
3. Run these files in order if you have not already run them:
   - `supabase/migrations/003_payroll_schedule_alert_settings.sql`
   - `supabase/migrations/004_dashboard_alerts.sql`
4. Confirm both finish without red errors.

Do not rerun or edit `supabase/migrations/001_initial_schema.sql` unless you are creating a fresh database.

## Step 2: Confirm Supabase Auth Settings

Open Supabase Dashboard:

1. Go to `Authentication`.
2. Open `Settings`.
3. Find JWT expiry.
4. Set it to `604800`.
5. Save.

This is one week. The desktop app also refreshes tokens, but this makes overnight sessions safer.

## Step 3: Prepare Vercel

Open Vercel:

1. Go to `https://vercel.com`.
2. Create or open your account.
3. Import the ThriveTracker project from GitHub, or deploy it manually if you are not using GitHub.
4. Set the project root directory to:

```text
web-dashboard
```

Use these build settings:

```text
Framework Preset: Next.js
Install Command: npm install
Build Command: npm run build
Output Directory: leave blank/default
```

## Step 4: Add Vercel Environment Variables

In Vercel:

1. Open your project.
2. Go to `Settings`.
3. Go to `Environment Variables`.
4. Add these for `Production`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=screenshots
CRON_SECRET=make-a-long-random-secret
```

Important:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe for the browser.
- `SUPABASE_SERVICE_ROLE_KEY` must stay secret.
- `CRON_SECRET` can be any long random text. Save it somewhere private.

## Step 5: Deploy The Dashboard

In Vercel:

1. Click `Deploy`.
2. Wait for the build to finish.
3. Open the production URL.
4. Log in with your admin account.

If the dashboard opens but data is missing, check:

- Vercel environment variables are correct.
- Supabase migrations are run.
- Admin user has `role = 'admin'` in `profiles`.

## Step 6: Confirm Background Alerts Cron

We are using `cron-job.org`, not Vercel Cron, because Vercel Hobby can block deployments with cron schedules.

Create a cron-job.org job that calls:

```text
/api/alerts/recalculate
```

every 5 minutes.

Use full URL:

```text
https://your-vercel-domain.vercel.app/api/alerts/recalculate
```

Add this request header:

```text
Authorization: Bearer your-cron-secret
```

Manual test from PowerShell:

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

`activeAlerts` can be more than `0` if a VA is late, no-show, stale, crashed, or low activity.

## Step 7: Build Desktop Agent For Production

On your Windows machine:

```cmd
cd "C:\Users\NABEEL KAMBOH\Documents\ThriveTracker\desktop-agent"
".venv\Scripts\python.exe" -m PyInstaller ThriveTracker.spec --clean --noconfirm
```

The `.exe` will be created under:

```text
desktop-agent\dist
```

Before giving it to VAs, test it yourself:

1. Open the `.exe`.
2. Log in as a VA.
3. Start timer.
4. Wait for activity and screenshots.
5. Stop timer.
6. Confirm the production dashboard updates.

## Step 8: Give VAs The App

For each VA:

1. Create their account from the Team page.
2. Assign them only their projects.
3. Set hourly rate, expected weekly hours, and working days.
4. Send them the `.exe`.
5. Give them their email and password.
6. Tell them to start/stop the tracker during work only.

## Step 9: What To Check Daily

Managers should check:

- Overview page for `Needs Attention`.
- VA Detail page for screenshots, apps, timeline, and breaks.
- Reports page for payroll and Excel exports.
- Team page for active/inactive VAs and expected hours.
- Settings page for timezone, thresholds, and unproductive apps.

## If Something Breaks

Check in this order:

1. Is Supabase online?
2. Is Vercel deployment successful?
3. Are Vercel environment variables correct?
4. Did the desktop app queue grow?
5. Did the VA token expire or fail to refresh?
6. Are screenshots being uploaded to Supabase Storage?
7. Did the alert cron run recently?
