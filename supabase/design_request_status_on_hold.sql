-- Widen the design-request status constraint to add 'on_hold'.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- The original design_request_status.sql created a CHECK constraint allowing
-- only ('active', 'closed'). That guard does not update an existing constraint,
-- so this script drops and re-adds it with 'on_hold' included. Idempotent:
-- safe to run more than once.

alter table public.design_requests
  drop constraint if exists design_requests_status_check;

alter table public.design_requests
  add constraint design_requests_status_check
    check (status in ('active', 'on_hold', 'closed'));

-- Make PostgREST aware of the change immediately.
notify pgrst, 'reload schema';
