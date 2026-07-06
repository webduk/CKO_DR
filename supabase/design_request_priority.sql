-- Add a priority field to design requests.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- Values: 'critical' (urgent), 'mid' (normal) or 'low' (whenever). New rows
-- default to 'mid'; existing rows are backfilled to 'mid'.

alter table public.design_requests
  add column if not exists priority text not null default 'mid';

-- Constrain to the allowed values. Guard the constraint creation so the
-- script is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'design_requests_priority_check'
  ) then
    alter table public.design_requests
      add constraint design_requests_priority_check
        check (priority in ('critical', 'mid', 'low'));
  end if;
end $$;

create index if not exists design_requests_priority_idx
  on public.design_requests (priority);

-- Make PostgREST aware of the new column immediately.
notify pgrst, 'reload schema';
