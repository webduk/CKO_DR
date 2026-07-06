-- Record the date a design request was closed.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- `closed_at` is set to the current date when a request's status becomes
-- 'closed' and cleared (null) when it is reopened. Existing rows stay null
-- (we don't know when they were closed). Nullable, so it is safe to re-run.

alter table public.design_requests
  add column if not exists closed_at date;

-- Make PostgREST aware of the new column immediately.
notify pgrst, 'reload schema';
