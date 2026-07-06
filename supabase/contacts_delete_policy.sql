-- Allow deleting contacts from the app.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- The contacts table has RLS enabled with read/insert/update policies for the
-- anon key (the app uses the anon key). Deleting a contact is silently blocked
-- while no DELETE policy exists, which the app now reports as "Delete was
-- blocked by the database (no row removed)". This adds it. Tighten this if/when
-- you add authentication.

create policy "anon delete contacts"
  on public.contacts for delete using (true);

-- Make PostgREST aware of the policy change immediately.
notify pgrst, 'reload schema';
