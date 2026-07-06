# Desktop Agent Clean Install Test

Use this before giving the `.exe` to real VAs.

## Goal

Prove that `ThriveTracker.exe` works on a clean Windows user profile without Python installed and that Remember Me survives app restart.

## Best Test Options

Use one of these:

- A second Windows computer.
- A fresh Windows user profile on this computer.
- A Windows virtual machine.

## Test Steps

1. Copy `ThriveTracker.exe` to the clean Windows test profile.
2. Double-click the `.exe`.
3. Confirm the first screen asks to install the app on this PC.
4. Click `Install now`.
5. Confirm the app closes and reopens by itself.
6. Confirm no console/black terminal window appears.
7. Sign in as a test VA.
8. Check `Remember Me`.
9. Start tracking on an assigned project.
10. Wait for at least one activity log and one screenshot.
11. Stop tracking.
12. Close the app completely.
13. Reopen the app from the Start Menu shortcut.
14. Confirm it restores the saved login without asking for password.
15. Start tracking again.
16. Confirm the dashboard shows the VA online.
17. Restart Windows.
18. Open the app again.
19. Confirm Remember Me still works.

## Expected Results

- The app opens without Python installed.
- The app installs itself into `%LOCALAPPDATA%\Programs\ThriveTracker`.
- The Start Menu shortcut opens the installed copy.
- No console window appears.
- The VA can sign in.
- Assigned projects load.
- Start/stop writes time entries.
- Activity logs write every minute while running.
- Screenshots upload to Supabase Storage.
- Queue count returns to `0` when online.
- Remember Me works after app close and Windows restart.

## If Remember Me Fails

Check this folder on the test Windows profile:

```text
%APPDATA%\ThriveTracker
```

The app should create local config, queue, log, and temp folders there.

Do not send the config file in chat if it contains tokens.
