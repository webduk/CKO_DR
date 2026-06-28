-- Setup for design-request file attachments.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
-- It creates the metadata table and the policies; the Storage bucket is created
-- separately (see the bottom of this file).

-- 1) Metadata table: one row per uploaded file, linked to its design request.
create table if not exists public.design_request_attachments (
  id                bigint generated always as identity primary key,
  design_request_id bigint not null
                      references public.design_requests (id) on delete cascade,
  file_name         text   not null,
  storage_path      text   not null,
  mime_type         text,
  size_bytes        bigint,
  created_at        timestamptz not null default now()
);

create index if not exists design_request_attachments_request_idx
  on public.design_request_attachments (design_request_id);

-- 2) Row-Level Security. The app uses the anon key, so mirror the open
--    read/write access the other tables in this project rely on. Tighten these
--    if/when you add authentication.
alter table public.design_request_attachments enable row level security;

create policy "anon read attachments"
  on public.design_request_attachments for select using (true);
create policy "anon insert attachments"
  on public.design_request_attachments for insert with check (true);
create policy "anon delete attachments"
  on public.design_request_attachments for delete using (true);

-- 3) Storage bucket + policies.
--    Easiest path: Supabase Dashboard -> Storage -> New bucket
--      name: design-request-files
--      Public bucket: ON   (so getPublicUrl download links work)
--
--    Or do it in SQL:
insert into storage.buckets (id, name, public)
values ('design-request-files', 'design-request-files', true)
on conflict (id) do nothing;

-- Allow the anon role to upload/read/delete objects in this one bucket.
create policy "anon read design-request files"
  on storage.objects for select
  using (bucket_id = 'design-request-files');

create policy "anon upload design-request files"
  on storage.objects for insert
  with check (bucket_id = 'design-request-files');

create policy "anon delete design-request files"
  on storage.objects for delete
  using (bucket_id = 'design-request-files');
