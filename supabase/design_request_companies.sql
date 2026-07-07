-- Tag a design request with one or more of the widget companies (ARW, MESO,
-- WPA). Run this in the Supabase SQL editor (or via the Supabase CLI).
--
-- These drive the ARW / MESO / WPA count widgets on the home page: each widget
-- shows how many active design requests have that box ticked. Multiple boxes
-- may be ticked on a single request, so they are independent booleans rather
-- than a single company_id. New rows default to false (unticked).

alter table public.design_requests
  add column if not exists arw  boolean not null default false,
  add column if not exists meso boolean not null default false,
  add column if not exists wpa  boolean not null default false;

-- Backfill from the previous single company link so existing widget counts
-- carry over to the new checkboxes. Matches the company by name → id. Wrapped
-- so the migration still succeeds if the Companies table or company_id column
-- is absent (nothing to backfill in that case).
do $$
begin
  update public.design_requests d
    set arw = true
    where d.company_id = (select id from public."Companies" where "Name" = 'ARW');
  update public.design_requests d
    set meso = true
    where d.company_id = (select id from public."Companies" where "Name" = 'MESO');
  update public.design_requests d
    set wpa = true
    where d.company_id = (select id from public."Companies" where "Name" = 'WPA');
exception
  when undefined_table or undefined_column then
    raise notice 'Skipped backfill: Companies table or company_id column not found.';
end $$;

-- Make PostgREST aware of the new columns immediately.
notify pgrst, 'reload schema';
