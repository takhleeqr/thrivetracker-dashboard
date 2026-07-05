# ThriveTracker Build Checklist

This is the working implementation plan for the VA time tracking and monitoring system. Keep this file updated as work is completed. When a task is finished, change `[ ]` to `[x]` and add notes if anything important changed.

## Product Direction

- [x] Read `plan.txt` and extract the core scope.
- [x] Create this project checklist as the shared implementation tracker.
- [x] Build a two-part product: Windows desktop agent for VAs and web dashboard for admins.
- [ ] Use one standalone deployment per company: separate Supabase project, separate Storage bucket/config, separate dashboard deployment.
- [x] Keep all UI light theme only. Do not build dark mode.
- [x] Use a modern, quiet, operational design style: clear hierarchy, compact information density, restrained colors, and no generic AI-looking gradients/orbs/oversized marketing sections.
- [x] Build desktop agent features one at a time: login, projects/timer, screenshots, activity, idle detection, offline queue, settings sync, tray, packaging.

## Global Technical Decisions

- [x] Desktop runtime: Python 3.11+.
- [x] Desktop UI: `tkinter`, light theme, small and functional.
- [x] Desktop packaging: PyInstaller `.exe`.
- [x] Screenshot capture: `mss`.
- [x] Image processing: Pillow JPEG compression.
- [x] Keyboard/mouse activity: `pynput`, counts only, never key contents.
- [x] Active window title: `pygetwindow`.
- [x] API calls: `httpx` or `requests`.
- [x] Local offline queue: SQLite.
- [x] Backend/database/auth: Supabase PostgreSQL, Auth, REST API, RLS.
- [x] Screenshot storage: Supabase Storage private bucket named `screenshots`.
- [x] Web dashboard hosting decision: Next.js on Vercel unless a traditional backend server becomes necessary.
- [ ] Dashboard charts: Recharts or Chart.js.
- [x] Dashboard UI: light theme, responsive desktop/tablet, clean admin-console style.

## Required Environment Variables

- [x] `NEXT_PUBLIC_SUPABASE_URL`
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [x] `SUPABASE_SERVICE_ROLE_KEY`
- [x] `SUPABASE_STORAGE_BUCKET`
- [x] `APP_COMPANY_NAME`
- [x] `APP_TIMEZONE`

## Phase 1: Supabase Setup

Goal: create the database, auth foundation, security rules, and verification scripts before building app features.

### Chunk 1.1: Supabase Project Setup

- [x] Create a new Supabase project for the first company.
- [x] Save project URL, anon key, and service role key in a local `.env` file.
- [x] Add `.env.example` with placeholder values.
- [x] Confirm project timezone decision, defaulting to the company timezone in `settings`.
- [x] Enable email/password auth in Supabase Auth.
- [x] Decide whether email confirmation is required for VA accounts.
- [x] Create the first admin user in Supabase Auth.
- [x] Add a matching admin row in `public.profiles`.
- [x] Document the manual Supabase project creation steps.

Done when: one Supabase project exists, credentials are available locally, and the admin can sign in through Supabase Auth.

### Chunk 1.2: Database Schema Migration

- [x] Create a `supabase/migrations` folder.
- [x] Add the initial SQL migration for all required tables.
- [x] Create `profiles` table linked to `auth.users`.
- [x] Create `projects` table.
- [x] Create `project_assignments` table with unique `user_id, project_id`.
- [x] Create `time_entries` table.
- [x] Create `activity_logs` table.
- [x] Create `screenshots` table.
- [x] Create `settings` table.
- [x] Add sensible indexes for dashboard queries.
- [x] Add `updated_at` trigger helper and triggers where useful.
- [x] Seed default settings.
- [x] Add constraints for roles, stop reasons, and safe numeric settings where useful.

Done when: the migration can run on a fresh Supabase project without errors.

### Chunk 1.3: Row Level Security

- [x] Enable RLS on all public tables.
- [x] Admins can read and write all rows.
- [x] VAs can read only their own profile.
- [x] VAs can read only projects assigned to them.
- [x] VAs can create their own time entries.
- [x] VAs can update only their own active time entries when stopping/pausing.
- [x] VAs can insert only their own activity logs.
- [x] VAs can insert only their own screenshot metadata.
- [x] VAs cannot read other VA time entries, activity logs, or screenshots.
- [x] VAs can read settings needed by the desktop agent.
- [x] Service role can perform admin-only user management from trusted backend code.
- [x] Add policy documentation explaining each policy group.

Done when: SQL tests confirm admin access works and VA isolation works.

### Chunk 1.4: Auth/Profile Automation

- [x] Add a trigger or documented flow to create `profiles` rows for new auth users.
- [x] Ensure default role is safe, preferably `va`.
- [x] Ensure admin profile creation is explicit.
- [x] Define how password reset will work for team management.
- [x] Define how deactivation works: `profiles.is_active = false`.
- [x] Block inactive users at dashboard/agent login after auth succeeds.

Done when: new VA accounts consistently get profile rows and inactive users cannot use the product.

### Chunk 1.5: Supabase Verification

- [x] Add seed/test data instructions for one admin, two VAs, and two projects.
- [x] Add SQL verification queries for dashboard totals.
- [x] Add RLS verification notes for admin versus VA sessions.
- [ ] Test project assignment visibility.
- [ ] Test time entry insert/update flow.
- [ ] Test activity log insert flow.
- [ ] Test screenshot metadata insert flow.
- [x] Document any Supabase dashboard steps that cannot be automated locally.

Done when: the schema, auth, and policies are proven before desktop/dashboard coding starts.

## Phase 2: Supabase Storage Setup

Goal: create private screenshot storage and prove the desktop agent can upload screenshots and the dashboard can view them securely.

### Chunk 2.1: Storage Bucket Setup

- [x] Create Supabase Storage bucket named `screenshots`.
- [x] Keep the bucket private by default.
- [x] Add Supabase Storage bucket policy SQL.
- [x] Save bucket name in `.env`.
- [x] Document the manual Supabase Storage setup steps.

Done when: the bucket exists and the bucket name is stored locally without committing secrets.

### Chunk 2.2: Storage Key Convention

- [x] Use screenshot path format `{user_id}/{YYYY-MM-DD}/{HH-MM-SS}.jpg`.
- [x] Use UTC timestamps in storage keys unless company timezone is explicitly required.
- [x] Store original capture timestamp in Supabase `screenshots.captured_at`.
- [x] Store `storage_key` separately from any URL.
- [x] Store file size in `file_size_bytes`.
- [x] Store activity percent at capture time.

Done when: every screenshot has a predictable private object key and matching database row.

### Chunk 2.3: Supabase Storage Upload Test Script

- [x] Add a small Python script to upload a test JPEG to Supabase Storage.
- [x] Read Supabase credentials from environment variables.
- [x] Generate or load a tiny local JPEG for testing.
- [x] Upload to the expected key format.
- [x] Confirm upload success with list operation.
- [x] Delete the test object after verification if safe.
- [x] Document the command to run the test.

Done when: a local Python script proves upload and object lookup work.

### Chunk 2.4: Secure Viewing Strategy

- [x] Choose where Supabase signed URLs are generated.
- [x] Use authenticated Supabase signed URLs without exposing service role keys.
- [x] Ensure dashboard never exposes service role keys.
- [x] Add expiration time for screenshot URLs, such as 5 to 15 minutes.
- [x] Ensure admins can request screenshots only after Supabase auth and role check.
- [x] Decide thumbnail strategy: use original JPEG first, add generated thumbnails only if performance requires it.

Done when: the dashboard has a secure design for viewing private screenshots without leaking storage credentials.

### Chunk 2.5: Retention and Cleanup

- [x] Use `settings.data_retention_days` to define retention.
- [x] Plan a cleanup job for old screenshot metadata.
- [x] Plan a cleanup job for old Supabase Storage objects.
- [x] Decide whether cleanup runs from dashboard admin route, scheduled function, or local admin script.
- [x] Log cleanup results.
- [x] Never delete current-day screenshots during cleanup.

Done when: retention behavior is documented and safe before production data exists.

## Phase 3: Desktop Agent

Goal: build the Windows agent in small, testable slices. Each chunk should produce something runnable.

### Chunk 3.1: Python App Scaffold

- [x] Create `desktop-agent` folder.
- [x] Add Python dependency file.
- [x] Add app entry point.
- [x] Add local config module.
- [x] Add structured logging.
- [x] Add app directories for config, queue, logs, and temp screenshots.
- [x] Add `.gitignore` rules for local secrets, logs, SQLite DBs, and build output.

Done when: the app starts and exits cleanly with no tracking features yet.

### Chunk 3.2: Login Feature

- [x] Build light-theme login window in `tkinter`.
- [x] Add Supabase URL field.
- [x] Add email and password fields.
- [x] Add remember-me checkbox.
- [x] Authenticate with Supabase Auth.
- [x] Store JWT/session safely in memory for the running app.
- [x] Store both access token and refresh token after login.
- [x] Silently refresh Supabase JWTs before expiry.
- [x] Retry API and Storage requests once after a `401 JWT expired` response.
- [x] Send heartbeat updates while tracking so dashboard can detect real online status.
- [x] Remember login without saving raw password: server URL, email, bucket, access token, and refresh token.
- [x] Show clean inline errors.
- [x] Reject inactive users.
- [x] Reject admin accounts in the desktop agent unless we intentionally allow testing.

Done when: a VA can sign in and reach the main app screen.

### Chunk 3.3: Main Window and Timer

- [x] Show VA name.
- [x] Fetch assigned projects.
- [x] Populate project dropdown.
- [x] Add start/stop button.
- [x] Add running timer display.
- [x] Add today's total hours.
- [x] Add status line for recording, stopped, loading, and errors.
- [x] Add minimize-to-tray button placeholder if tray is not done yet.
- [x] Create time entry on start.
- [x] Stop/update time entry on stop.
- [x] Handle app close while timer is running with `stop_reason = app_close`.

Done when: the agent can start/stop a project session and write time entries.

### Chunk 3.4: Screenshot Capture

- [x] Capture all monitors using `mss`.
- [x] Combine multi-monitor captures into one image.
- [x] Compress to JPEG with configured quality.
- [x] Calculate file size.
- [x] Save temp file locally before upload.
- [x] Capture only while timer is running.
- [x] Respect screenshot interval from settings.
- [x] Respect max screenshots per day.
- [x] Clean temp files after successful upload.

Done when: screenshots are captured locally at the configured interval while tracking.

### Chunk 3.5: Screenshot Upload

- [x] Upload JPEG to Supabase Storage with the agreed storage key.
- [x] Insert screenshot metadata into Supabase.
- [x] Link metadata to `time_entry_id` and `project_id`.
- [x] Include activity percent at capture time.
- [x] Queue failed uploads locally.
- [x] Retry queued screenshot uploads safely.

Done when: captured screenshots appear in Supabase Storage and Supabase metadata exists.

### Chunk 3.6: Activity Tracking

- [x] Count keyboard presses only, never key values.
- [x] Count mouse clicks.
- [x] Track mouse movement as a boolean signal.
- [x] Divide each minute into six 10-second slots.
- [x] Mark slots active when any input occurs.
- [x] Calculate `activity_percent`.
- [x] Reset counters every minute.
- [x] Insert one `activity_logs` row per minute while running.
- [x] Queue failed activity inserts.

Done when: the agent uploads minute-level activity logs while tracking.

### Chunk 3.7: Window/App Tracking

- [x] Read active window title using `pygetwindow`.
- [x] Extract a practical app name from the window title.
- [x] Store `active_window_title`.
- [x] Store `active_app_name`.
- [x] Handle missing permissions or empty window title gracefully.

Done when: activity logs include useful window/app context.

### Chunk 3.8: Idle Detection

- [x] Track last keyboard or mouse input time.
- [x] Read idle timeout from local config/env.
- [x] Auto-pause after configured idle timeout.
- [x] Stop screenshots while idle.
- [x] Update time entry with `stop_reason = idle`.
- [x] Show resume prompt after idle pause.
- [x] Create a new time entry if VA resumes.
- [x] Keep timer stopped if VA declines resume.
- [x] Keep idle-stop durable if the internet drops or the app closes mid-pause.

Done when: idle time is not counted as active tracked time.

### Chunk 3.9: Offline Queue

- [x] Create local SQLite queue database.
- [x] Queue failed time entry stop/app-close operations.
- [x] Queue failed activity log operations.
- [x] Queue failed screenshot upload and metadata operations.
- [x] Keep screenshot files available until upload succeeds.
- [x] Retry oldest-first every 30 seconds.
- [x] Delete queue rows only after confirmed success.
- [x] Add basic queue status in UI and logs.
- [x] Confirm retry replay includes stop events, activity logs, and screenshots.
- [x] Skip repeated dead screenshot retries so stop/activity items behind them can still replay.

Done when: the agent can continue working offline and sync later.

### Chunk 3.10: Settings Sync

- [x] Fetch settings after login.
- [x] Fetch settings every 15 minutes.
- [x] Apply screenshot interval.
- [x] Apply JPEG quality.
- [x] Apply idle timeout.
- [ ] Apply low activity threshold if used locally.
- [x] Apply max screenshots per day.
- [x] Apply connection-loss grace from admin settings.
- [x] Apply fixed-shift reminder delay from admin settings.
- [x] Keep using last synced settings if a settings refresh fails.

Done when: admin settings can change agent behavior without reinstalling.

### Chunk 3.11: System Tray

- [x] Add tray icon using `pystray`.
- [x] Add menu items: Start/Stop, Show Window, Logout, Quit.
- [x] Keep tracking while window is minimized.
- [x] Make quit behavior safe when timer is running.
- [x] Restore window cleanly from tray.
- [x] Show tray state for tracking, paused, stopped, and attention-needed states.

Done when: the agent behaves like a normal background time tracker.

### Chunk 3.12: Packaging

- [x] Add PyInstaller spec or build command.
- [x] Add app icon.
- [x] Build `ThriveTracker.exe`.
- [ ] Test on a clean Windows machine or clean Windows user profile.
- [x] Configure PyInstaller windowed build so no console window appears.
- [ ] Confirm credentials/config persist after restart.
- [x] Document the VA install/run steps.

Done when: a VA can download and run the `.exe` without Python installed.

## Phase 4: Web Dashboard

Goal: build the admin dashboard after Supabase foundations and agent data flows are working.

### Chunk 4.1: Dashboard Scaffold

- [x] Create Next.js app.
- [x] Add Supabase JS client.
- [x] Add app routes/layout.
- [x] Add light theme design tokens.
- [x] Add font.
- [x] Add base components: button, input, select, table, tabs, modal, toast.
- [x] Keep cards compact with radius 8px or less.
- [x] Avoid decorative gradients, orbs, and generic AI-style hero layouts.

Done when: the app shell is running with the intended light visual language.

### Chunk 4.2: Admin Auth

- [x] Create login page.
- [x] Authenticate with Supabase.
- [x] Load user profile.
- [x] Allow only `role = admin`.
- [x] Show clear error for VA users.
- [x] Add logout.
- [x] Protect dashboard route client-side.

Done when: only admins can use the dashboard.

### Chunk 4.3: Overview Dashboard

- [x] Show total hours today.
- [x] Show VAs online now.
- [x] Show average activity.
- [x] Show live actionable alert count and alert cards.
- [x] Show VA status table.
- [x] Use `profiles.last_seen_at` heartbeat freshness for online/offline status.
- [x] Auto-close stale open time entries as `stop_reason = crash`.
- [x] Include current project.
- [x] Include hours today.
- [x] Include rolling activity.
- [x] Include last screenshot thumbnail.
- [x] Link each VA to detail view.
- [x] Show `Sync Delayed` instead of incorrectly marking working VAs fully offline during short sync gaps.
- [x] Surface screenshot-sync, queue-backlog, and restart-loop health alerts.

Done when: admin can see current team status at a glance.

### Chunk 4.4: VA Detail View

- [x] Add route `/va/[id]`.
- [x] Show VA header stats.
- [x] Add Today tab.
- [x] Add Week tab.
- [x] Add Month tab.
- [x] Add Custom Range tab.
- [x] Build timeline bar.
- [x] Build screenshot gallery.
- [x] Add individual screenshot download from the VA detail gallery.
- [x] Add break-time detection between work sessions.
- [x] Add daily productivity score.
- [x] Build activity chart.
- [x] Build app usage section.
- [x] Build time entries table.
- [x] Add next/previous screenshot navigation inside the lightbox.
- [x] Close screenshot lightbox when clicking outside the image.

Done when: admin can inspect a VA's day from time, screenshots, activity, and apps.

### Chunk 4.5: Projects

- [x] Add projects route.
- [x] Add project table.
- [x] Add create project modal.
- [x] Add edit project modal.
- [x] Add color picker.
- [x] Add VA assignment multi-select.
- [x] Add delete/deactivate behavior.
- [x] Show total hours and last activity.
- [x] Clear VA assignments when a project is deactivated.

Done when: admin can manage projects and assignments.

### Chunk 4.6: Screenshots Browser

- [x] Add screenshots route.
- [x] Add filters for VA, project, date/range, and time range.
- [x] Add responsive thumbnail grid.
- [x] Add screenshot metadata on thumbnails.
- [x] Add lightbox/modal for full-size view.
- [x] Add individual full-resolution screenshot download from the lightbox.
- [x] Add pagination or load more.
- [x] Use secure presigned URLs.

Done when: admin can search and review screenshots quickly.

### Chunk 4.7: Reports

- [x] Add time report.
- [x] Add activity report.
- [x] Add app usage report.
- [x] Add attendance report.
- [x] Add project report.
- [x] Add filters for date range, project, and VA.
- [x] Add formatted Excel `.xlsx` export.

Done when: admin can export usable reports.

### Chunk 4.8: Team Management

- [x] Add team route.
- [x] Add VA create modal.
- [x] Create Supabase auth user through trusted server-side route.
- [x] Create/update profile rows.
- [x] Assign projects.
- [x] Reset password.
- [x] Deactivate user.
- [x] Show status, last seen, and weekly total hours.
- [x] Show inactive project assignments clearly if legacy rows still exist.

Done when: admin can manage VA accounts from the dashboard.

### Chunk 4.9: Settings

- [x] Add settings route.
- [x] Add screenshot interval input.
- [x] Add screenshot quality slider.
- [x] Add idle timeout input.
- [x] Add low activity threshold input.
- [x] Add retention days input.
- [x] Add work start/end time inputs.
- [x] Add max screenshots per day input.
- [x] Add timezone dropdown.
- [x] Save to Supabase `settings`.
- [x] Add connection-loss grace input.
- [x] Add queue/screenshot/restart health alert inputs.
- [x] Add fixed-shift reminder delay input.

Done when: admin settings are saved and picked up by the desktop agent.

## Phase 5: Testing, Deployment, and Polish

### Chunk 5.1: End-to-End Testing

- [ ] Test with one admin and two VA users.
- [ ] Test simultaneous tracking.
- [ ] Test screenshots every configured interval.
- [ ] Test activity logs every minute.
- [ ] Test idle pause/resume.
- [ ] Test offline queue by disabling internet.
- [ ] Test dashboard filters and reports.
- [ ] Test RLS with VA credentials.

Done when: core flows work with realistic users and data.

### Chunk 5.2: Performance and Storage

- [ ] Optimize screenshot JPEG quality.
- [ ] Confirm screenshot file sizes are acceptable.
- [ ] Confirm dashboard thumbnail loading is fast enough.
- [ ] Confirm Supabase Storage usage remains within free/low-cost expectations.
- [ ] Confirm local queue does not grow without limits.
- [ ] Add safe caps where needed.

Done when: the product is usable for real daily work.

### Chunk 5.3: Deployment

- [ ] Deploy dashboard to Vercel.
- [ ] Add production environment variables.
- [ ] Confirm Supabase URL/key setup.
- [ ] Confirm Supabase Storage access from production server routes.
- [ ] Package desktop agent with production config flow.
- [x] Create admin setup documentation.
- [x] Create VA install documentation.

Done when: first company can use the product outside the dev machine.

### Chunk 5.4: Second Company Repeatability

- [ ] Create second Supabase project.
- [ ] Create second Supabase Storage bucket or prefix strategy.
- [ ] Deploy separate dashboard instance.
- [ ] Verify no cross-company data sharing.
- [ ] Document repeatable company deployment checklist.

Done when: standalone per-company deployment is proven.

## Light Theme Design Notes

- [x] Base background: near-white, not gray-heavy.
- [x] Surfaces: white with subtle borders.
- [x] Text: strong neutral foreground with clear secondary text.
- [x] Accent: use blue sparingly for primary actions and links.
- [x] Status colors: green for online/recording, amber for idle/warning, red for stopped/error.
- [x] Navigation: compact sidebar or top nav depending on final dashboard layout.
- [x] Tables: dense, readable, sortable where useful.
- [x] Forms: clear labels, useful validation, no noisy helper text.
- [ ] Charts: restrained colors with legible axes and tooltips.
- [ ] Modals: focused workflows, no nested card layouts.
- [x] Empty states: practical next action, not marketing copy.

## Current Next Steps

- [x] Create Phase 1 SQL migration files.
- [x] Add Supabase `.env.example`.
- [x] Add RLS policy SQL.
- [x] Add Supabase verification notes.
- [x] Create Phase 2 Supabase Storage test script.
- [x] Add Supabase Storage setup documentation.
- [x] Confirm Supabase Storage bucket `screenshots` exists.
- [x] Run Supabase Storage bucket policy SQL.
- [x] Verify Python runtime is available through desktop-agent virtual environment.
- [x] Install desktop agent Python dependencies.
- [x] Run desktop agent syntax and import checks.
- [x] Run Supabase Storage upload/list/delete smoke test.
- [x] Create Phase 3.1 desktop agent scaffold.
- [x] Build Phase 3.2 login window and Supabase Auth.
- [x] Build Phase 3.3 main window and timer.
- [x] Build Phase 3.4 screenshot capture.
- [x] Build Phase 3.5 screenshot upload.
- [x] Build Phase 3.6 activity tracking.
- [x] Build Phase 3.7 window/app tracking.
- [x] Build Phase 3.8 idle detection.
- [x] Build Phase 3.9 offline queue.
- [x] Build Phase 3.10 settings sync.
- [x] Build Phase 3.11 system tray.
- [x] Build Phase 3.12 packaging.
- [x] Build Phase 4.1 dashboard scaffold.
- [x] Build Phase 4.2 admin login/auth.
- [x] Build Phase 4.3 live overview dashboard data.
- [x] Start Phase 4.4 VA detail view.
- [x] Add Phase 4.4 week/month/custom range tabs.
- [x] Build Phase 4.5 projects management.
- [x] Build Phase 4.6 screenshots browser.
- [x] Build Phase 4.7 reports.
- [x] Build Phase 4.8 team management.
- [x] Build Phase 4.9 settings.
- [x] Add manager-friendly overview filters, productivity scores, break tracking, and screenshot downloads.
- [x] Replace dashboard/report CSV downloads with Excel `.xlsx` exports.
- [x] Replace Overview alert placeholder with live actionable alert cards.
- [x] Add RLS verification guide for admin/VA security checks.
- [x] Add screenshot retention cleanup plan and local admin script.
- [x] Add clean Windows desktop-agent install test guide.
- [x] Add Chunk A migration for payroll, schedules, manual notes, alert settings, app categories, and timezone defaults.
- [x] Build Chunk D foundation: full timezone selector, alert/app settings keys, and timezone-aware dashboard date display/ranges.
- [x] Add Team payroll/schedule fields: hourly rate, expected weekly hours, and working days.
- [x] Add VA earnings, daily hours/pay view, and payroll Excel report export.
- [x] Add VA Detail manual time entry modal with manual labels in timeline/time table.
- [x] Add Overview schedule status, day-off handling, earnings today, and weekly hours progress.
- [x] Add productivity score explanations, semantic stat colors, unproductive app badges, and consecutive low-activity alerts.
- [x] Add persisted dashboard alerts table and protected background recalculation API.
- [x] Add protected background alert endpoint and cron-job.org deployment guide.
- [x] Add Team Reactivate button for inactive VAs and Overview Needs Attention filter chip.
- [x] Add production deployment guide and production verification checklist.
- [x] Fix VA Detail earnings, server-side desktop start timestamps, manual breaks, Overview ranges, chart labels, retention cleanup, and bulk screenshot deletion.
- [x] Add VA Detail live 30-second refresh range, Overview screenshot lightbox, and live settings-based alert recalculation.
- [ ] Start Phase 5.1 end-to-end testing.
