# ThriveTracker Desktop Agent

Windows desktop agent for VA time tracking.

## Current Status

Chunk 3.1 scaffold is in place:

- App entry point
- Dependency list
- Runtime directory setup
- Local config loader
- Logging setup
- Light-theme tkinter login
- Supabase Auth for VA users
- Assigned project dropdown
- Start/stop timer with Supabase time entries
- Local screenshot capture while tracking

## Run Locally

Install Python 3.11 or newer, then run:

```powershell
cd desktop-agent
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe agent.py
```

For quick idle testing, temporarily set this in the project `.env`:

```text
IDLE_TIMEOUT_MINUTES=1
```

## Runtime Files

The app creates local user folders automatically:

```text
%APPDATA%\ThriveTracker\config.json
%APPDATA%\ThriveTracker\queue\
%APPDATA%\ThriveTracker\logs\
%APPDATA%\ThriveTracker\temp\
```

## Next Chunk

Chunk 3.9 will add the offline SQLite queue for failed uploads.

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
