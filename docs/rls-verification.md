# RLS Verification Guide

Use this guide to prove that Supabase security rules protect company data correctly.

Important: Supabase SQL Editor often runs with elevated database privileges, so it is not a perfect RLS test. The safest practical test is to sign in as real users through the app or through Supabase client/API calls.

## Accounts Needed

- One admin user with `profiles.role = 'admin'` and `profiles.is_active = true`.
- Two VA users with `profiles.role = 'va'` and `profiles.is_active = true`.
- At least two active projects.
- Assign VA One to Project A only.
- Assign VA Two to Project B only.

## Admin Tests

1. Sign in to the web dashboard as the admin.
2. Open `Overview`.
3. Confirm both VAs are visible.
4. Open `Team`.
5. Confirm the admin can create, edit, deactivate, and reactivate VAs.
6. Open `Projects`.
7. Confirm the admin can create/edit/archive projects and assign VAs.
8. Open `Reports`.
9. Confirm reports can include all VAs and all projects.
10. Open `Screenshots`.
11. Confirm screenshots for all VAs can be searched and opened.

Expected result: admin can see and manage all company data.

## VA Project Visibility Tests

1. Sign in to the desktop agent as VA One.
2. Open the project dropdown.
3. Confirm only VA One's assigned project appears.
4. Sign out.
5. Sign in to the desktop agent as VA Two.
6. Open the project dropdown.
7. Confirm only VA Two's assigned project appears.

Expected result: each VA can only see assigned projects.

## VA Time Entry Tests

1. Sign in to the desktop agent as VA One.
2. Start tracking on VA One's assigned project.
3. Confirm a new row appears in `time_entries` with `user_id = VA One`.
4. Stop tracking.
5. Confirm that same `time_entries` row gets `stopped_at`, `duration_seconds`, and `stop_reason`.
6. Repeat with VA Two.

Expected result: each VA can create and stop only their own time entries.

## VA Activity Log Tests

1. Sign in to the desktop agent as VA One.
2. Start tracking and wait at least 1 minute.
3. Confirm `activity_logs` has a row with `user_id = VA One`.
4. Sign in as VA Two and repeat.

Expected result: activity logs are inserted only for the logged-in VA.

## VA Screenshot Metadata Tests

1. Set screenshot interval low enough for testing, such as 1 minute.
2. Sign in to the desktop agent as VA One.
3. Start tracking and wait for a screenshot upload.
4. Confirm `screenshots.user_id = VA One`.
5. Confirm the `storage_key` starts with VA One's user id.
6. Repeat with VA Two.

Expected result: screenshots and storage objects are written only under the logged-in VA.

## Inactive User Tests

1. In the dashboard, deactivate a VA from `Team`.
2. Try signing into the desktop agent as that VA.
3. Try signing into the dashboard as an inactive admin, if you have a test admin.

Expected result: inactive users authenticate at Supabase but are blocked by ThriveTracker after profile check.

## What Counts As Passed

- Admin can manage all data.
- VA One cannot see VA Two's projects in the desktop app.
- VA Two cannot see VA One's projects in the desktop app.
- Time entries, activity logs, and screenshot metadata are written under the correct VA user id.
- Inactive users are blocked from both dashboard and desktop agent.
