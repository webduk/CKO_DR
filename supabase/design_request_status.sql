-- Add a real status field to design requests.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- Values: 'active' (work outstanding) or 'closed' (done/cancelled).
-- New rows default to 'active'; existing rows are backfilled to 'active'.

alter table public.design_requests
  add column if not exists status text not null default 'active';

-- Constrain to the two allowed values. Guard the constraint creation so the
-- script is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'design_requests_status_check'
  ) then
    alter table public.design_requests
      add constraint design_requests_status_check
        check (status in ('active', 'closed'));
  end if;
end $$;

create index if not exists design_requests_status_idx
  on public.design_requests (status);

-- Make PostgREST aware of the new column immediately.
notify pgrst, 'reload schema';
