-- Add a "pinned" flag to accounts.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- Pinned accounts float to the top of the Accounts Report page. New rows default
-- to false; existing rows are backfilled to false. Idempotent: safe to run more
-- than once.

alter table public.accounts
  add column if not exists pinned boolean not null default false;

-- Make PostgREST aware of the new column immediately.
notify pgrst, 'reload schema';
