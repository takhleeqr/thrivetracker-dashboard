# ThriveTracker Desktop Agent

Windows desktop tracker for VAs.

## What It Does

- Signs VAs in with Supabase Auth.
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

## Build EXE

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

## Before Shipping To VAs

- Run the production verification checklist in `docs/production-verification-checklist.md`.
- Test idle pause, restart recovery, connection-loss stop, and sleep detection with the actual `.exe`.
- Confirm the tray `Logout` action returns the agent to the login screen and clears saved session state.
