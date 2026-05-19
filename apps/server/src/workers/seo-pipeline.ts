// SEO Pipeline — keyword-cluster blog post drafter.
//
// Walks SEO_CLUSTERS (config), checks ContentPiece coverage by narrative +
// keyword tag, and drafts blog posts for uncovered keywords via Claude
// in Daniel's voice with relevant proof points woven in.
//
// Coverage is "fuzzy" — we tag each ContentPiece with the keyword as a
// suffix on the narrative slug (`narrative-keyword`), so dropping a new
// keyword into the config and re-running picks up the gap without a
// migration.
//
// Spec: ../../../morning-command-center-spec.md §SYSTEM 4
// Schedule: weekly (Tuesday 7am) or on-demand.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import {
  SEO_CLUSTERS,
  FORMAT_CONSTRAINTS,
  type Narrative,
} from '../lib/command-center-config.js'

const MODEL = process.env.SEO_PIPELINE_MODEL ?? 'claude-sonnet-4-6'
const MAX_GENERATIONS_PER_RUN = 8 // SEO drafts are 1000+ words — burn tokens fast.

const SYSTEM_PROMPT = `
You write blog posts in Daniel Fox's voice.

Daniel works the floor at a retail clothing store in Denver. He built Entuned —
an AI that composes original music for retail stores. He writes the way
someone who actually works the floor talks, not the way a content team writes.

Blog post rules:
- 1000-1400 words.
- Story-driven. Open with a concrete moment, not "In today's competitive
  retail landscape...".
- Concrete details. "She grabbed another shirt off the rack" beats
  "increased purchase behavior."
- Specific numbers credible. 18% to 28% conversion. 4 hour loop for 18 months.
- Target the keyword naturally — never stuff. Use it 2-4 times.
- Include 1-2 proof points provided in the user message.
- Optional subheads (## level 2) at natural pivots. Don't manufacture them.
- End with an honest, low-pressure pointer to Entuned. Not a CTA. A note.
- Never use: leverage, utilize, streamline, game-changer, ROI, drive sales,
  unlock, empower, revolutionary, disrupt, solution.

The user message gives you the keyword, the narrative, and the proof points.
Output JSON with exactly:
  title: (string, <80 chars)
  metaDescription: (string, <160 chars)
  body: (markdown, the blog post)
Output ONLY the JSON object. No other text.
`.trim()

export interface SeoPipelineResult {
  generated: number
  skipped: number
  failed: number
}

interface DraftedPost {
  title: string
  metaDescription: string
  body: string
}

export async function draftBlogPost(
  client: Anthropic,
  narrative: Narrative,
  keyword: string,
  proofPoints: { label: string; quoteText: string; attribution: string }[],
): Promise<DraftedPost | null> {
  const userMessage = `
Keyword: ${keyword}
Narrative cluster: ${narrative}
Format: blog
Constraint: ${FORMAT_CONSTRAINTS.blog.maxWords} words max
Style: ${FORMAT_CONSTRAINTS.blog.style}

Proof points (use one or two):
${proofPoints.map((p) => `- ${p.label}: "${p.quoteText}" — ${p.attribution}`).join('\n') || '(none — write from the narrative alone)'}

Write the post. Output JSON only.
  `.trim()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    temperature: 0.6,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })
  const raw = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as DraftedPost
    if (!parsed.title || !parsed.body) return null
    return parsed
  } catch {
    return null
  }
}

export async function runSeoPipeline(opts?: {
  apiKey?: string
  /** Limit to a specific narrative cluster (default: all). */
  narratives?: Narrative[]
  /** Pre-loaded proof points (mainly for tests). */
}): Promise<SeoPipelineResult> {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  const client = new Anthropic({ apiKey })

  const proofPoints = await prisma.proofPoint.findMany({
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { label: true, quoteText: true, attribution: true },
  })

  // Existing coverage: any ContentPiece with format=blog and narrative that
  // matches our `<cluster>:<keyword>` pattern counts.
  const existing = await prisma.contentPiece.findMany({
    where: { format: 'blog' },
    select: { narrative: true, title: true },
  })
  const covered = new Set(existing.map((e) => e.narrative))

  let generated = 0
  let skipped = 0
  let failed = 0

  const clusters = opts?.narratives
    ? opts.narratives.filter((n): n is Narrative => n in SEO_CLUSTERS)
    : (Object.keys(SEO_CLUSTERS) as Narrative[])

  for (const cluster of clusters) {
    const keywords = SEO_CLUSTERS[cluster]
    for (const kw of keywords) {
      // Compose a per-keyword narrative slug so each keyword writes a
      // distinct ContentPiece row even within the same cluster.
      const narrativeSlug = `${cluster}:${kw.replace(/\s+/g, '-').toLowerCase()}`
      if (covered.has(narrativeSlug)) { skipped++; continue }
      if (generated >= MAX_GENERATIONS_PER_RUN) {
        return { generated, skipped, failed }
      }
      try {
        const post = await draftBlogPost(client, cluster, kw, proofPoints)
        if (!post) { failed++; continue }
        await prisma.contentPiece.create({
          data: {
            proofPointId: null,
            narrative: narrativeSlug,
            format: 'blog',
            title: post.title,
            body: post.body,
            status: 'draft',
          },
        })
        generated++
      } catch (e) {
        console.warn(`[seo-pipeline] ${narrativeSlug} failed: ${(e as Error).message}`)
        failed++
      }
    }
  }

  return { generated, skipped, failed }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runSeoPipeline()
    .then((r) => console.log('[seo-pipeline] done', r))
    .catch((err) => {
      console.error('[seo-pipeline] failed', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
