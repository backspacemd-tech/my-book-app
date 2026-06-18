-- BookMe — Storage buckets + access policies.
-- Run in the Supabase SQL Editor AFTER schema.sql.
-- Idempotent: safe to re-run.

-- 1) The 3 public buckets the app uploads to.
insert into storage.buckets (id, name, public)
values ('avatars','avatars',true),
       ('services','services',true),
       ('portfolio','portfolio',true)
on conflict (id) do update set public = excluded.public;

-- 2) Public read — images are displayed via public URLs.
drop policy if exists "bookme storage read" on storage.objects;
create policy "bookme storage read" on storage.objects
  for select using (bucket_id in ('avatars','services','portfolio'));

-- 3) A logged-in user may write ONLY inside their own folder ({user_id}/...).
drop policy if exists "bookme storage insert" on storage.objects;
create policy "bookme storage insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('avatars','services','portfolio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "bookme storage update" on storage.objects;
create policy "bookme storage update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('avatars','services','portfolio')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('avatars','services','portfolio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "bookme storage delete" on storage.objects;
create policy "bookme storage delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('avatars','services','portfolio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
