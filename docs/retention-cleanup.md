# Screenshot Retention Cleanup

ThriveTracker stores screenshot metadata in Supabase Postgres and screenshot files in the private Supabase Storage bucket.

The setting `data_retention_days` controls how old screenshots may be before cleanup deletes them.

## Current Decision

- Cleanup runs as a local admin script.
- The script uses the Supabase service role key from `.env`.
- The script deletes old Storage objects first, then deletes matching rows from `public.screenshots`.
- The script never deletes current-day screenshots.
- The script defaults to dry-run mode so you can preview what would be deleted.

## Why Local Script First

This is the safest choice for the test project:

- No extra hosting or cron setup is required.
- The owner can run it manually.
- It avoids adding dangerous delete buttons to the dashboard too early.
- Later, the same logic can be moved into a scheduled job.

## Run A Dry Run

From the project root:

```cmd
cd "C:\Users\NABEEL KAMBOH\Documents\ThriveTracker"
"desktop-agent\.venv\Scripts\python.exe" scripts\cleanup_old_screenshots.py --dry-run
```

Dry run prints what would be deleted but does not delete anything.

## Actually Delete Old Screenshots

Only run this after checking the dry-run output:

```cmd
cd "C:\Users\NABEEL KAMBOH\Documents\ThriveTracker"
"desktop-agent\.venv\Scripts\python.exe" scripts\cleanup_old_screenshots.py --execute
```

## Override Retention Days

Use this if you want to test with a custom retention window:

```cmd
"desktop-agent\.venv\Scripts\python.exe" scripts\cleanup_old_screenshots.py --days 30 --dry-run
```

## Safety Rules

- Keep `.env` private because it contains the service role key.
- Always run dry-run first.
- Never set retention to `0`.
- Do not run cleanup while debugging today’s screenshot uploads.
- If storage deletion fails, metadata deletion is skipped for those files.
