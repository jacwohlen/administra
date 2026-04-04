-- Bucket is created declaratively in supabase/config.toml.
-- This migration only sets up RLS policies for the avatars bucket.

-- Allow all authenticated users to read from the 'avatars' bucket
create policy "all read avatars"
on storage.objects for select
to authenticated
using (bucket_id = 'avatars');

-- Allow all authenticated users to upload to the 'avatars' bucket
create policy "all insert avatars"
on storage.objects for insert
to authenticated
with check (bucket_id = 'avatars');

-- Allow all authenticated users to delete from the 'avatars' bucket
create policy "all delete avatars"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars');

-- Allow all authenticated users to update/replace objects in the 'avatars' bucket
create policy "all update avatars"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars')
with check (bucket_id = 'avatars');
