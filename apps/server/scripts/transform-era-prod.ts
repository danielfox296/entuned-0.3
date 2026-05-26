// Deterministic, no-LLM transform of legacy eraProductionSignature prose into
// the v12 schema shape (`<decade-prefix>, <1-2 production words>`).
//
// Operates on StyleAnalysis rows tied to approved ReferenceTracks whose current
// styleAnalyzerInstructionsVersion < 12. Reads the existing prose + the track's
// year, derives a decade prefix and 1-2 production vocabulary words, and
// overwrites eraProductionSignature.
//
// Does NOT bump styleAnalyzerInstructionsVersion — the other fields (vibePitch,
// instrumentationPalette, etc.) were still produced by the older rules; we only
// reshaped one field.
//
// Usage:
//   pnpm exec tsx scripts/transform-era-prod.ts --limit 20 --dry-run
//   pnpm exec tsx scripts/transform-era-prod.ts --limit 500
//   pnpm exec tsx scripts/transform-era-prod.ts --all
//
// --dry-run: prints before/after, no DB writes
// --limit N: process at most N rows (oldest version first)
// --all:     no limit (process every stale row)

import 'dotenv/config'
import { prisma } from '../src/db.js'

const LATEST = 12

// v12 whitelist. Multi-word terms listed first so "warm tape" matches before "tape".
const PROD_VOCAB = [
  'warm tape',
  'home-recorded',
  'home recorded',
  'room bleed',
  'gated reverb',
  'plate reverb',
  'spring reverb',
  'tape echo',
  'lo-fi',
  'lofi',
  'polished',
  'saturated',
  'compression',
  'sidechain',
  'sampling',
  'tape',
  'DAW',
  'dry',
  'wet',
] as const

// Canonicalize matched terms (hyphenated where required, etc.)
const CANONICAL: Record<string, string> = {
  'home recorded': 'home-recorded',
  lofi: 'lo-fi',
}

// Inference rules — applied when no direct whitelist hit found. Each entry:
// [test pattern in lowercased prose, inferred vocab word]. Stop at first match.
const INFERENCE: Array<[RegExp, string]> = [
  [/\b(analog|tube|vintage|tape-rounded|reel-to-reel|8-track)\b/i, 'warm tape'],
  [/\b(natural room|room presence|live[- ]room|live[- ]band|room ambience)\b/i, 'room bleed'],
  [/\b(bedroom|home studio|home recording)\b/i, 'home-recorded'],
  [/\b(brick[- ]wall|limiter|limited|loudness[- ]war|heavy limiting)\b/i, 'compression'],
  [/\b(pro[- ]tools|digital clarity|clean studio|glossy|sheen|polished)\b/i, 'polished'],
  [/\b(reverb|spacious|hall)\b/i, 'plate reverb'],
  [/\b(close-mic|dry|minimal processing)\b/i, 'dry'],
]

// Default when nothing infers either. Decade-neutral.
const DEFAULT_PROD = 'polished'

const DECADE_BARE_RE = /\b(60s|70s|80s|90s|2000s|2010s|2020s)\b/i
const DECADE_FULL_RE = /\b(19[6-9]0s|20[0-2]0s)\b/i
const DECADE_QUALIFIED_RE = /\b(early|mid|late)[- ]+(60s|70s|80s|90s|2000s|2010s|2020s|19[6-9]0s|20[0-2]0s)\b/i

function normalizeDecadeSuffix(raw: string): string | null {
  // Normalize "1970s" → "70s", "2010s" → "2010s", etc.
  const m = raw.toLowerCase().match(/^(19|20)?(\d0)s$/)
  if (!m) return null
  const century = m[1]
  const decade = m[2]
  if (century === '19' || century === undefined) {
    // 1960s..1990s → "60s".."90s"; bare 60s/70s/80s/90s already in that form
    if (['60', '70', '80', '90'].includes(decade)) return `${decade}s`
  }
  if (century === '20' || century === undefined) {
    // 2000s/2010s/2020s
    if (['00', '10', '20'].includes(decade)) return `20${decade}s`
  }
  // Bare "2000s"/"2010s"/"2020s" without century prefix in the regex
  if (['00', '10', '20'].includes(decade) && century === undefined) return `20${decade}s`
  return null
}

function pickQualifierForYear(year: number): 'early' | 'mid' | 'late' {
  const within = year % 10
  if (within <= 3) return 'early'
  if (within <= 6) return 'mid'
  return 'late'
}

function decadeSuffixFromYear(year: number): string {
  // 2013 → "2010s"; 1996 → "90s"
  const decadeStart = Math.floor(year / 10) * 10
  if (decadeStart >= 2000) return `${decadeStart}s`
  // 1960..1990 → "60s".."90s"
  return `${decadeStart - 1900}s`
}

export function extractDecadePrefix(prose: string | null | undefined, year: number | null | undefined): string | null {
  if (prose) {
    const qualified = prose.match(DECADE_QUALIFIED_RE)
    if (qualified) {
      const qual = qualified[1].toLowerCase()
      const suffix = normalizeDecadeSuffix(qualified[2])
      if (suffix) return `${qual}-${suffix}`
    }
    const full = prose.match(DECADE_FULL_RE)
    if (full && year) {
      // Have a full-form decade in prose AND a year — use year to pick qualifier.
      const suffix = normalizeDecadeSuffix(full[1])
      if (suffix) return `${pickQualifierForYear(year)}-${suffix}`
    }
    if (full) {
      const suffix = normalizeDecadeSuffix(full[1])
      if (suffix) return `mid-${suffix}`
    }
    const bare = prose.match(DECADE_BARE_RE)
    if (bare && year) {
      const suffix = normalizeDecadeSuffix(bare[1])
      if (suffix) return `${pickQualifierForYear(year)}-${suffix}`
    }
    if (bare) {
      const suffix = normalizeDecadeSuffix(bare[1])
      if (suffix) return `mid-${suffix}`
    }
  }
  if (typeof year === 'number') {
    return `${pickQualifierForYear(year)}-${decadeSuffixFromYear(year)}`
  }
  return null
}

// Negation lookback. Find any negation word in a ~60-char window before the
// match, but only count it if NO clause boundary (comma, period, semicolon)
// appears between the negation and the match. So "no room bleed" negates
// "room bleed", but "no unnecessary fills, dry" does NOT negate "dry".
const NEGATION_RE = /\b(no|not|never|without|minimal|lacking|zero|absent|less|reduced|free|sans)\b/gi
const CLAUSE_BREAK_RE = /[,.;]/

function isNegatedAt(lower: string, matchPos: number): boolean {
  const back = Math.max(0, matchPos - 60)
  const window = lower.slice(back, matchPos)
  for (const m of window.matchAll(NEGATION_RE)) {
    const negEnd = (m.index ?? 0) + m[0].length
    const between = window.slice(negEnd)
    if (!CLAUSE_BREAK_RE.test(between)) return true
  }
  return false
}

export function extractProductionWords(prose: string | null | undefined): string[] {
  if (!prose) return []
  const lower = prose.toLowerCase()
  const found: string[] = []
  for (const term of PROD_VOCAB) {
    const needle = term.toLowerCase()
    const idx = lower.indexOf(needle)
    if (idx < 0) continue
    if (isNegatedAt(lower, idx)) continue
    const canonical = CANONICAL[term] ?? term
    // Dedupe; also avoid adding "tape" if "warm tape" already in list.
    if (
      !found.includes(canonical) &&
      !found.some((f) => f.includes(canonical) || canonical.includes(f))
    ) {
      found.push(canonical)
    }
    if (found.length === 2) return found
  }
  // Inference fallback — same negation check applies.
  if (found.length === 0) {
    for (const [re, inferred] of INFERENCE) {
      const match = lower.match(re)
      if (!match || match.index === undefined) continue
      if (isNegatedAt(lower, match.index)) continue
      found.push(inferred)
      if (found.length === 2) break
    }
  }
  return found
}

export interface TightenInput {
  oldText: string | null | undefined
  year: number | null | undefined
}

export interface TightenResult {
  newText: string | null
  reason: 'ok' | 'no-decade' | 'no-input'
  decade: string | null
  prodWords: string[]
}

export function tightenEraProd({ oldText, year }: TightenInput): TightenResult {
  if (!oldText && typeof year !== 'number') {
    return { newText: null, reason: 'no-input', decade: null, prodWords: [] }
  }
  const decade = extractDecadePrefix(oldText ?? '', year ?? null)
  if (!decade) {
    return { newText: null, reason: 'no-decade', decade: null, prodWords: [] }
  }
  let prodWords = extractProductionWords(oldText ?? '')
  if (prodWords.length === 0) prodWords = [DEFAULT_PROD]
  let newText = `${decade}, ${prodWords.join(', ')}`
  // Hard 40-char cap. If overflow (rare given short vocab), drop the 2nd word.
  if (newText.length > 40 && prodWords.length === 2) {
    newText = `${decade}, ${prodWords[0]}`
  }
  return { newText, reason: 'ok', decade, prodWords }
}

// ---------------------------------------------------------------------------
// Script entrypoint
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  const dryRun = hasFlag('dry-run')
  const all = hasFlag('all')
  const limitRaw = arg('limit')
  let take: number | undefined
  if (all) {
    take = undefined
  } else if (limitRaw) {
    const n = parseInt(limitRaw, 10)
    if (!Number.isFinite(n) || n < 1) {
      console.error(`bad --limit value: ${limitRaw}`)
      process.exit(1)
    }
    take = n
  } else {
    console.error('usage: pnpm exec tsx scripts/transform-era-prod.ts (--limit N | --all) [--dry-run]')
    process.exit(1)
  }

  const rows = await prisma.styleAnalysis.findMany({
    where: {
      styleAnalyzerInstructionsVersion: { lt: LATEST },
      referenceTrack: { status: 'approved' },
    },
    include: {
      referenceTrack: { select: { id: true, artist: true, title: true, year: true } },
    },
    orderBy: [
      { styleAnalyzerInstructionsVersion: 'asc' },
      { createdAt: 'asc' },
    ],
    take,
  })

  console.log(`[transform] target LATEST=v${LATEST}, scope=${rows.length} stale row(s), dry-run=${dryRun}`)
  console.log()

  let written = 0
  let skipped = 0
  let unchanged = 0
  const skipReasons: { artist: string; title: string; year: number | null; oldText: string | null; reason: string }[] = []

  for (const r of rows) {
    const ref = r.referenceTrack
    const label = `${ref.artist} — ${ref.title}${ref.year ? ` (${ref.year})` : ''}`
    const result = tightenEraProd({ oldText: r.eraProductionSignature, year: ref.year })

    if (!result.newText) {
      skipped++
      skipReasons.push({
        artist: ref.artist,
        title: ref.title,
        year: ref.year,
        oldText: r.eraProductionSignature,
        reason: result.reason,
      })
      console.log(`⨯ SKIP ${label}`)
      console.log(`    reason: ${result.reason}`)
      console.log(`    old: ${r.eraProductionSignature ?? '(null)'}`)
      continue
    }

    if (result.newText === r.eraProductionSignature) {
      unchanged++
      console.log(`= NO-OP ${label}`)
      continue
    }

    console.log(`${dryRun ? '·' : '✓'} ${label}  [v${r.styleAnalyzerInstructionsVersion}]`)
    console.log(`    old: ${r.eraProductionSignature ?? '(null)'}`)
    console.log(`    new: ${result.newText}  (${result.newText.length} chars)`)

    if (!dryRun) {
      await prisma.styleAnalysis.update({
        where: { id: r.id },
        data: { eraProductionSignature: result.newText },
      })
      written++
    }
  }

  console.log()
  console.log(`[transform] done. ${dryRun ? 'would-write' : 'written'}=${dryRun ? rows.length - skipped - unchanged : written} skipped=${skipped} unchanged=${unchanged} total=${rows.length}`)
  if (skipped > 0) {
    console.log(`[transform] skip details:`)
    for (const s of skipReasons.slice(0, 20)) {
      console.log(`  · ${s.artist} — ${s.title} year=${s.year ?? 'null'} reason=${s.reason}`)
      console.log(`      old: ${s.oldText ?? '(null)'}`)
    }
    if (skipReasons.length > 20) {
      console.log(`  ... (${skipReasons.length - 20} more skipped)`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
