import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  const seeds = await p.songSeed.findMany({
    where: { lyrics: { not: null } },
    select: {
      id: true,
      lyrics: true,
      title: true,
      outcomeId: true,
      hookId: true,
      outcome: { select: { id: true, title: true, displayTitle: true, outcomeKey: true, mood: true, mode: true, tempoBpm: true } },
      hook: { select: { id: true, text: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Also pull all approved hooks grouped by outcome
  const hooks = await p.hook.findMany({
    where: { status: 'approved' },
    select: {
      id: true,
      text: true,
      outcomeId: true,
      outcome: { select: { id: true, title: true, displayTitle: true, outcomeKey: true } },
    },
  })

  // Pull outcome lyric factor prompts
  const lyricFactors = await p.$queryRaw`
    SELECT outcome_key, template_text FROM outcome_lyric_factors
  ` as { outcome_key: string; template_text: string }[]

  console.log('=== CORPUS: ' + seeds.length + ' songs, ' + hooks.length + ' approved hooks ===\n')

  // --- Group songs by outcome ---
  const byOutcome = new Map<string, typeof seeds>()
  for (const s of seeds) {
    const key = s.outcome.displayTitle ?? s.outcome.title
    if (!byOutcome.has(key)) byOutcome.set(key, [])
    byOutcome.get(key)!.push(s)
  }

  // --- Repeated trigrams per outcome ---
  const REPEAT_PHRASES = [
    "i'm learning how",
    "learning how to",
    "nothing left to prove",
    "left to prove",
    "everything need is",
    "everything i need",
    "exactly what came",
    "what came for",
    "what i came for",
    "might as well",
    "this one's mine",
    "out the door",
    "in my chest",
    "right here right now",
    "don't need to prove",
    "one more step",
    "take one more",
    "trust the",
    "keep the",
    "feel it in",
    "just the way",
    "before you think",
    "grabbing that one",
    "buffalo wings",
  ]

  console.log('=== SONGS PER OUTCOME ===')
  for (const [outcome, songs] of [...byOutcome.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const o = songs[0]!.outcome
    console.log(`\n--- ${outcome} (${songs.length} songs) | ${o.mood} ${o.mode} ${o.tempoBpm}bpm | key: ${o.outcomeKey} ---`)

    // Trigram analysis for this outcome
    const trigramFreq = new Map<string, number>()
    for (const s of songs) {
      const lines = s.lyrics!.split('\n').filter(l => l.trim() && !l.trim().startsWith('['))
      for (const line of lines) {
        const words = line.toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(w => w.length > 1)
        for (let i = 0; i < words.length - 2; i++) {
          const tg = words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]
          trigramFreq.set(tg, (trigramFreq.get(tg) ?? 0) + 1)
        }
      }
    }
    const topTrigrams = [...trigramFreq.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)

    if (topTrigrams.length > 0) {
      console.log('  Top trigrams:')
      for (const [tg, n] of topTrigrams) console.log(`    ${String(n).padStart(3)}x  ${tg}`)
    }

    // Which repeated phrases appear in this outcome
    const allLyrics = songs.map(s => s.lyrics!.toLowerCase()).join('\n')
    const phraseHits: string[] = []
    for (const ph of REPEAT_PHRASES) {
      const re = new RegExp(ph.replace(/[.*+?${}()|[\]\\]/g, '\\$&'), 'gi')
      const m = allLyrics.match(re)
      if (m && m.length >= 2) phraseHits.push(`${ph} (${m.length}x)`)
    }
    if (phraseHits.length > 0) {
      console.log('  Repeated phrase hits: ' + phraseHits.join(', '))
    }
  }

  // --- Hook analysis: most repeated hooks ---
  console.log('\n\n=== HOOKS PER OUTCOME (approved) ===')
  const hooksByOutcome = new Map<string, typeof hooks>()
  for (const h of hooks) {
    const key = h.outcome.displayTitle ?? h.outcome.title
    if (!hooksByOutcome.has(key)) hooksByOutcome.set(key, [])
    hooksByOutcome.get(key)!.push(h)
  }

  for (const [outcome, hs] of [...hooksByOutcome.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n--- ${outcome} (${hs.length} hooks) ---`)
    for (const h of hs) {
      console.log(`  "${h.text}"`)
    }
  }

  // --- Outcome lyric factor prompts ---
  if (lyricFactors.length > 0) {
    console.log('\n\n=== OUTCOME LYRIC FACTOR PROMPTS ===')
    for (const lf of lyricFactors) {
      console.log(`\n--- ${lf.outcome_key} ---`)
      console.log(lf.template_text.substring(0, 500))
      if (lf.template_text.length > 500) console.log('  ...(truncated)')
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
