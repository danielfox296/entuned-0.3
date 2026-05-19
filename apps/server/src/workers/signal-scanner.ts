// Signal Scanner — Reddit buying-signal hunter.
//
// Hits Reddit's public JSON endpoint for each target subreddit, scores
// every recent post on keyword density + engagement + freshness, drafts a
// reply via Claude in Daniel's voice, and writes a QueueItem with
// externalId = Reddit post id so re-runs don't duplicate.
//
// Spec: ../../../morning-command-center-spec.md §SYSTEM 1
//
// Schedule:  every 4 hours via cron (see env SIGNAL_SCANNER_CRON or
//            crontab on Daniel's machine — keep local-cron for now,
//            consider Railway only if reliability matters).
//
// Cost guard: the worker calls Claude once per matched post, capped at
// MAX_DRAFTS_PER_RUN so a flood of low-quality matches can't burn the
// API budget. Items scoring below MIN_SCORE_FOR_DRAFT skip the LLM call
// and queue with no draft (the spec routes them to System 7 / community).
//
// Idempotency: POST /command-center/queue handles externalId collisions
// by returning the existing row. We use the same logic inline here since
// the worker writes directly via prisma.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import {
  SIGNAL_KEYWORDS,
  SIGNAL_SUBREDDITS,
  SIGNAL_MAX_AGE_HOURS,
  MIN_SCORE_FOR_PITCH_DRAFT,
  MIN_SCORE_FOR_HELPFUL_DRAFT,
} from '../lib/command-center-config.js'

const MODEL = process.env.SIGNAL_SCANNER_MODEL ?? 'claude-sonnet-4-6'
const MAX_DRAFTS_PER_RUN = 40

// Used for high-relevance buying-signal posts (score ≥ 50). Mention of
// Entuned is allowed when natural. Output is a draft Daniel can copy and
// paste; Claude can output "SKIP" if the post is unrelated.
const PITCH_SYSTEM_PROMPT = `
You are drafting a Reddit reply for Daniel Fox. Daniel works the floor at a
retail clothing store in Denver. He's also a music producer and the founder
of Entuned — an AI that composes original music for retail stores.

Reply rules:
- Genuinely helpful first. Answer the person's actual question before anything else.
- Casual, warm, sounds like a real person typed it fast. Lowercase ok, mild typos ok.
- Mention Entuned ONLY if it's natural and relevant. Many replies should not mention it.
- Short. 2-4 sentences. No bullet points. No headers. No sign-off.
- Never use "leverage", "utilize", "streamline", "game-changer", "ROI", "drive sales".
- Write like someone who actually works in a store, not a SaaS founder.
- If the post is unrelated, off-topic, or impossible to add value to, output
  exactly "SKIP" and nothing else.
`.trim()

// Used for topically-adjacent posts (score 20-49). Explicit no-pitch lane —
// Daniel shows up as the store-floor guy who knows stuff. The goal is
// presence + reciprocity, not lead capture. NEVER mentions Entuned.
const HELPFUL_SYSTEM_PROMPT = `
You are drafting a Reddit reply for Daniel Fox. Daniel works the floor at a
retail clothing store in Denver and is a music producer.

This reply is in the HELPFUL lane — NEVER mention Entuned, music software,
SaaS, your product, or any company. This is purely about being a useful
voice on Reddit so people recognize Daniel's username over time.

Reply rules:
- Just answer their question from your real experience working a retail floor.
- Casual, warm, sounds like a real person typed it fast. Lowercase ok, typos ok.
- Short. 1-3 sentences. No bullet points. No headers. No sign-off.
- Never use "leverage", "utilize", "streamline", "game-changer", "ROI".
- Write like someone who's lived through what they're asking about.
- If the post is unrelated to retail / small business / staff / customers
  / music / in-store experience, output exactly "SKIP".
`.trim()

interface RedditPost {
  id: string // base36 post id (we use the full t3_<id> as externalId)
  permalink: string
  title: string
  selftext: string
  author: string
  created_utc: number
  ups: number
  num_comments: number
  subreddit: string
}

interface ScannerResult {
  matched: number
  drafted: number
  queued: number
  skipped: number
}

// Public Reddit JSON. Without auth we get ~60 req/min — fine for our cadence.
// The user-agent is required (Reddit returns 429 with a generic UA).
const UA = 'entuned-signal-scanner/0.1 (by /u/danielchristopherfox)'

export async function fetchSubredditNew(subreddit: string, limit = 25): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) {
    if (res.status === 429) {
      console.warn(`[signal-scanner] rate-limited on r/${subreddit}`)
      return []
    }
    throw new Error(`Reddit ${subreddit} returned ${res.status}`)
  }
  const data = (await res.json()) as {
    data?: { children?: { data: RedditPost }[] }
  }
  return (data.data?.children ?? []).map((c) => c.data)
}

// Score: 0-100. Weighted toward keyword density in title (highest signal),
// then body, then engagement, then freshness. Old posts (>24h) get heavily
// penalized — a 3-day-old thread is dead.
export function scoreRelevance(post: RedditPost, now: Date = new Date()): {
  score: number
  matched: string[]
} {
  const titleLower = post.title.toLowerCase()
  const bodyLower = post.selftext.toLowerCase()
  const matched: string[] = []
  let titleHits = 0
  let bodyHits = 0
  for (const kw of SIGNAL_KEYWORDS) {
    const lower = kw.toLowerCase()
    if (titleLower.includes(lower)) {
      titleHits++
      matched.push(kw)
    } else if (bodyLower.includes(lower)) {
      bodyHits++
      matched.push(kw)
    }
  }
  if (titleHits === 0 && bodyHits === 0) return { score: 0, matched: [] }

  const ageHours = (now.getTime() - post.created_utc * 1000) / (1000 * 60 * 60)
  const freshness =
    ageHours < 6 ? 1.0 :
    ageHours < 12 ? 0.85 :
    ageHours < 24 ? 0.7 :
    ageHours < 48 ? 0.4 : 0.15

  const engagement = Math.min(1, Math.log10(post.ups + post.num_comments + 2) / 2)

  const base = titleHits * 30 + bodyHits * 15
  const score = Math.min(100, Math.round(base * freshness * (0.6 + 0.4 * engagement)))
  return { score, matched }
}

export type ReplyLane = 'pitch' | 'helpful'

export interface DraftReplyInput {
  postTitle: string
  postBody: string
  subreddit: string
  matchedKeywords: string[]
  lane: ReplyLane
}

export async function draftReply(
  client: Anthropic,
  input: DraftReplyInput,
): Promise<string | null> {
  const userMessage = `
Subreddit: r/${input.subreddit}
Matched keywords: ${input.matchedKeywords.join(', ')}

Post title: ${input.postTitle}

Post body:
${input.postBody.slice(0, 1500) || '(no body)'}
  `.trim()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.7,
    system: input.lane === 'helpful' ? HELPFUL_SYSTEM_PROMPT : PITCH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  if (!text || text === 'SKIP' || text.startsWith('SKIP\n')) return null
  return text
}

export async function runSignalScanner(opts?: {
  apiKey?: string
  now?: Date
}): Promise<ScannerResult> {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  const client = new Anthropic({ apiKey })
  const now = opts?.now ?? new Date()

  let matched = 0
  let drafted = 0
  let queued = 0
  let skipped = 0
  const candidates: { post: RedditPost; score: number; matchedKeywords: string[] }[] = []

  for (const sub of SIGNAL_SUBREDDITS) {
    let posts: RedditPost[]
    try {
      posts = await fetchSubredditNew(sub)
    } catch (e) {
      console.warn(`[signal-scanner] r/${sub} failed: ${(e as Error).message}`)
      continue
    }
    for (const post of posts) {
      const ageHours = (now.getTime() - post.created_utc * 1000) / (1000 * 60 * 60)
      if (ageHours > SIGNAL_MAX_AGE_HOURS) continue
      const { score, matched: kws } = scoreRelevance(post, now)
      if (score === 0) continue
      matched++
      candidates.push({ post, score, matchedKeywords: kws })
    }
  }

  // Sort by score descending, take the top N for LLM drafting.
  candidates.sort((a, b) => b.score - a.score)

  for (const c of candidates) {
    const externalId = `t3_${c.post.id}`
    const existing = await prisma.queueItem.findUnique({ where: { externalId } })
    if (existing) {
      skipped++
      continue
    }

    // Score determines the lane:
    //   ≥ MIN_SCORE_FOR_PITCH_DRAFT  → "pitch" lane (mention Entuned if natural)
    //   ≥ MIN_SCORE_FOR_HELPFUL_DRAFT → "helpful" lane (NEVER mention Entuned)
    //   below                          → too noisy, skip entirely (used to queue
    //                                     undrafted, but those rows never got acted on)
    let lane: ReplyLane | null = null
    if (c.score >= MIN_SCORE_FOR_PITCH_DRAFT) lane = 'pitch'
    else if (c.score >= MIN_SCORE_FOR_HELPFUL_DRAFT) lane = 'helpful'
    if (lane === null) { skipped++; continue }

    if (drafted >= MAX_DRAFTS_PER_RUN) break

    let draft: string | null = null
    try {
      draft = await draftReply(client, {
        postTitle: c.post.title,
        postBody: c.post.selftext,
        subreddit: c.post.subreddit,
        matchedKeywords: c.matchedKeywords,
        lane,
      })
      drafted++
    } catch (e) {
      console.warn(`[signal-scanner] draft failed for ${externalId}: ${(e as Error).message}`)
    }

    // If Claude said SKIP (returned null), it's noise — don't queue at all.
    if (draft === null) { skipped++; continue }

    const sourceUrl = `https://www.reddit.com${c.post.permalink}`
    const expiresAt = new Date(c.post.created_utc * 1000 + SIGNAL_MAX_AGE_HOURS * 3600 * 1000)
    const ageHours = (now.getTime() - c.post.created_utc * 1000) / (1000 * 60 * 60)
    const postAge =
      ageHours < 1 ? `${Math.round(ageHours * 60)}m ago` :
      ageHours < 24 ? `${Math.round(ageHours)}h ago` :
      `${Math.round(ageHours / 24)}d ago`

    await prisma.queueItem.create({
      data: {
        type: 'signal',
        // Distinct subtype per lane so the UI / filters can split them
        // visually if needed and the helpful lane never accidentally gets
        // promoted into pitch language during a later edit pass.
        subtype: lane === 'helpful' ? 'reddit-helpful' : 'reddit',
        status: 'pending',
        priority: c.score,
        title: `${lane === 'helpful' ? '[helpful] ' : ''}r/${c.post.subreddit}: ${c.post.title.slice(0, 200)}`,
        draftContent: draft,
        sourceUrl,
        externalId,
        expiresAt,
        payload: {
          subreddit: c.post.subreddit,
          postTitle: c.post.title,
          postBody: c.post.selftext.slice(0, 500),
          postAuthor: c.post.author,
          postAge,
          upvotes: c.post.ups,
          commentCount: c.post.num_comments,
          relevanceScore: c.score,
          matchedKeywords: c.matchedKeywords,
          lane,
        },
      },
    })
    queued++
  }

  return { matched, drafted, queued, skipped }
}

// Standalone CLI entry. `npx tsx src/workers/signal-scanner.ts` runs once.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runSignalScanner()
    .then((r) => {
      console.log(`[signal-scanner] done`, r)
    })
    .catch((err) => {
      console.error('[signal-scanner] failed', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
