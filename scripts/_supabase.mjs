// Shared helpers for the backup/restore scripts.
//
// These run under Node (not Vite), so they read .env themselves and talk to
// Supabase with the service_role key when available — that bypasses Row-Level
// Security so a backup captures every row and a restore can write rows back.
// The service_role key is a server secret: it lives only in .env (git-ignored)
// and is never imported by the app bundle.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = join(HERE, '..')

// Minimal .env reader: `KEY=value` lines, `#` comments, optional surrounding
// quotes. Enough for this project's flat .env (no multiline values).
export function loadEnv() {
  let text
  try {
    text = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8')
  } catch {
    return {}
  }
  const env = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

// Build an admin Supabase client. Prefers the service_role key; falls back to
// the anon key with a loud warning (backup/restore completeness then depends on
// the table RLS policies). process.env wins over .env so CI can inject secrets.
export function getClient() {
  const env = { ...loadEnv(), ...process.env }
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  const key = serviceKey || anonKey

  if (!url || !key) {
    throw new Error(
      'Missing Supabase credentials. Set VITE_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY (preferred) or VITE_SUPABASE_ANON_KEY in .env.',
    )
  }

  const usingServiceRole = Boolean(serviceKey)
  if (!usingServiceRole) {
    console.warn(
      '⚠  No SUPABASE_SERVICE_ROLE_KEY found — falling back to the anon key.\n' +
        '   Backups will only include rows the anon role can read, and a restore\n' +
        '   may be blocked by Row-Level Security. Add the service_role key from\n' +
        '   Supabase → Project Settings → API for a complete failsafe.\n',
    )
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { supabase, url, usingServiceRole }
}

// Tables in FOREIGN-KEY-SAFE order: parents before children, so a restore can
// upsert straight down the list without tripping FK constraints. Backup order
// is irrelevant. `conflict` is the column used for upsert on restore.
export const TABLES = [
  { name: 'Companies', conflict: 'id' },
  { name: 'request_types', conflict: 'id' },
  { name: 'accounts', conflict: 'id' },
  { name: 'contacts', conflict: 'id' },
  { name: 'design_requests', conflict: 'id' },
  { name: 'design_request_attachments', conflict: 'id' },
  { name: 'design_request_install_specs', conflict: 'id' },
  { name: 'todos', conflict: 'id' },
]

// Storage buckets that hold uploaded design-request files.
export const BUCKETS = ['design-request-files', 'design-request-install-specs']

// Read every row of a table, paging past PostgREST's 1000-row cap. Ordered by
// id for stable pagination.
export async function fetchAllRows(supabase, table) {
  const pageSize = 1000
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Reading ${table}: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return all
}

// Recursively list every object path in a bucket (Supabase's list() is one
// folder at a time; folder entries come back with id === null).
export async function listAllObjects(supabase, bucket, prefix = '') {
  const out = []
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`Listing ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        out.push(...(await listAllObjects(supabase, bucket, path)))
      } else {
        out.push(path)
      }
    }
    if (data.length < limit) break
  }
  return out
}

// Split an array into fixed-size chunks (for batched upserts/uploads).
export function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
