-- Add a "NEW LEAD" flag to accounts.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- New rows default to false; existing rows are backfilled to false. Idempotent:
-- safe to run more than once.

alter table public.accounts
  add column if not exists new_lead boolean not null default false;

-- Make PostgREST aware of the new column immediately.
notify pgrst, 'reload schema';
