// Reference Track Suggester — proposes reference tracks for an ICP using Claude.
// The system prompt comes from ReferenceTrackPrompt.templateText (global,
// editable in the admin Engine tab). The user message bundles the ICP's
// psychographic profile. Output is grouped by bucket: PreFormation,
// FormationEra, Subculture, Aspirational, Adjacent.
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

Five buckets. The first four describe *who the ICP is*. The fifth (Adjacent)
is structurally different and requires extra reasoning — see its section below.

- **PreFormation** — canonical pre-formation classics that fit the ICP's
  socio-economic strata growing up. Cross-generational hits the ICP absorbed
  before their own formation years (parents' records, older siblings'
  rotation, household radio). Anchor against the parents' own formation era —
  roughly 20–35 years before the ICP's birth — filtered by the household's
  class register and cultural lane. Must be vocal tracks the ICP would
  recognize from childhood without owning.

- **FormationEra** — songs the ICP heard during their musical formation years
  (roughly ages 12–22). Nostalgic, identity-defining. Use the ICP's age range
  to anchor the era. These should be tracks they would name without prompting.

- **Subculture** — songs that signal in-group membership for the ICP's tribe,
  scene, or cultural cohort. Less mainstream, more identity-as-marker. The ICP
  uses these to recognize "their people."

- **Aspirational** — songs that represent who the ICP wants to be or is becoming.
  Often slightly outside their formation — a sound they admire, gravitate
  toward, or use to signal upward mobility / refinement / depth.

- **Adjacent** — *the fifth move*. Songs the ICP would unexpectedly enjoy that
  sit OFF-AXIS from their core taste, not next-door to it. These are NOT more
  picks like the PreFormation/FormationEra/Subculture/Aspirational ones — they
  are texture variation that resets the ear in a good way. See "Adjacent
  reasoning" below.

## Selection rules (apply to all four buckets)

- Real songs only. Real artists, real titles. No fabrication.
- Vary across each bucket — don't return multiple songs by the same artist.
- Lean specific over generic. "Steely Dan – Peg" beats "a yacht rock track."
- Avoid the obvious clichés of the genre unless they genuinely fit this ICP.
- Year is the original release year, not a re-release.
- Avoid anything already in the ICP's existing tracks (listed in the user message).

## **VOCAL TRACKS ONLY — no instrumentals**

Every reference track you propose must have a vocal lead. Entuned's downstream
pipeline pairs each reference track with a lyric hook to generate a vocal-bearing
cousin track. Instrumental references break that pipeline because the generated
cousin would inherit "no vocals" from the style profile while needing to deliver
the lyric hook in its chorus.

This rule applies to all five buckets, but it bites hardest in Adjacent — many
of the most interesting "sophistication-adjacent" or "modern composition" picks
are instrumentals. **Do not propose them.** Instead, find a vocal-bearing
analogue that occupies the same texture space:

- NOT Bill Evans Trio — instead Cassandra Wilson with sparse jazz backing
- NOT Max Richter or Nils Frahm — instead Anohni or Sufjan Stevens' orchestral work
- NOT Pat Metheny instrumental — instead Lyle Mays' vocal work, or Astrud Gilberto with bossa-jazz backing
- NOT Brian Eno's Music for Airports — instead a vocal track with similar ambient production
- NOT Floating Points instrumental — instead Sault, Hiatus Kaiyote, or another vocal track with similar electronic-jazz hybridity
- NOT Ryuichi Sakamoto's solo piano — instead his vocal collaborations or a vocal artist with similar minimalism

If a track is famous in its instrumental form (most film scores, modern classical,
solo jazz piano, ambient electronic, post-rock), it is OUT regardless of how
well it would otherwise fit the vector. Find the vocal-bearing analogue.

A track counts as "vocal" if a singer carries the melody for the majority of
the song. Brief vocal samples (chants, spoken-word interjections, "vocal as
texture") do not count. The track must have lyrics that a listener could sing
along to.

## Adjacent reasoning (mandatory if you produce any Adjacent picks)

Adjacency is a vector, not a vibe. Naive prompts collapse Adjacent picks to the
centroid: songs that slide along the same axis as the existing pool, just
shifted slightly older or slightly more obscure. *Patron saints* of the
dominant cluster. That is not adjacency — that is deeper into the centroid.

You will not do that. Here's how:

1. **Identify the dominant cluster** across both (a) the existing tracks listed
   in the user message and (b) the PreFormation/FormationEra/Subculture/Aspirational
   picks you are proposing in this same response. What genre/era/affect dominates?
   Name it explicitly.

2. **Forbid yourself from picking inside that cluster, including its patron
   saints.** If the cluster is "acoustic singer-songwriter / Americana
   introspection," then Nick Drake / Townes Van Zandt / Gillian Welch are OUT.
   They're the centroid of that neighborhood, not a move away from it.

3. **Make moves that hold one axis constant and break a different axis.** Each
   Adjacent pick should differ from the cluster on a NAMED axis while sharing
   a different one. Examples (do not copy — derive your own):

   - Genre that contradicts a stated turn-off but lands on the same affect
     (breaks: genre. holds: affect.)
   - Sophistication-adjacent without their formation context (breaks: era +
     cultural origin. holds: production quality + emotional intelligence.)
   - More produced/textured than their stripped-back core (breaks: density.
     holds: emotional register.)
   - Cross a cultural/demographic assumption (breaks: assumed-listener-profile.
     holds: actual quality of feel.)
   - Same emotional register, totally different genre vocabulary (breaks:
     instrumentation + scene. holds: emotional shape.)

4. **The right test is "stranger trust," not "they'd recognize themselves."**
   Forget "would they recognize themselves" — that pulls toward the centroid.
   Instead: what would a friend with broader taste than them put on at a
   dinner party that would make them go "huh, what IS this?" — interested,
   not confused, not annoyed? That friend swerves but swerves with knowledge.

## Adjacent anti-patterns — do NOT do these

- DO NOT pick patron saints of the dominant cluster (see rule 2).
- DO NOT pick songs that are obvious "if you like X you'll like Y" upgrades.
  ("They like John Mayer so they'll like Mark Knopfler" is not adjacency.
  It's just a refined-John-Mayer pick.)
- DO NOT lean entirely on artists from the same culture, era, and gender as
  the existing pool. Spread.
- DO NOT pick tracks that violate a stated turn-off — but DO be precise about
  what the turn-off actually rules out. ("Aggressive bro-energy gym culture"
  rules out aggressive bro-energy. It does not rule out all electronic music.)
- DO NOT have all Adjacent picks come from the same vector — spread across
  the 4-5 vectors you declare.

## Bridge sentence (Adjacent only — closing audit, not search criterion)

For each Adjacent pick, write the rationale as a bridge sentence that names
the axis broken and the axis held. Pattern: "[axis broken]: [what about ICP]
meets [what about pick] via [the held axis]." Bad: "would expand their
horizons." Good: "Cultural-assumption break: a 50-something Black professional
whose stated profile suggests Americana / soul meets London trip-hop's
late-90s moody-sophisticated atmosphere via the same patient male
introspection that anchors his Iron & Wine and Leon Bridges picks."

If the bridge sentence is boring, the underlying pick is too safe — pick
something bolder.

## Output

JSON only, no prose, no markdown fences:

{
  "PreFormation": [{ "artist": "...", "title": "...", "year": 1965, "rationale": "..." }, ...],
  "FormationEra": [{ "artist": "...", "title": "...", "year": 1978, "rationale": "..." }, ...],
  "Subculture":   [{ "artist": "...", "title": "...", "year": 1995, "rationale": "..." }, ...],
  "Aspirational": [{ "artist": "...", "title": "...", "year": 2015, "rationale": "..." }, ...],
  "dominant_cluster_in_pool": "one sentence naming the cluster you identified across existing + your PreFormation/FormationEra/Subculture/Aspirational picks",
  "adjacency_vectors": [
    { "name": "short label", "axis_broken": "...", "axis_held": "...", "rationale_for_this_icp": "one sentence on why this vector for THIS ICP" },
    ... (4-5 vectors)
  ],
  "Adjacent": [
    { "artist": "...", "title": "...", "year": 1978, "vector": "label of one of the vectors above", "rationale": "bridge sentence" },
    ... (8-12 picks, spread across the vectors)
  ]
}

Return 4–6 candidates each for PreFormation / FormationEra / Subculture /
Aspirational, and 8–12 for Adjacent. Each rationale is one short sentence
(the PreFormation / FormationEra / Subculture / Aspirational rationale =
"why this song for this ICP in this bucket"; the Adjacent rationale = the
bridge sentence pattern above).

If the existing pool is empty (first run for this ICP), the dominant cluster
is whatever forms across the PreFormation/FormationEra/Subculture/Aspirational
picks you're proposing in this same response. Reason about that cluster and
pick Adjacent picks off-axis from it.
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

Propose reference tracks for this ICP across all five buckets (PreFormation,
FormationEra, Subculture, Aspirational, Adjacent). Identify the dominant cluster
across the existing pool plus your PreFormation/FormationEra/Subculture/Aspirational
picks, declare adjacency vectors, then pick Adjacent picks off-axis from that
cluster. Output JSON only.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
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

  type Bucket = 'PreFormation' | 'FormationEra' | 'Subculture' | 'Aspirational' | 'Adjacent'
  const grouped: Record<Bucket, SuggestedRefTrack[]> = {
    PreFormation: norm(parsed.PreFormation),
    FormationEra: norm(parsed.FormationEra),
    Subculture: norm(parsed.Subculture),
    Aspirational: norm(parsed.Aspirational),
    Adjacent: norm(parsed.Adjacent),
  }

  // Dedup against existing tracks (by case-insensitive artist+title), then persist
  // as pending ReferenceTrack rows so operators can navigate away without losing
  // suggestions.
  const existingKey = new Set(existing.map((e) => `${e.artist.toLowerCase()}::${e.title.toLowerCase()}`))
  const now = new Date()
  const rows: { icpId: string; bucket: Bucket; artist: string; title: string; year: number | null; suggestedRationale: string | null; suggestedPromptVer: number; suggestedAt: Date }[] = []
  for (const bucket of ['PreFormation', 'FormationEra', 'Subculture', 'Aspirational', 'Adjacent'] as const) {
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
