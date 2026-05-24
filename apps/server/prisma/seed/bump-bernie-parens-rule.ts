// One-shot bump: append PARENTHESES DISCIPLINE hard constraint to the
// currently-active LyricDraftPrompt + LyricEditPrompt, inserted as the
// next version. Idempotent-ish: rerunning creates yet another version on
// top — gated by a guard that no-ops if the latest version already
// contains the rule header text.
//
// Why: Bernie was self-inventing stage-direction parens like
// "(ukulele groove, 4 bars)" inside [Intro] / [Instrumental Break] /
// [Outro] sections. Per the EDIT_CRAFT_BLOCK rule, parens = backing
// vocals — Suno will literally try to sing those words. The fix is a
// hard constraint forbidding any parens that aren't sung interjections.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/bump-bernie-parens-rule.ts');
//   \""

import { PrismaClient } from '@prisma/client'

const RULE_HEADER = 'PARENTHESES DISCIPLINE'

const PARENS_RULE = `
PARENTHESES DISCIPLINE — hard constraint, not a style preference:

Parentheses "( )" around any text are sung as backing vocals by Suno. They are PERFORMANCE notation, never stage direction.

CORRECT use of parens:
- (oh yeah), (ooh), (mm-hmm), (don't stop now), (right there) — short interjections backing vocals literally vocalize.
- (we said), (you know) — call-and-response responses backing vocals sing.

FORBIDDEN use of parens — ANY parens containing stage direction, instrument description, bar counts, or descriptive annotation. Examples of what NEVER goes in parens:
- (ukulele groove, 4 bars) — instrument + bar count
- (groove carries — ukulele, claps, full pocket, 8 bars) — sonic description
- (groove fades / cold stop), (fade on groove) — outro instruction
- (extended intro), (instrumental section), (8 bars), (32 bars) — section/duration descriptors
- (claps come in), (drums drop) — production cues
- Anything that reads as a note to the engineer rather than something a singer would actually sing.

For [Intro], [Instrumental Break], [Outro], or any other instrumental section: leave the section EMPTY (just the [Section] header on its own line, then a blank line, then the next [Section] header). Suno fills instrumental sections from the genre + arrangement context. Do NOT write descriptive parens beneath them. If a section has no sung lyrics, it has no lyric lines.
`.trim()

const EDIT_PASS_ADDENDUM = `

When polishing the draft: if you find any FORBIDDEN parens (stage direction, instrument description, bar counts, production cues) — STRIP them entirely. Replace with an empty line under the section header. Never leave a stage-direction paren in the final output.`

async function bumpDraft(p: PrismaClient) {
  const latest = await p.lyricDraftPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) throw new Error('no existing LyricDraftPrompt rows; expected at least v1')
  if (latest.promptText.includes(RULE_HEADER)) {
    console.log(`  LyricDraftPrompt v${latest.version} already contains the rule — skipping.`)
    return
  }
  const newVersion = latest.version + 1
  const newText = `${latest.promptText}\n\n${PARENS_RULE}`
  const row = await p.lyricDraftPrompt.create({
    data: {
      version: newVersion,
      promptText: newText,
      notes: 'Append parens-discipline hard constraint (stage-direction parens forbidden — Suno sings them as backing vocals).',
    },
  })
  console.log(`  Inserted LyricDraftPrompt v${row.version} (was v${latest.version}). +${PARENS_RULE.length} chars.`)
}

async function bumpEdit(p: PrismaClient) {
  const latest = await p.lyricEditPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) throw new Error('no existing LyricEditPrompt rows; expected at least v1')
  if (latest.promptText.includes(RULE_HEADER)) {
    console.log(`  LyricEditPrompt v${latest.version} already contains the rule — skipping.`)
    return
  }
  const newVersion = latest.version + 1
  const newText = `${latest.promptText}\n\n${PARENS_RULE}${EDIT_PASS_ADDENDUM}`
  const row = await p.lyricEditPrompt.create({
    data: {
      version: newVersion,
      promptText: newText,
      notes: 'Append parens-discipline hard constraint + strip-if-found directive for stage-direction parens.',
    },
  })
  console.log(`  Inserted LyricEditPrompt v${row.version} (was v${latest.version}). +${(PARENS_RULE + EDIT_PASS_ADDENDUM).length} chars.`)
}

async function main() {
  const p = new PrismaClient()
  try {
    console.log('Bumping Bernie prompts with PARENTHESES DISCIPLINE rule...')
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
