// Adjacent Reference Track Suggester — proposes the fourth bucket of reference
// tracks for an ICP. Distinct from the core suggester because adjacency is
// defined *relative to the ICP's existing approved tracks* — the prompt depends
// on the other three buckets already being populated.
//
// Persistence: same as the core suggester — pending ReferenceTrack rows tagged
// bucket='Adjacent', operators approve via the existing admin endpoints. Once
// approved + decomposed, Adjacent picks flow through Eno like any other ref
// track. Hendrix's playlist-level contrast ratio reads bucket via the
// SongSeed → ReferenceTrack join.
//
// Prompt is code-resident at v1; promote to DB-backed table if/when operators
// want to tune it without a deploy.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'

const MODEL = process.env.REF_TRACK_SUGGESTER_MODEL ?? 'claude-sonnet-4-5'

export const ADJACENT_PROMPT_VERSION = 1

export const ADJACENT_PROMPT_V1 = `
You're suggesting "Adjacent" reference tracks for an ICP. The other three buckets
(FormationEra, Subculture, Aspirational) are already populated and visible to you
in the user message. Adjacent tracks are the *fourth move* — songs the person
would unexpectedly enjoy that sit slightly off-axis from their core taste.

Adjacent is NOT:
- More tracks like the FormationEra picks (that's just doubling that bucket).
- Tracks they'd actively reject (that defeats the point — they should recognize
  themselves in the Adjacent picks, just from a different angle).
- Genre-hopping for variety's sake (random shuffle, not adjacency).

Adjacent IS:
- A neighbor genre they'd respect (a soul listener finding their way to
  late-period folk; an indie listener finding their way to 70s singer-songwriter).
- A different decade with the same emotional register (a 90s alt-rock listener
  hearing 60s garage rock and recognizing the impulse).
- Same artist's overlooked corner (the meditative B-side from a band known for
  their hits).
- Same affect, different form (the same restraint and intimacy expressed through
  ambient electronic instead of folk).

The test: if this person heard the Adjacent track at a friend's house, they'd
say "huh, what's this?" — and then, after hearing it, "yeah, that fits." Not
"this isn't me." Not "this is exactly what I always listen to."

Selection rules:
- Real songs only. Real artists, real titles. No fabrication.
- Vary across picks — don't return three songs by the same artist.
- Year is the original release year, not a re-release.
- Avoid anything already in the ICP's existing tracks (listed in the user message).

Output JSON only, no prose, no markdown fences:

{
  "Adjacent": [
    { "artist": "...", "title": "...", "year": 1978, "rationale": "..." },
    ...
  ]
}

Return 8–12 candidates. The rationale is one short sentence forming a *bridge*
from the ICP's core taste to this pick. Make it concrete: name the shared
quality. Pattern: "moves from [ICP's core sound] to [adjacent move] via [shared
quality]." Bad rationale: "would expand their horizons." Good rationale:
"moves from 80s soul to late-period Cohen via the same plainspoken male
intimacy."
`.trim()

export type SuggestedAdjacentTrack = {
  artist: string
  title: string
  year: number | null
  rationale: string | null
}

export type SuggestAdjacentResult = {
  createdCount: number
  promptVersion: number
  rawText: string
}

export async function suggestAdjacentReferenceTracks(opts: { icpId: string }): Promise<SuggestAdjacentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [icp, existing] = await Promise.all([
    prisma.iCP.findUniqueOrThrow({ where: { id: opts.icpId } }),
    prisma.referenceTrack.findMany({
      where: { icpId: opts.icpId },
      select: { artist: true, title: true, year: true, bucket: true, status: true },
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
  ]
    .filter(Boolean)
    .join('\n')

  // Group existing tracks by bucket so the model can read each leg of the core
  // taste pool separately. Adjacent is defined against the union of the three.
  const groups: Record<'FormationEra' | 'Subculture' | 'Aspirational' | 'Adjacent', { artist: string; title: string; year: number | null; status: string }[]> = {
    FormationEra: [],
    Subculture: [],
    Aspirational: [],
    Adjacent: [],
  }
  for (const r of existing) {
    groups[r.bucket as keyof typeof groups]?.push({ artist: r.artist, title: r.title, year: r.year, status: r.status })
  }

  const fmt = (rows: { artist: string; title: string; year: number | null; status: string }[]) =>
    rows.length === 0 ? '(none)' : rows.map((r) => `- ${r.artist} – ${r.title}${r.year ? ` (${r.year})` : ''}${r.status === 'approved' ? '' : ` [${r.status}]`}`).join('\n')

  const userMessage = `# ICP

${icpDescriptor}

# Existing reference tracks (do not repeat any of these as Adjacent picks)

## FormationEra
${fmt(groups.FormationEra)}

## Subculture
${fmt(groups.Subculture)}

## Aspirational
${fmt(groups.Aspirational)}

## Adjacent (already proposed/approved — avoid duplicating)
${fmt(groups.Adjacent)}

# Task

Propose 8–12 Adjacent reference tracks for this ICP. Each rationale must be a
concrete bridge sentence naming the shared quality with the ICP's core taste.
Output JSON only.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: [{ type: 'text', text: ADJACENT_PROMPT_V1, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((b: any) => b.type === 'text') as any
  if (!textBlock?.text) throw new Error('Adjacent suggester returned no text')
  const raw = textBlock.text as string

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in adjacent suggester output')
  const parsed = JSON.parse(cleaned.slice(start)) as Record<string, unknown>

  const norm = (arr: unknown): SuggestedAdjacentTrack[] => {
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
      .filter((r): r is SuggestedAdjacentTrack => r !== null)
  }

  const picks = norm(parsed.Adjacent)

  // Dedup case-insensitively against everything already on the ICP.
  const existingKey = new Set(existing.map((e) => `${e.artist.toLowerCase()}::${e.title.toLowerCase()}`))
  const now = new Date()
  const rows: { icpId: string; bucket: 'Adjacent'; artist: string; title: string; year: number | null; suggestedRationale: string | null; suggestedPromptVer: number; suggestedAt: Date }[] = []
  for (const s of picks) {
    const key = `${s.artist.toLowerCase()}::${s.title.toLowerCase()}`
    if (existingKey.has(key)) continue
    existingKey.add(key)
    rows.push({
      icpId: opts.icpId,
      bucket: 'Adjacent',
      artist: s.artist,
      title: s.title,
      year: s.year,
      suggestedRationale: s.rationale,
      suggestedPromptVer: ADJACENT_PROMPT_VERSION,
      suggestedAt: now,
    })
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
    promptVersion: ADJACENT_PROMPT_VERSION,
    rawText: raw,
  }
}
