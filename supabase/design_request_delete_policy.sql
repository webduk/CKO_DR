-- Allow deleting design requests from the app.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- The design_requests table has RLS enabled with read/insert/update policies
-- for the anon key (the app uses the anon key). Deleting a request is silently
-- blocked while no DELETE policy exists, which the app reports as "Delete was
-- blocked by the database (no row removed)". This adds it. Tighten this if/when
-- you add authentication.
--
-- Attachment and installation-spec rows are removed automatically: their
-- foreign keys to design_requests(id) are ON DELETE CASCADE. The app removes
-- the Storage objects before deleting, since those are not cascaded.

create policy "anon delete design requests"
  on public.design_requests for delete using (true);

-- Make PostgREST aware of the policy change immediately.
notify pgrst, 'reload schema';
