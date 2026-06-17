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
3. Confirm no console/black terminal window appears.
4. Sign in as a test VA.
5. Check `Remember Me`.
6. Start tracking on an assigned project.
7. Wait for at least one activity log and one screenshot.
8. Stop tracking.
9. Close the app completely.
10. Reopen the app.
11. Confirm it restores the saved login without asking for password.
12. Start tracking again.
13. Confirm the dashboard shows the VA online.
14. Restart Windows.
15. Open the app again.
16. Confirm Remember Me still works.

## Expected Results

- The app opens without Python installed.
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
