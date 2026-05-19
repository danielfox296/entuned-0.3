// Trigger Monitor — daily web-search for warm-outreach moments.
//
// Runs a set of Google search queries (via SerpApi if SERPAPI_KEY is set,
// otherwise via the official Anthropic web_search tool which is offered as
// a server-tool from the SDK), categorizes each hit, drafts context-aware
// outreach, and writes a QueueItem.
//
// v1 takes the SerpApi fallback path: most Google-result scrapers get blocked
// fast and the official Anthropic web_search tool requires a paid tier — we
// keep it pluggable so Daniel can swap in whichever lever is cheapest later.
// If neither key is configured, the worker returns a "no_search_provider"
// result without throwing — the cron survives until search is wired.
//
// Spec: ../../../morning-command-center-spec.md §SYSTEM 6
// Schedule: daily at 7am MT.

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { prisma } from '../db.js'
import {
  triggerQueries,
  TRIGGER_CATEGORIES,
  type TriggerCategory,
} from '../lib/command-center-config.js'

const MODEL = process.env.TRIGGER_MONITOR_MODEL ?? 'claude-sonnet-4-6'
const MAX_RESULTS_PER_QUERY = 5
const MAX_DRAFTS_PER_RUN = 15

const SYSTEM_PROMPT = `
You categorize web-search results into trigger types and draft warm-outreach
context for Daniel Fox.

Daniel works the floor at a retail clothing store in Denver. He's a music
producer and founder of Entuned (in-store music AI). He uses this to spot
moments where reaching out is a kindness rather than a pitch — new stores
opening, podcasts about retail audio, competitor complaints.

For each search result you process, output:
  triggerType: one of new_store | renovation | podcast_episode | competitor_mention | press | event
  businessName: best guess at the business name, or null
  location: best guess at city/state, or null
  whyWarm: ONE sentence explaining why this is a good moment to reach out
  draft: a 80-150 word outreach paragraph in Daniel's voice — congratulatory
    if a new store, curious if a podcast, sympathetic if a competitor complaint.
    NO sales pitch. Just a warm, specific, personal note.

Voice rules:
- Casual, warm, sounds like a real person typed it fast.
- Specific to what they posted. Show you read it.
- Never use: leverage, utilize, streamline, ROI, drive sales, opportunity.

If a result is irrelevant (not actually a retail trigger), output triggerType="skip".
`.trim()

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchProvider {
  search(query: string, limit: number): Promise<SearchResult[]>
}

// SerpApi adapter. https://serpapi.com/search?engine=google&q=...&api_key=...
// Free tier gives 100 searches/month — enough for a daily run hitting 6 queries.
export class SerpApiProvider implements SearchProvider {
  constructor(private apiKey: string) {}
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://serpapi.com/search?engine=google&q=${encodeURIComponent(query)}&num=${limit}&api_key=${this.apiKey}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`SerpApi ${res.status}`)
    const data = (await res.json()) as { organic_results?: { title: string; link: string; snippet?: string }[] }
    return (data.organic_results ?? []).slice(0, limit).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
    }))
  }
}

interface CategorizedHit {
  triggerType: TriggerCategory | 'skip'
  businessName: string | null
  location: string | null
  whyWarm: string
  draft: string
}

export async function categorizeHit(
  client: Anthropic,
  query: string,
  hit: SearchResult,
): Promise<CategorizedHit | null> {
  const userMessage = `
Search query: ${query}
Result title: ${hit.title}
Result URL: ${hit.url}
Snippet: ${hit.snippet}

Categorize and draft. Output JSON only:
{ "triggerType": "...", "businessName": "..." | null, "location": "..." | null, "whyWarm": "...", "draft": "..." }
  `.trim()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    temperature: 0.5,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  const raw = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned) as CategorizedHit
  } catch {
    return null
  }
}

export interface TriggerResult {
  queries: number
  hits: number
  drafted: number
  queued: number
  skipped: number
  noSearchProvider?: boolean
}

export async function runTriggerMonitor(opts?: {
  apiKey?: string
  provider?: SearchProvider
  now?: Date
}): Promise<TriggerResult> {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  const client = new Anthropic({ apiKey })
  const now = opts?.now ?? new Date()

  let provider = opts?.provider
  if (!provider) {
    const serp = process.env.SERPAPI_KEY
    if (serp) provider = new SerpApiProvider(serp)
  }
  if (!provider) {
    return { queries: 0, hits: 0, drafted: 0, queued: 0, skipped: 0, noSearchProvider: true }
  }

  const queries = triggerQueries(now)
  let totalHits = 0
  let drafted = 0
  let queued = 0
  let skipped = 0

  for (const q of queries) {
    let hits: SearchResult[]
    try {
      hits = await provider.search(q, MAX_RESULTS_PER_QUERY)
    } catch (e) {
      console.warn(`[trigger-monitor] search failed: ${(e as Error).message}`)
      continue
    }
    totalHits += hits.length
    for (const hit of hits) {
      if (drafted >= MAX_DRAFTS_PER_RUN) break

      const externalId = `trigger:${createHash('sha1').update(hit.url).digest('hex').slice(0, 24)}`
      const existing = await prisma.queueItem.findUnique({ where: { externalId } })
      if (existing) { skipped++; continue }

      let cat: CategorizedHit | null
      try {
        cat = await categorizeHit(client, q, hit)
        drafted++
      } catch (e) {
        console.warn(`[trigger-monitor] categorize failed: ${(e as Error).message}`)
        continue
      }
      if (!cat || cat.triggerType === 'skip') { skipped++; continue }
      if (!(TRIGGER_CATEGORIES as readonly string[]).includes(cat.triggerType)) { skipped++; continue }

      await prisma.queueItem.create({
        data: {
          type: 'trigger',
          subtype: cat.triggerType,
          status: 'pending',
          priority: 40,
          title: `${cat.triggerType}: ${cat.businessName ?? hit.title.slice(0, 80)}`,
          draftContent: cat.draft,
          sourceUrl: hit.url,
          externalId,
          payload: {
            triggerType: cat.triggerType,
            businessName: cat.businessName,
            location: cat.location,
            sourceTitle: hit.title,
            sourceSnippet: hit.snippet,
            whyWarm: cat.whyWarm,
          },
        },
      })
      queued++
    }
  }

  return { queries: queries.length, hits: totalHits, drafted, queued, skipped }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runTriggerMonitor()
    .then((r) => console.log('[trigger-monitor] done', r))
    .catch((err) => {
      console.error('[trigger-monitor] failed', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
