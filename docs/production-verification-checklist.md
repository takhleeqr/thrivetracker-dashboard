# Production Verification Checklist

Use this after deployment. Do not skip the boring checks; boring checks catch expensive bugs.

## 1. Supabase Database

- [ ] `003_payroll_schedule_alert_settings.sql` has been run.
- [ ] `004_dashboard_alerts.sql` has been run.
- [ ] `010_connection_loss_grace_setting.sql` has been run.
- [ ] `011_schedule_stale_time_entry_cleanup.sql` has been run.
- [ ] `012_raise_connectivity_grace_default.sql` has been run.
- [ ] `013_agent_health_and_reminder_settings.sql` has been run.
- [ ] `014_cleanup_inactive_project_assignments.sql` has been run.
- [ ] `profiles` table has at least one admin.
- [ ] `profiles` table has at least one VA.
- [ ] `projects` table has at least one active project.
- [ ] `project_assignments` links the VA to the correct project only.
- [ ] `dashboard_alerts` table exists.
- [ ] `agent_health_snapshots` table exists.
- [ ] `agent_app_launch_events` table exists.

## 2. Supabase Storage

- [ ] Bucket named `screenshots` exists.
- [ ] Bucket is private.
- [ ] Storage policies have been run.
- [ ] A VA screenshot appears in the bucket after tracking.
- [ ] Dashboard can show signed screenshot previews.
- [ ] Dashboard lightbox opens screenshots without a new tab.
- [ ] VA detail lightbox can move to next and previous screenshots.
- [ ] Clicking outside the screenshot closes the lightbox.

## 3. Vercel Dashboard

- [ ] Production deployment completes successfully.
- [ ] Production URL opens.
- [ ] Admin can log in.
- [ ] Non-admin VA cannot access admin dashboard.
- [ ] Overview page loads without errors.
- [ ] Team page loads.
- [ ] VA Detail page loads.
- [ ] Screenshots page loads.
- [ ] Reports page loads.
- [ ] Settings page loads.

## 4. Vercel Environment Variables

- [ ] `NEXT_PUBLIC_SUPABASE_URL` is set.
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set.
- [ ] `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=screenshots` is set.
- [ ] `CRON_SECRET` is set.

## 5. Background Alerts

- [ ] Manual cron test returns `{ "ok": true }`.
- [ ] cron-job.org job is created and enabled.
- [ ] cron-job.org job has `Authorization: Bearer your-cron-secret` header.
- [ ] `dashboard_alerts` receives rows when alerts exist.
- [ ] Resolved alerts become inactive.
- [ ] Overview `Needs Attention` filter shows VAs with alerts.
- [ ] Health alerts appear for screenshot sync failures, queue backlog, and restart loops when expected.
- [ ] Late and No Show ignore VAs with no working days set.
- [ ] Day Off VAs show as Day Off, not Late or No Show.

Manual cron test:

```powershell
$secret = "your-cron-secret"
Invoke-RestMethod -Uri "https://your-vercel-domain.vercel.app/api/alerts/recalculate" -Headers @{Authorization="Bearer $secret"}
```

## 6. Desktop Agent

- [ ] `.exe` opens.
- [ ] VA can log in.
- [ ] Remember Me works as expected.
- [ ] VA sees only assigned projects.
- [ ] Start timer creates an open `time_entries` row.
- [ ] Stop timer closes the row.
- [ ] Idle pause stops payable time cleanly and does not leave the agent stuck.
- [ ] Connection loss stops payable time only after the configured grace period.
- [ ] Sleep/resume stops payable time cleanly instead of counting slept time.
- [ ] Restart recovery reopens only valid active sessions and finalizes pending auto-stops correctly.
- [ ] Activity logs are written.
- [ ] Screenshots upload to Supabase Storage.
- [ ] Queue drains after failed requests recover.
- [ ] Stuck screenshot retries do not block later stop/activity sync items forever.
- [ ] JWT refresh works after long idle/overnight usage.
- [ ] Heartbeat updates `last_seen_at`.
- [ ] Tray `Logout` returns to login and clears remembered session state.

## 7. Overview Page

- [ ] Total Hours Today is correct.
- [ ] Total Earnings Today is correct.
- [ ] Total Hours This Week is correct.
- [ ] VAs Online count is correct.
- [ ] Average Activity is reasonable.
- [ ] Productivity Score explanation is visible.
- [ ] `Last Screenshot` label is used.
- [ ] Status labels show Working, Sync Delayed, Idle, On Break, Offline, or Day Off correctly.
- [ ] Schedule column shows On Time, Late, No Show, Day Off, or Not Set.
- [ ] Needs Attention chip filters problem VAs.

## 8. VA Detail Page

- [ ] Timeline shows time entries clearly.
- [ ] Manual entries show a Manual badge.
- [ ] Add Manual Entry saves correctly.
- [ ] Screenshots open in the lightbox.
- [ ] Screenshot download works.
- [ ] Active apps list appears.
- [ ] Unproductive apps show red labels.
- [ ] Hours and Pay By Date shows date, hours, and payable money.
- [ ] Earnings This Week is correct.
- [ ] Earnings This Month is correct.

## 9. Reports Page

- [ ] Excel export downloads `.xlsx`.
- [ ] Time report includes earnings.
- [ ] Payroll tab shows date, VA, hours, rate, payable.
- [ ] Payroll Excel export works.
- [ ] Date filters respect dashboard timezone.
- [ ] VA filter works.
- [ ] Project filter works.

## 10. Team Page

- [ ] New VA creation works.
- [ ] Edit VA works.
- [ ] Hourly Rate saves.
- [ ] Expected Hours Per Week saves.
- [ ] Working Days save.
- [ ] Project assignments save.
- [ ] Deactivate works.
- [ ] Reactivate works.
- [ ] Inactive VAs show when `All` is selected.
- [ ] Deactivated projects no longer remain as live assignments for VAs.
- [ ] If any legacy inactive assignment still exists, it is visually marked as inactive.

## 11. Settings Page

- [ ] Timezone saves.
- [ ] Low activity threshold saves.
- [ ] Low activity duration saves.
- [ ] Late start time saves.
- [ ] Work start/end time saves.
- [ ] Connection-loss grace saves.
- [ ] Screenshot-failure, queue-backlog, restart-loop, and shift-reminder settings save.
- [ ] Unproductive app JSON saves.
- [ ] Productivity Score explanation is visible.

## 12. Final Go/No-Go

Go live only when:

- [ ] Admin can use dashboard from production URL.
- [ ] VA can track from `.exe`.
- [ ] Data appears on production dashboard.
- [ ] Screenshots appear and open.
- [ ] Reports export correctly.
- [ ] Background alerts run without manager dashboard being open.
- [ ] No test users/projects remain unless intentionally kept.
