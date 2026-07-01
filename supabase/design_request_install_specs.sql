-- Setup for completed installation specifications attached to design requests.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
-- It creates the metadata table and the policies; the Storage bucket is created
-- at the bottom of this file. Mirrors design_request_attachments.sql, but kept
-- in a separate table + bucket so installation specs are distinct from general
-- attachments.

-- 1) Metadata table: one row per uploaded installation spec, linked to its
--    design request. Deleting a design request removes its spec rows (cascade).
create table if not exists public.design_request_install_specs (
  id                bigint generated always as identity primary key,
  design_request_id bigint not null
                      references public.design_requests (id) on delete cascade,
  file_name         text   not null,
  storage_path      text   not null,
  mime_type         text,
  size_bytes        bigint,
  created_at        timestamptz not null default now()
);

create index if not exists design_request_install_specs_request_idx
  on public.design_request_install_specs (design_request_id);

-- 2) Row-Level Security. The app uses the anon key, so mirror the open
--    read/write access the other tables in this project rely on. Tighten these
--    if/when you add authentication.
alter table public.design_request_install_specs enable row level security;

create policy "anon read install specs"
  on public.design_request_install_specs for select using (true);
create policy "anon insert install specs"
  on public.design_request_install_specs for insert with check (true);
create policy "anon delete install specs"
  on public.design_request_install_specs for delete using (true);

-- 3) Storage bucket + policies.
--    Easiest path: Supabase Dashboard -> Storage -> New bucket
--      name: design-request-install-specs
--      Public bucket: ON   (so getPublicUrl download links work)
--
--    Or do it in SQL:
insert into storage.buckets (id, name, public)
values (
  'design-request-install-specs',
  'design-request-install-specs',
  true
)
on conflict (id) do nothing;

-- Allow the anon role to upload/read/delete objects in this one bucket.
create policy "anon read install-spec files"
  on storage.objects for select
  using (bucket_id = 'design-request-install-specs');

create policy "anon upload install-spec files"
  on storage.objects for insert
  with check (bucket_id = 'design-request-install-specs');

create policy "anon delete install-spec files"
  on storage.objects for delete
  using (bucket_id = 'design-request-install-specs');

-- Make PostgREST aware of the new table immediately.
notify pgrst, 'reload schema';
