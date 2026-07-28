// Restore a backup produced by scripts/backup.mjs back into Supabase.
//
//   npm run restore -- ./backups/<timestamp>          (asks to confirm)
//   npm run restore -- ./backups/<timestamp> --yes     (no prompt)
//   npm run restore -- ./backups/<timestamp> --tables-only
//   npm run restore -- ./backups/<timestamp> --storage-only
//
// Rows are UPSERTed by id in foreign-key-safe order (parents first), so this
// overwrites current rows that share an id and inserts the rest. Storage objects
// are re-uploaded with upsert. This is a WRITE to your live database — it does
// not delete rows that exist in Supabase but not in the backup.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import {
  getClient,
  TABLES,
  BUCKETS,
  chunk,
} from './_supabase.mjs'

function parseArgs(argv) {
  const args = { dir: null, yes: false, tablesOnly: false, storageOnly: false }
  for (const a of argv) {
    if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--tables-only') args.tablesOnly = true
    else if (a === '--storage-only') args.storageOnly = true
    else if (!a.startsWith('-')) args.dir = a
  }
  return args
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close()
      res(answer.trim().toLowerCase())
    })
  })
}

async function restoreTables(supabase, dir) {
  for (const { name, conflict } of TABLES) {
    const file = join(dir, 'tables', `${name}.json`)
    if (!existsSync(file)) {
      console.log(`   – ${name}: no file in backup, skipped`)
      continue
    }
    const rows = JSON.parse(readFileSync(file, 'utf8'))
    if (rows.length === 0) {
      console.log(`   ✓ ${name}: 0 rows`)
      continue
    }
    let written = 0
    for (const batch of chunk(rows, 500)) {
      const { error } = await supabase
        .from(name)
        .upsert(batch, { onConflict: conflict })
      if (error) throw new Error(`Restoring ${name}: ${error.message}`)
      written += batch.length
    }
    console.log(`   ✓ ${name}: ${written} row${written === 1 ? '' : 's'} upserted`)
  }
}

async function restoreStorage(supabase, dir) {
  for (const bucket of BUCKETS) {
    const indexFile = join(dir, 'storage', `${bucket}.files.json`)
    if (!existsSync(indexFile)) {
      console.log(`   – ${bucket}: no files index in backup, skipped`)
      continue
    }
    const files = JSON.parse(readFileSync(indexFile, 'utf8'))
    let uploaded = 0
    for (const { path, contentType } of files) {
      const src = join(dir, 'storage', bucket, path)
      if (!existsSync(src)) {
        console.warn(`   ! missing local file ${bucket}/${path}, skipped`)
        continue
      }
      const buffer = readFileSync(src)
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, buffer, {
          upsert: true,
          contentType: contentType || undefined,
        })
      if (error) throw new Error(`Uploading ${bucket}/${path}: ${error.message}`)
      uploaded += 1
    }
    console.log(`   ✓ ${bucket}: ${uploaded} file${uploaded === 1 ? '' : 's'} uploaded`)
  }
}

async function main() {
  const { dir, yes, tablesOnly, storageOnly } = parseArgs(process.argv.slice(2))
  if (!dir) {
    console.error(
      'Usage: npm run restore -- ./backups/<timestamp> [--yes] ' +
        '[--tables-only | --storage-only]',
    )
    process.exit(1)
  }
  const backupDir = resolve(dir)
  if (!existsSync(backupDir)) {
    console.error(`❌ Backup directory not found: ${backupDir}`)
    process.exit(1)
  }
  if (!existsSync(join(backupDir, 'manifest.json'))) {
    // Guard against pointing at the wrong folder.
    const looksLikeBackup = existsSync(join(backupDir, 'tables'))
    if (!looksLikeBackup) {
      console.error(
        `❌ ${backupDir} does not look like a backup (no manifest.json or tables/).`,
      )
      process.exit(1)
    }
  }

  const manifest = existsSync(join(backupDir, 'manifest.json'))
    ? JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'))
    : null

  const { supabase, url, usingServiceRole } = getClient()

  console.log(`\n♻  Restore ${backupDir}`)
  console.log(`   → ${new URL(url).host}  (auth: ${usingServiceRole ? 'service_role' : 'anon'})`)
  if (manifest) {
    console.log(`   backup taken: ${manifest.created_at}`)
    console.log(`   source host:  ${manifest.supabase_host}`)
  }

  if (!yes) {
    console.log(
      '\n⚠  This UPSERTS the backup into the live database above (overwrites rows\n' +
        '   with matching ids and re-uploads files). It does not delete anything.',
    )
    const answer = await confirm('   Type "restore" to proceed: ')
    if (answer !== 'restore') {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  console.log('')
  if (!storageOnly) {
    console.log('Tables:')
    await restoreTables(supabase, backupDir)
  }
  if (!tablesOnly) {
    console.log('Storage:')
    await restoreStorage(supabase, backupDir)
  }

  console.log(
    '\n✅ Restore complete.\n' +
      '   Note: tables with a serial `id` may need their sequence bumped after a\n' +
      "   restore that re-inserted rows — see BACKUP.md 'After a restore'.\n",
  )
}

main().catch((err) => {
  console.error(`\n❌ Restore failed: ${err.message}\n`)
  process.exit(1)
})
