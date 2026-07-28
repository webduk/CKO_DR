// Full data backup for the app's Supabase project.
//
//   npm run backup            → writes ./backups/<timestamp>/
//   npm run backup -- --out D → writes into directory D instead
//
// Captures every row of every table (as JSON) and downloads every object from
// the storage buckets, plus a manifest.json describing the snapshot. Restore
// with `npm run restore -- ./backups/<timestamp>`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROJECT_ROOT,
  getClient,
  TABLES,
  BUCKETS,
  fetchAllRows,
  listAllObjects,
} from './_supabase.mjs'

function parseArgs(argv) {
  const args = { out: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i]
  }
  return args
}

// Filesystem-safe timestamp, e.g. 2026-07-27T14-30-05-123Z.
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2))
  const { supabase, url, usingServiceRole } = getClient()

  const dir = out || join(PROJECT_ROOT, 'backups', stamp())
  mkdirSync(join(dir, 'tables'), { recursive: true })
  console.log(`\n📦 Backing up ${new URL(url).host} → ${dir}`)
  console.log(`   auth: ${usingServiceRole ? 'service_role' : 'anon'}\n`)

  const manifest = {
    created_at: new Date().toISOString(),
    supabase_host: new URL(url).host,
    used_service_role: usingServiceRole,
    tables: {},
    buckets: {},
  }

  // --- Tables ---
  for (const { name } of TABLES) {
    const rows = await fetchAllRows(supabase, name)
    writeFileSync(
      join(dir, 'tables', `${name}.json`),
      JSON.stringify(rows, null, 2),
    )
    manifest.tables[name] = rows.length
    console.log(`   ✓ ${name}: ${rows.length} row${rows.length === 1 ? '' : 's'}`)
  }

  // --- Storage buckets ---
  for (const bucket of BUCKETS) {
    const paths = await listAllObjects(supabase, bucket)
    const files = []
    for (const path of paths) {
      const { data, error } = await supabase.storage.from(bucket).download(path)
      if (error) {
        console.warn(`   ! skip ${bucket}/${path}: ${error.message}`)
        continue
      }
      const buffer = Buffer.from(await data.arrayBuffer())
      const dest = join(dir, 'storage', bucket, path)
      mkdirSync(join(dest, '..'), { recursive: true })
      writeFileSync(dest, buffer)
      files.push({
        path,
        contentType: data.type || null,
        size: buffer.length,
      })
    }
    // Sidecar index so restore can re-set each object's content type.
    mkdirSync(join(dir, 'storage'), { recursive: true })
    writeFileSync(
      join(dir, 'storage', `${bucket}.files.json`),
      JSON.stringify(files, null, 2),
    )
    manifest.buckets[bucket] = files.length
    console.log(`   ✓ ${bucket}: ${files.length} file${files.length === 1 ? '' : 's'}`)
  }

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const rowTotal = Object.values(manifest.tables).reduce((a, b) => a + b, 0)
  const fileTotal = Object.values(manifest.buckets).reduce((a, b) => a + b, 0)
  console.log(
    `\n✅ Backup complete: ${rowTotal} rows across ${TABLES.length} tables, ` +
      `${fileTotal} storage files.\n   ${dir}\n`,
  )
}

main().catch((err) => {
  console.error(`\n❌ Backup failed: ${err.message}\n`)
  process.exit(1)
})
