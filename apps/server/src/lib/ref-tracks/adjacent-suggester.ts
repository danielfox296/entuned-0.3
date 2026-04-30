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

export const ADJACENT_PROMPT_VERSION = 2

export const ADJACENT_PROMPT_V2 = `
You're suggesting "Adjacent" reference tracks for an ICP. The other three buckets
(FormationEra, Subculture, Aspirational) are already populated and visible to you
in the user message. Adjacent tracks are the *fourth move* — songs the ICP would
unexpectedly enjoy that sit OFF-AXIS from their core taste, not next-door to it.

## What went wrong on the previous attempt — read this first

Asked to find "tracks the ICP would unexpectedly enjoy," the model picked songs
that were sliding moves along the same axis as the existing pool — same genre
neighborhood, same emotional register, same production era, just shifted
slightly older or slightly more obscure. Patron saints of the dominant cluster.
That is not adjacency. That is *deeper into the centroid*.

You will not do that. The way you avoid it:

1. **Identify the dominant cluster in the existing tracks.** Look at the
   FormationEra/Subculture/Aspirational picks listed in the user message. What
   genre/era/affect dominates? Name it explicitly in your thinking. (Example:
   "the existing pool clusters heavily on acoustic singer-songwriter +
   plainspoken male soul + Americana introspection.")
2. **Forbid yourself from picking inside that cluster.** Including its patron
   saints. If the cluster is acoustic singer-songwriter, Nick Drake is OUT.
   Townes Van Zandt is OUT. Gillian Welch is OUT. They are the centroid of
   that neighborhood, not a move away from it.
3. **Make moves that hold one axis constant and break a different axis.**
   Adjacency is a vector, not a vibe. Each pick should differ from the core
   pool on a NAMED axis while sharing a different one.

## The right test: "stranger trust"

Forget "would they recognize themselves." That test pulls toward the centroid.
Instead: *what would a friend with broader taste than them put on at a dinner
party that would make them go "huh, what IS this?" — interested, not confused,
not annoyed? What's the move they'd never name in a survey but absolutely love
when their well-curated friend puts it on?*

That friend doesn't stay in the lane the ICP already drives in. That friend
swerves — but swerves with knowledge of who the ICP is.

## Adjacency vectors — pick 4-5, then search inside each

Before picking any tracks, declare 4-5 distinct *adjacency vectors* you'll
explore. Each vector names ONE axis you're breaking and ONE axis you're holding.
Examples (do not copy these — derive your own from THIS ICP):

- "Genre that contradicts a stated turn-off but lands on the same affect as
  their core" (breaks: genre. holds: affect.) — a soul listener with a stated
  turn-off of country might love alt-country produced with care (Charley
  Crockett), because the *patient lived-in masculine truth-telling* is the
  same.
- "Sophistication-adjacent without their formation context" (breaks: era +
  cultural origin. holds: production quality + emotional intelligence.) — for
  a guy whose pool is 70s soul + 90s singer-songwriter, modern composition
  (Max Richter) or instrumental jazz fusion (Pat Metheny) reads as quality
  bar matched, vocabulary completely different.
- "More produced/textured than their stripped-back core" (breaks: density +
  production. holds: emotional register.) — sophisti-pop (late Roxy Music,
  Sade), trip-hop (Portishead, Massive Attack), or atmospheric neo-soul that's
  more produced than what they already listen to.
- "Cross a cultural/demographic assumption" (breaks: assumed-listener-profile.
  holds: actual quality of feel.) — picks that cut against the demographic
  cliche about who listens to what. The Black professional who turns out to
  love Iron & Wine. The Americana listener who turns out to love trip-hop.
- "Same emotional register, totally different genre vocabulary" (breaks:
  instrumentation + scene. holds: emotional shape of the song.) — if their
  core is "introspective male voice + acoustic," try "introspective male voice
  + late-night jazz" (Chet Baker), or "introspective + electronic" (Bonobo,
  Cinematic Orchestra).

Your vectors don't have to match these. But each one must NAME the axis broken
and the axis held. "Adjacent in vibe" is not a vector — it's mush. Reject mush.

## Anti-patterns — do NOT do these

- DO NOT pick patron saints of the dominant cluster. (If the pool is heavy on
  acoustic singer-songwriter, Nick Drake / Townes Van Zandt / Gillian Welch
  are forbidden — they're the centroid.)
- DO NOT pick songs that are obvious "if you like X you'll like Y" upgrades.
  ("They like John Mayer so they'll like Mark Knopfler" is not adjacency. It's
  just a refined-John-Mayer pick.)
- DO NOT lean entirely on artists from the same culture, era, and gender as
  the existing pool. If the pool is mostly 60s-90s American/UK male
  singer-songwriters, that means at most a couple of your picks should be
  60s-90s American/UK male singer-songwriters.
- DO NOT picks tracks that violate a stated turn-off. (Read the turn-offs
  carefully. A pick that crosses a turn-off isn't adjacent, it's wrong.) BUT —
  do not over-correct. Many turn-offs are about a *style* or *affect* the ICP
  rejects, not the entire genre. ("Aggressive bro-energy gym culture" rules
  out aggressive bro-energy. It does not rule out all electronic music. Be
  precise about what's actually being turned off.)
- DO NOT all pick from the same vector. Spread across all 4-5 you declared.

## Selection rules

- Real songs only. Real artists, real titles. No fabrication.
- Year is the original release year, not a re-release.
- Avoid anything already in the ICP's existing tracks (listed in the user message).
- Don't return multiple songs by the same artist.

## Bridge sentence (audit, NOT search criterion)

After you've picked tracks via vector exploration, write the bridge sentence
for each as a closing audit. Pattern: "[axis broken]: [what about ICP] meets
[what about pick] via [the held axis]." Bad: "would expand their horizons."
Good: "Cultural-assumption break: a 50-something Black professional whose
stated profile suggests Americana / soul meets London trip-hop's late-90s
moody-sophisticated atmosphere via the same patient male introspection that
anchors his Iron & Wine and Leon Bridges picks."

The bridge is for the operator's audit, not for your search. If the underlying
pick is bold, the bridge will be interesting. If the underlying pick is safe,
the bridge will reveal that — which means you should pick something bolder.

## Output format

JSON only, no prose, no markdown fences:

\`\`\`
{
  "dominant_cluster_in_existing_pool": "one sentence naming what dominates",
  "adjacency_vectors": [
    { "name": "short label", "axis_broken": "...", "axis_held": "...", "rationale_for_this_icp": "one sentence on why this vector for THIS ICP" },
    ... (4-5 vectors)
  ],
  "Adjacent": [
    { "artist": "...", "title": "...", "year": 1978, "vector": "label of one of the vectors above", "rationale": "bridge sentence per the pattern above" },
    ... (8-12 picks, spread across the vectors — at least one per vector, ideally 2-3 per vector)
  ]
}
\`\`\`
`.trim()

export type SuggestedAdjacentTrack = {
  artist: string
  title: string
  year: number | null
  rationale: string | null
}

export type AdjacencyVector = {
  name: string
  axisBroken: string | null
  axisHeld: string | null
  rationale: string | null
}

export type SuggestAdjacentResult = {
  createdCount: number
  promptVersion: number
  rawText: string
  dominantCluster: string | null
  vectors: AdjacencyVector[]
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
    max_tokens: 4000,
    system: [{ type: 'text', text: ADJACENT_PROMPT_V2, cache_control: { type: 'ephemeral' } }],
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

  const normVectors = (arr: unknown): AdjacencyVector[] => {
    if (!Array.isArray(arr)) return []
    return arr
      .map((row: any) => {
        if (!row || typeof row !== 'object') return null
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        if (!name) return null
        const axisBroken = typeof row.axis_broken === 'string' ? row.axis_broken.trim() : null
        const axisHeld = typeof row.axis_held === 'string' ? row.axis_held.trim() : null
        const rationale = typeof row.rationale_for_this_icp === 'string' ? row.rationale_for_this_icp.trim() : null
        return { name, axisBroken, axisHeld, rationale }
      })
      .filter((v): v is AdjacencyVector => v !== null)
  }

  const picks = norm(parsed.Adjacent)
  const vectors = normVectors(parsed.adjacency_vectors)
  const dominantCluster = typeof parsed.dominant_cluster_in_existing_pool === 'string'
    ? (parsed.dominant_cluster_in_existing_pool as string).trim()
    : null

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
    dominantCluster,
    vectors,
  }
}
