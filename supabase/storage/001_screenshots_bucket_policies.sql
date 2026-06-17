-- Run after creating the private Supabase Storage bucket named `screenshots`.
-- This file does not modify the already-run database schema migration.

create policy "admins_read_all_screenshot_objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'screenshots'
  and public.is_admin()
);

create policy "vas_upload_own_screenshot_objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_user()
);

create policy "vas_update_own_screenshot_objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_user()
)
with check (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_user()
);

create policy "vas_read_own_screenshot_objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_user()
);

