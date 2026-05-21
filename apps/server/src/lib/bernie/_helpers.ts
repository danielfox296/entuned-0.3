// Shared helpers for Bernie. Split out from bernie.ts so the generator stays
// focused on the two-pass orchestration.

import { prisma } from '../../db.js'
import { DRAFT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'

const SECTION_ORDER = ['intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'outro'] as const

// Serializes the decomposer's per-section instrumentation map into a brief prose
// brief for Bernie. Bernie uses this to match lyric density, phrasing, and energy
// to the arrangement shape — denser sections want more word weight, minimal
// sections want breathing room. Bernie should NOT name instruments in the lyrics
// themselves (that's the Arranger's job via [Instrument: ...] tags).
export function formatArrangementBrief(sections: ArrangementSections): string {
  const lines: string[] = []
  for (const key of SECTION_ORDER) {
    const directive = sections[key]
    if (!directive || directive.instruments.length === 0) continue
    const density = directive.density ?? 'medium'
    const instruments = directive.instruments.slice(0, 3).join(', ')
    const label = key === 'pre_chorus' ? 'pre-chorus' : key
    const extras: string[] = []
    if (directive.dynamic) extras.push(directive.dynamic)
    if (directive.vocal_delivery) extras.push(directive.vocal_delivery)
    const extrasStr = extras.length > 0 ? ` (${extras.join(', ')})` : ''
    lines.push(`- ${label}: ${density}${extrasStr} — ${instruments}`)
  }
  if (lines.length === 0) return ''
  return `Arrangement (per section — match lyric density and energy to this; do NOT name instruments in the lyric lines):
${lines.join('\n')}
`
}

export async function getOrSeedDraftPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.lyricDraftPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.lyricDraftPrompt.create({
    data: { version: 1, promptText: DRAFT_PROMPT_SEED, notes: 'Auto-seeded v1' },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}

export function parseLyricJson(text: string): { title: string; lyrics: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON in lyricist output')
  const parsed = JSON.parse(cleaned.slice(start)) as { title?: string; lyrics?: string }
  if (!parsed.title || !parsed.lyrics) throw new Error('Lyricist output missing title or lyrics')
  return { title: parsed.title, lyrics: parsed.lyrics }
}
