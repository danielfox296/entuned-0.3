// Reference Track Suggester — proposes reference tracks for an ICP using Claude.
// The system prompt comes from ReferenceTrackPrompt.templateText (global,
// editable in the admin Engine tab). The user message bundles the ICP's
// psychographic profile. Output is grouped by bucket: FormationEra, Subculture,
// Aspirational.
//
// Persistence: suggestions are written as ReferenceTrack rows with
// status='pending'. Operators approve via /admin/reference-tracks/:id/approve
// or reject via DELETE. Pending rows are auto-excluded from the song-seeding
// pipeline (eno.ts filters on styleAnalysis.isNot=null, and the decompose
// route refuses pending rows).

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'

const MODEL = process.env.REF_TRACK_SUGGESTER_MODEL ?? 'claude-sonnet-4-5'

export const REFERENCE_TRACK_PROMPT_SEED = `
You suggest reference tracks for a brand's in-store music ICP. A reference track
is a real, well-known song the ICP would have a clear emotional relationship to —
not what's playing in the store, but what shapes the *feel* the store is
chasing. Operators feed these into a separate decomposer that extracts
instrumentation, gear, era affects, and arrangement. You are NOT picking what
will play — you are anchoring the sonic intent.

Three buckets, each with a different relationship to the ICP:

- **FormationEra** — songs the ICP heard during their musical formation years
  (roughly ages 12–22). Nostalgic, identity-defining. Use the ICP's age range
  to anchor the era. These should be tracks they would name without prompting.

- **Subculture** — songs that signal in-group membership for the ICP's tribe,
  scene, or cultural cohort. Less mainstream, more identity-as-marker. The ICP
  uses these to recognize "their people."

- **Aspirational** — songs that represent who the ICP wants to be or is becoming.
  Often slightly outside their formation — a sound they admire, gravitate
  toward, or use to signal upward mobility / refinement / depth.

Selection rules:
- Real songs only. Real artists, real titles. No fabrication.
- Vary across each bucket — don't return three songs by the same artist.
- Lean specific over generic. "Steely Dan – Peg" beats "a yacht rock track."
- Avoid the obvious clichés of the genre unless they genuinely fit this ICP.
- Year is the original release year, not a re-release.

Output JSON only, no prose, no markdown fences:

{
  "FormationEra": [{ "artist": "...", "title": "...", "year": 1978, "rationale": "..." }, ...],
  "Subculture":   [{ "artist": "...", "title": "...", "year": 1995, "rationale": "..." }, ...],
  "Aspirational": [{ "artist": "...", "title": "...", "year": 2015, "rationale": "..." }, ...]
}

Return 4–6 candidates per bucket. Rationale is one short sentence — why this
song for this ICP in this bucket.
`.trim()

export async function getOrSeedReferenceTrackPrompt(): Promise<{ id: string; version: number; templateText: string }> {
  const latest = await prisma.referenceTrackPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (latest) return latest
  return prisma.referenceTrackPrompt.create({
    data: { version: 1, templateText: REFERENCE_TRACK_PROMPT_SEED },
  })
}

export type SuggestedRefTrack = {
  artist: string
  title: string
  year: number | null
  rationale: string | null
}

export type SuggestReferenceTracksResult = {
  createdCount: number
  promptVersion: number
  rawText: string
}

export async function suggestReferenceTracks(opts: { icpId: string }): Promise<SuggestReferenceTracksResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [icp, prompt, existing] = await Promise.all([
    prisma.iCP.findUniqueOrThrow({ where: { id: opts.icpId }, include: { client: true } }),
    getOrSeedReferenceTrackPrompt(),
    prisma.referenceTrack.findMany({
      where: { icpId: opts.icpId },
      select: { artist: true, title: true, bucket: true },
    }),
  ])

  const icpDescriptor = [
    icp.name && `Name: ${icp.name}`,
    icp.ageRange && `Age range: ${icp.ageRange}`,
    icp.location && `Location: ${icp.location}`,
    icp.politicalSpectrum && `Political: ${icp.politicalSpectrum}`,
    icp.openness && `Openness: ${icp.openness}`,
    icp.fears && `Fears: ${icp.fears}`,
    icp.values && `Values: ${icp.values}`,
    icp.desires && `Desires: ${icp.desires}`,
    icp.unexpressedDesires && `Unexpressed desires: ${icp.unexpressedDesires}`,
    icp.turnOffs && `Turn-offs: ${icp.turnOffs}`,
  ].filter(Boolean).join('\n')

  const existingList = existing.length === 0
    ? '(none)'
    : existing.map((r) => `- ${r.artist} – ${r.title} (${r.bucket})`).join('\n')

  const userMessage = `# ICP

${icpDescriptor}

# Existing reference tracks (do not repeat)

${existingList}

# Task

Propose reference tracks for this ICP across all three buckets. Output JSON only.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: [{ type: 'text', text: prompt.templateText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((b: any) => b.type === 'text') as any
  if (!textBlock?.text) throw new Error('Reference track suggester returned no text')
  const raw = textBlock.text as string

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in suggester output')
  const parsed = JSON.parse(cleaned.slice(start)) as Record<string, unknown>

  const norm = (arr: unknown): SuggestedRefTrack[] => {
    if (!Array.isArray(arr)) return []
    return arr
      .map((row: any) => {
        if (!row || typeof row !== 'object') return null
        const artist = typeof row.artist === 'string' ? row.artist.trim() : ''
        const title = typeof row.title === 'string' ? row.title.trim() : ''
        if (!artist || !title) return null
        const year = typeof row.year === 'number' && Number.isFinite(row.year) ? Math.trunc(row.year) : null
        const rationale = typeof row.rationale === 'string' ? row.rationale.trim() : null
        return { artist, title, year, rationale }
      })
      .filter((r): r is SuggestedRefTrack => r !== null)
  }

  const grouped: Record<'FormationEra' | 'Subculture' | 'Aspirational', SuggestedRefTrack[]> = {
    FormationEra: norm(parsed.FormationEra),
    Subculture: norm(parsed.Subculture),
    Aspirational: norm(parsed.Aspirational),
  }

  // Dedup against existing tracks (by case-insensitive artist+title), then persist
  // as pending ReferenceTrack rows so operators can navigate away without losing
  // suggestions.
  const existingKey = new Set(existing.map((e) => `${e.artist.toLowerCase()}::${e.title.toLowerCase()}`))
  const now = new Date()
  const rows: { icpId: string; bucket: 'FormationEra' | 'Subculture' | 'Aspirational'; artist: string; title: string; year: number | null; suggestedRationale: string | null; suggestedPromptVer: number; suggestedAt: Date }[] = []
  for (const bucket of ['FormationEra', 'Subculture', 'Aspirational'] as const) {
    for (const s of grouped[bucket]) {
      const key = `${s.artist.toLowerCase()}::${s.title.toLowerCase()}`
      if (existingKey.has(key)) continue
      existingKey.add(key)
      rows.push({
        icpId: opts.icpId,
        bucket,
        artist: s.artist,
        title: s.title,
        year: s.year,
        suggestedRationale: s.rationale,
        suggestedPromptVer: prompt.version,
        suggestedAt: now,
      })
    }
  }

  if (rows.length > 0) {
    await prisma.referenceTrack.createMany({
      data: rows.map((r) => ({
        icpId: r.icpId,
        bucket: r.bucket,
        artist: r.artist,
        title: r.title,
        year: r.year,
        status: 'pending',
        suggestedRationale: r.suggestedRationale,
        suggestedPromptVer: r.suggestedPromptVer,
        suggestedAt: r.suggestedAt,
      })),
    })
  }

  return {
    createdCount: rows.length,
    promptVersion: prompt.version,
    rawText: raw,
  }
}
