# ThriveTracker Desktop Agent

Windows desktop tracker for VAs.

## What It Does

- Signs VAs in with Supabase Auth.
- Installs itself into `%LOCALAPPDATA%\\Programs\\ThriveTracker` on first packaged run.
- Shows only the projects assigned to that VA.
- Starts and stops tracked work sessions.
- Captures screenshots and minute-level activity while tracking.
- Queues failed sync work locally and retries it later.
- Stops unreliable tracked time on idle, connection loss, sleep, activity-monitor failure, or app-close recovery.
- Restores the last session safely after restart when recovery is valid.
- Shows tray states for tracking, paused, stopped, and attention-needed cases.
- Lets the VA log out from the main window or the tray menu.

## Run Locally

Install Python 3.11 or newer, then run:

```powershell
cd desktop-agent
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe agent.py
```

For fast local idle testing, temporarily set this in the project `.env`:

```text
IDLE_TIMEOUT_MINUTES=1
```

## Reliability Notes

- The agent writes a local SQLite replay queue for failed stop events, screenshots, and activity logs.
- Screenshot retries are skipped after repeated dead-file failures so payroll-critical stop/activity items do not stay blocked behind them forever.
- Automatic stop flows now persist enough local state to recover cleanly after a crash during idle pause, connection-loss stop, sleep stop, or app-close stop.
- Heartbeats include health data so the dashboard can alert on screenshot failures, queue backlog, and restart loops.
- Login failures, saved-session failures, version info, and force-sign-in events are now recorded for later admin review when the agent can authenticate again.
- The desktop UI shows the agent version, and admins can require a minimum desktop version from dashboard settings.
- When the dashboard provides a direct installer download URL, installed agents can update themselves automatically.

## Runtime Files

The app creates local user files automatically under `%APPDATA%\\ThriveTracker`:

```text
config.json
session-state.json
instance.lock
queue\offline_queue.sqlite3
logs\
temp\
```

## Build Raw App EXE

Create the icon once:

```powershell
.\.venv\Scripts\python.exe scripts\create_icon.py
```

Build the app:

```powershell
.\.venv\Scripts\python.exe -m PyInstaller ThriveTracker.spec --clean --noconfirm
```

The output file will be:

```text
desktop-agent\dist\ThriveTracker.exe
```

This raw EXE is the internal app artifact used by the installer build.

## Build The Real Windows Installer

Use the company build scripts:

```powershell
.\build-thrivetracker.ps1
.\build-magiktracker.ps1
```

The user-facing files are:

```text
D:\programming\VaTrackers\ThriveTracker\ThriveTracker-Setup-vX.Y.exe
D:\programming\VaTrackers\MagikTracker\MagikTracker-Setup-vX.Y.exe
```

Give VAs the `Setup.exe`, not the raw `dist\ThriveTracker.exe`.

## Before Shipping To VAs

- Run the production verification checklist in `docs/production-verification-checklist.md`.
- Set `desktop_update_download_url` in dashboard settings to a direct public link for the latest `Setup.exe` if you want in-app updates.
- Test idle pause, restart recovery, connection-loss stop, and sleep detection with the installed app.
- Confirm the tray `Logout` action returns the agent to the login screen and clears saved session state.
- Verify the dashboard shows the agent version and recent agent events after a successful sign-in.
- Verify the first run installs the app into `%LOCALAPPDATA%\\Programs\\ThriveTracker` and the Start Menu shortcut opens the installed copy.
- Verify `Update Now` downloads the latest installer, closes the app, updates it, and relaunches the new installed build.
