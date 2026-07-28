# Data backup & restore

A failsafe snapshot of everything the app stores in Supabase: all database
tables **and** the uploaded files in Storage. Backups are plain files on disk you
can copy anywhere, and restore back into Supabase when needed.

## What gets backed up

**Tables** (`backups/<timestamp>/tables/*.json`):

- `Companies`, `accounts`, `contacts`, `request_types`, `design_requests`,
  `design_request_attachments`, `design_request_install_specs`, `todos`

**Storage buckets** (`backups/<timestamp>/storage/<bucket>/…`):

- `design-request-files` (attachments)
- `design-request-install-specs` (installation specs)

Plus a `manifest.json` recording when the snapshot was taken, the source
project, and per-table / per-bucket counts.

## One-time setup

The scripts need the Supabase **service_role** key so they can read every row and
write rows back (bypassing Row-Level Security). It is a server secret — it stays
in `.env` (which is git-ignored) and is never bundled into the web app.

1. Supabase → **Project Settings → API → `service_role`** → copy the secret.
2. Add it to `.env`:

   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
   ```

> Without this key the scripts fall back to the anon key and warn you: backups
> then only include rows the anon role can read, and a restore may be blocked by
> RLS. The service_role key is what makes this a true failsafe.

## Back up

```bash
npm run backup
# → backups/2026-07-27T14-30-05-123Z/

# custom destination:
npm run backup -- --out /mnt/usb/cko-backup
```

Run it as often as you like; each run writes a fresh timestamped folder. Copy
those folders somewhere off-machine (another drive, cloud storage) for real
safety.

## Restore

Restores **UPSERT** the snapshot into the live database — rows with a matching
`id` are overwritten, missing rows are inserted, and files are re-uploaded. It
does **not** delete rows that exist in Supabase but not in the backup. Tables are
written parents-first so foreign keys stay valid.

```bash
npm run restore -- ./backups/2026-07-27T14-30-05-123Z
# prompts: type "restore" to confirm

# skip the prompt (e.g. in a script):
npm run restore -- ./backups/<timestamp> --yes

# partial restores:
npm run restore -- ./backups/<timestamp> --tables-only
npm run restore -- ./backups/<timestamp> --storage-only
```

### After a restore

Tables use serial `id` columns. Re-inserting rows with explicit ids does **not**
advance the sequence, so the *next* new record the app creates could collide.
After a restore that re-inserted rows, bump each sequence in the Supabase SQL
editor:

```sql
select setval(
  pg_get_serial_sequence('public.accounts', 'id'),
  coalesce((select max(id) from public.accounts), 1)
);
-- repeat for: "Companies", contacts, request_types, design_requests,
-- design_request_attachments, design_request_install_specs, todos
```

## Automate a daily backup (optional)

Add a cron entry (`crontab -e`) to snapshot every day at 02:00 and keep the last
14 days:

```cron
0 2 * * * cd /home/mofo/apps/test1806/test1806 && /usr/bin/npm run backup >> backups/backup.log 2>&1 && find backups -maxdepth 1 -type d -name '20*' -mtime +14 -exec rm -rf {} +
```

Point the backup at a synced folder (e.g. `--out ~/Dropbox/cko-backups/…`) so the
snapshots leave the machine automatically.

## Belt-and-braces: Supabase's own backups

These scripts are an app-level failsafe you control. For infrastructure-level
protection, also enable Supabase's **daily backups / Point-in-Time Recovery**
under Project Settings → Database (availability depends on your plan). Using both
means a bad deploy, an accidental delete, and a lost project are all covered.
