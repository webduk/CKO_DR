-- Allow deleting accounts from the app.
-- Run this in the Supabase SQL editor (or via the Supabase CLI) for the project.
--
-- The accounts table already has RLS enabled with read/insert/update policies
-- for the anon key (the app uses the anon key). Deleting a USI account was
-- silently blocked because no DELETE policy existed, so the app showed
-- "Delete was blocked by the database (no row removed)". This adds it.
-- Tighten this if/when you add authentication.

create policy "anon delete accounts"
  on public.accounts for delete using (true);

-- Note on linked design requests: design_requests.account_id references
-- accounts(id). With the default (no cascade) a delete is rejected while any
-- design request still points at the account — the app reports this as
-- "this account still has linked design requests. Reassign or delete those
-- first." If you would rather have those requests detached automatically when
-- an account is deleted, change the foreign key to ON DELETE SET NULL, e.g.:
--
--   alter table public.design_requests
--     drop constraint design_requests_account_id_fkey,
--     add constraint design_requests_account_id_fkey
--       foreign key (account_id) references public.accounts (id)
--       on delete set null;
