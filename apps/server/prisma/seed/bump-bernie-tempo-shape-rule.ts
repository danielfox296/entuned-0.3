// One-shot bump: append TEMPO-AWARE SHAPE hard constraint to the
// currently-active LyricDraftPrompt + LyricEditPrompt.
//
// Why: first live Suno render came back as a ~70-second song with
// crammed-syllable verses. Counting actual sung lines in the seed: only
// 14 (verse=4, pre-chorus=2, chorus=1 hook-only, x2). At 104bpm with
// ~1 line per bar, that's ~32s of vocal content — Suno fills the rest
// with the default 8-bar intro and trims. To get a 2.5-minute track,
// Bernie needs to write roughly 30-40 lines of lyric, not 14.
//
// Also amends the parens rule slightly: brief vocal interjections
// (one line, ≤2 words: `(ooh)`, `(mm)`, `(yeah)`, `(ah-ah)`) are now
// allowed inside [Intro] / [Instrumental Break] / [Outro] sections.
// Stage-direction parens stay forbidden.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/bump-bernie-tempo-shape-rule.ts');
//   \""

import { PrismaClient } from '@prisma/client'

const RULE_HEADER = 'TEMPO-AWARE SHAPE'

const TEMPO_SHAPE_RULE = `
TEMPO-AWARE SHAPE — hard constraint:

Suno renders roughly one lyric line per bar. A 2.5-minute song at the target tempo needs enough lines to actually fill that time — when there isn't enough lyric, Suno either ships a sub-90-second track OR crams syllables into too few lines. Both fail the brief.

REQUIRED LINE MINIMUMS for chorus-based forms (vcvcbc / vcvc / intro_driven / loop / tag_out):
- Every Verse: 4-6 lines.
- Every Pre-Chorus: 3-4 lines.
- Every Chorus and Final Chorus: hook + 2-4 supporting lines + hook. The hook line appears verbatim at the START AND END of every chorus section, with development between. Choruses are NEVER hook-only.
- Bridge (when the archetype includes one): 4 lines.
- Tag section (when the archetype includes one): hook verbatim, repeated 2-3 times, NOT hook-only-once.

For AABA: each Verse is 4-6 lines ending on the hook verbatim as the refrain. Bridge is 4 lines.

LINE LENGTH PER TEMPO:
- ≥110bpm: 5-7 syllables per line. Short, punchy. Many short lines beats fewer crammed lines.
- 90-110bpm: 6-8 syllables per line.
- <90bpm: 8-11 syllables per line, longer vowels.

If you find yourself writing a 10+ syllable line at 100+bpm, break it into two short lines. The line-per-bar mapping is what makes a song breathe; cramming destroys it.

INSTRUMENTAL SECTIONS ([Intro], [Instrumental Break], [Outro]):
You may place SHORT vocal interjections in parens — \`(ooh)\`, \`(mm)\`, \`(yeah)\`, \`(ah-ah)\`. ONE line maximum per section. TWO words maximum per interjection. No stage direction, no descriptive parens (the previous parens-discipline rule still holds). Leaving the section empty is also fine if no interjection feels natural.
`.trim()

const EDIT_PASS_ADDENDUM = `

When polishing the draft: count the lines per section. If any section falls below the TEMPO-AWARE SHAPE minimums above, fill it in to the minimum. If a chorus section is hook-only, expand it (hook + 2-4 supporting lines + hook). If a verse line crams >8 syllables at 100+bpm, split it into two shorter lines. The minimums are not aspirational — they are the threshold below which Suno produces a too-short, too-dense song.`

async function bumpDraft(p: PrismaClient) {
  const latest = await p.lyricDraftPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) throw new Error('no existing LyricDraftPrompt rows; expected at least v1')
  if (latest.promptText.includes(RULE_HEADER)) {
    console.log(`  LyricDraftPrompt v${latest.version} already contains the rule — skipping.`)
    return
  }
  const newVersion = latest.version + 1
  const newText = `${latest.promptText}\n\n${TEMPO_SHAPE_RULE}`
  const row = await p.lyricDraftPrompt.create({
    data: {
      version: newVersion,
      promptText: newText,
      notes: 'Append tempo-aware shape hard constraint (line minimums per section, syllable budget per tempo, brief vocal interjections allowed in instrumental sections).',
    },
  })
  console.log(`  Inserted LyricDraftPrompt v${row.version} (was v${latest.version}). +${TEMPO_SHAPE_RULE.length} chars.`)
}

async function bumpEdit(p: PrismaClient) {
  const latest = await p.lyricEditPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) throw new Error('no existing LyricEditPrompt rows; expected at least v1')
  if (latest.promptText.includes(RULE_HEADER)) {
    console.log(`  LyricEditPrompt v${latest.version} already contains the rule — skipping.`)
    return
  }
  const newVersion = latest.version + 1
  const newText = `${latest.promptText}\n\n${TEMPO_SHAPE_RULE}${EDIT_PASS_ADDENDUM}`
  const row = await p.lyricEditPrompt.create({
    data: {
      version: newVersion,
      promptText: newText,
      notes: 'Append tempo-aware shape hard constraint + fill-to-minimum directive for the edit pass.',
    },
  })
  console.log(`  Inserted LyricEditPrompt v${row.version} (was v${latest.version}). +${(TEMPO_SHAPE_RULE + EDIT_PASS_ADDENDUM).length} chars.`)
}

async function main() {
  const p = new PrismaClient()
  try {
    console.log('Bumping Bernie prompts with TEMPO-AWARE SHAPE rule...')
    await bumpDraft(p)
    await bumpEdit(p)
    console.log('Done.')
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
