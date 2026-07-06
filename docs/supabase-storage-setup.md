# Supabase Storage Setup

Screenshots are stored in Supabase Storage.

## Bucket Setup

1. Open your Supabase project.
2. Go to `Storage`.
3. Create a bucket named `screenshots`.
4. Keep the bucket private.
5. Run `supabase/storage/001_screenshots_bucket_policies.sql` in the Supabase SQL Editor.
6. Confirm `.env` contains:

```text
SUPABASE_STORAGE_BUCKET=screenshots
```

## Separate Bucket For Desktop App Downloads

Do not use the private `screenshots` bucket for app updates.

Create a second bucket for installer files only:

1. In each company's Supabase project, go to `Storage`.
2. Create a bucket named `desktop-downloads`.
3. Make this bucket public.
4. Inside it, create a folder for that company's app:
   - `ThriveTracker`
   - `MagikTracker`
5. Upload only installer files there, for example:

```text
ThriveTracker/ThriveTracker-Setup-v1.6.exe
MagikTracker/MagikTracker-Setup-v1.6.exe
```

6. Copy the public file URL.
7. Paste that URL into the matching dashboard `Settings` page under `Update download URL`.

Keep screenshots and installers separate:

- `screenshots` bucket: private, screenshot files only
- `desktop-downloads` bucket: public, installer files only

## Screenshot Path Format

Use this object path format:

```text
{user_id}/{YYYY-MM-DD}/{HH-MM-SS}.jpg
```

Example:

```text
00000000-0000-0000-0000-000000000000/2026-06-16/09-30-00.jpg
```

## Upload Flow

1. Desktop agent signs in with Supabase Auth.
2. Desktop agent uploads the JPEG to the private `screenshots` bucket.
3. Desktop agent inserts a row into `public.screenshots`.
4. `storage_key` stores the object path.
5. Dashboard creates signed URLs when admins view screenshots.

## Smoke Test

After Python dependencies are installed, run:

```powershell
python scripts/supabase_storage_smoke_test.py
```

The script uploads a tiny JPEG, verifies it can list the uploaded object, then removes it unless `--keep` is used.
