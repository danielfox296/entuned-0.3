/**
 * Bulk-import externally-produced instrumental MP3s into the free-tier pool.
 *
 * Unlike the other scripts in this dir, this one runs LOCALLY (not over
 * railway ssh) because the source MP3s live on your hard drive — the Railway
 * container can't see them. It walks a local library directory laid out as:
 *
 *     <dir>/chill/*.mp3
 *     <dir>/steady/*.mp3
 *     <dir>/upbeat/*.mp3
 *
 * and POSTs each file to POST /admin/free-tier-imports?outcome=<folder>, which
 * uploads the audio to R2 and creates a Song + LineageRow @ FREE_TIER_ICP_ID.
 * The folder name is the only metadata required — playback selects on
 * (icpId, outcomeId, active) and never reads per-song tempo/arrangement.
 *
 * Idempotent + resumable: the server content-addresses each upload (sha256 of
 * the bytes), so re-running after a partial failure re-uploads nothing new and
 * skips tracks that already have an active free-tier LineageRow. Safe to re-run.
 *
 * Usage (from anywhere; needs an admin bearer token):
 *   ADMIN_BEARER=<jwt> node --import tsx \
 *     apps/server/scripts/import-free-tier-library.ts \
 *     --dir "/Users/you/Desktop/free-tier-library" \
 *     [--api https://api.entuned.co] [--concurrency 3] [--dry-run]
 *
 * Get the admin bearer from Dash: open dash.entuned.co, then in the browser
 * console: localStorage.getItem('entuned.admin.token')
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'

const OUTCOME_FOLDERS = ['chill', 'steady', 'upbeat'] as const
const MAX_RETRIES = 3

interface TrackResult {
  outcome: string
  file: string
  status: 'imported' | 'deduped' | 'failed'
  songId?: string
  lineageRowId?: string
  error?: string
}

function parseArgs(argv: string[]): { dir: string; api: string; concurrency: number; dryRun: boolean } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const dir = get('--dir')
  if (!dir) { console.error('ERROR: --dir <library-path> is required'); process.exit(1) }
  return {
    dir,
    api: (get('--api') ?? 'https://api.entuned.co').replace(/\/$/, ''),
    concurrency: Math.max(1, parseInt(get('--concurrency') ?? '3', 10)),
    dryRun: argv.includes('--dry-run'),
  }
}

async function listMp3s(folder: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(folder)
  } catch {
    return [] // folder absent — skip this outcome
  }
  return entries.filter((f) => /\.mp3$/i.test(f)).map((f) => join(folder, f)).sort()
}

async function postTrack(
  api: string,
  token: string,
  outcome: string,
  filePath: string,
): Promise<{ status: 'imported' | 'deduped'; songId?: string; lineageRowId?: string }> {
  const buf = await readFile(filePath)
  let lastErr = ''
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const form = new FormData()
      form.append('file', new Blob([buf], { type: 'audio/mpeg' }), basename(filePath))
      const res = await fetch(`${api}/admin/free-tier-imports?outcome=${encodeURIComponent(outcome)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      })
      if (res.ok) {
        const body = (await res.json()) as { deduped?: boolean; songId?: string; lineageRowId?: string }
        return { status: body.deduped ? 'deduped' : 'imported', songId: body.songId, lineageRowId: body.lineageRowId }
      }
      // 4xx (bad outcome, allowlist, too-small) won't improve on retry — fail fast.
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      }
      lastErr = `HTTP ${res.status}: ${await res.text()}`
    } catch (e: any) {
      lastErr = e?.message ?? String(e)
      if (/HTTP 4\d\d/.test(lastErr)) throw e // non-retryable client error
    }
    if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
  throw new Error(lastErr || 'unknown error')
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      await worker(items[idx]!)
    }
  })
  await Promise.all(runners)
}

async function main() {
  const { dir, api, concurrency, dryRun } = parseArgs(process.argv.slice(2))
  const token = process.env.ADMIN_BEARER
  if (!token) {
    console.error('ERROR: set ADMIN_BEARER=<admin jwt>. Get it from dash.entuned.co console: localStorage.getItem("entuned.admin.token")')
    process.exit(1)
  }

  // Build the work list across all three outcome folders.
  const jobs: { outcome: string; file: string }[] = []
  for (const outcome of OUTCOME_FOLDERS) {
    const files = await listMp3s(join(dir, outcome))
    for (const file of files) jobs.push({ outcome, file })
    console.log(`  ${outcome}: ${files.length} mp3${files.length === 1 ? '' : 's'}`)
  }
  console.log(`Total: ${jobs.length} tracks · API ${api} · concurrency ${concurrency}${dryRun ? ' · DRY RUN' : ''}\n`)
  if (jobs.length === 0) { console.error('No .mp3 files found under chill/ steady/ upbeat/. Check --dir.'); process.exit(1) }
  if (dryRun) { console.log('Dry run — no uploads performed.'); return }

  const results: TrackResult[] = []
  let done = 0
  await runPool(jobs, concurrency, async ({ outcome, file }) => {
    const name = basename(file)
    try {
      const r = await postTrack(api, token, outcome, file)
      results.push({ outcome, file: name, status: r.status, songId: r.songId, lineageRowId: r.lineageRowId })
      console.log(`[${++done}/${jobs.length}] ${r.status === 'deduped' ? '↺' : '✓'} ${outcome}/${name}`)
    } catch (e: any) {
      results.push({ outcome, file: name, status: 'failed', error: e?.message ?? String(e) })
      console.error(`[${++done}/${jobs.length}] ✗ ${outcome}/${name} — ${e?.message ?? e}`)
    }
  })

  const imported = results.filter((r) => r.status === 'imported').length
  const deduped = results.filter((r) => r.status === 'deduped').length
  const failed = results.filter((r) => r.status === 'failed')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const manifestPath = join(dir, `import-manifest-${stamp}.json`)
  await writeFile(manifestPath, JSON.stringify({ api, ranAt: new Date().toISOString(), results }, null, 2))

  console.log(`\nDone. imported=${imported} deduped=${deduped} failed=${failed.length}`)
  console.log(`Manifest: ${manifestPath}`)
  if (failed.length) {
    console.log('\nFailures (safe to re-run — successes will dedupe):')
    for (const f of failed) console.log(`  ${f.outcome}/${f.file} — ${f.error}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
