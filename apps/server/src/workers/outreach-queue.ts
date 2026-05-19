// Outreach Queue worker — on-demand outreach pitch drafter.
//
// Different cadence from the cron-driven workers: Daniel feeds a target
// (`{ name, type, url, notes? }`) via POST /command-center/outreach/research
// (wired in command-center.ts) and this worker runs once per target.
//
// Steps:
//   1. Fetch the target's website / podcast page / blog feed.
//   2. Summarize what they cover (recent episodes/posts/themes).
//   3. Pick a pitch angle (A/B/C) and select 1-2 ProofPoints to weave in.
//   4. Draft a personalized pitch email in Daniel's voice.
//   5. Write a QueueItem with type='outreach' so it shows up in the
//      Outreach Queue section of the Command Center.
//
// Spec: ../../../morning-command-center-spec.md §SYSTEM 5

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import {
  PITCH_ANGLES,
  OUTREACH_TARGET_TYPES,
  type PitchAngle,
  type OutreachTargetType,
} from '../lib/command-center-config.js'

const MODEL = process.env.OUTREACH_QUEUE_MODEL ?? 'claude-sonnet-4-6'
const FETCH_TIMEOUT_MS = 15_000

// The three pitch angles. Spec ships pinned angle copy; researchers pick
// one based on the target's content.
//   A — Music producer who works the floor (origin / personality)
//   B — Specification-Outcome Map (the real product / data company)
//   C — Pilot data + customer narration (proof / "add it to the pile")
const PITCH_ANGLE_GUIDE = {
  A: 'Music-producer-who-works-the-floor angle. Lead with Daniel\'s biography. Best for personality-driven hosts who care about the founder story.',
  B: 'Specification-Outcome Map angle. Lead with the 31 compositional parameters mapped to shopper behavior. Best for tech / data / product-strategy shows.',
  C: 'Pilot data + customer narration. Lead with the 18→28% conversion lift and the "add it to the pile" customer moment. Best for ops / retail / case-study shows.',
} as const

const SYSTEM_PROMPT = `
You write outreach pitches in Daniel Fox's voice.

Daniel works the floor at a retail clothing store in Denver. He's a music
producer and the founder of Entuned — an AI that composes original music for
retail stores. He pitches like someone who reads the show / blog and writes
fast. No marketing voice. No exclamation points. No "I'd love to be on your
show."

Pitch rules:
- 150-250 words. Email-shaped.
- First sentence: a specific reference to something they recently published.
  Show you read it.
- Middle: ONE concrete pilot moment. Use the proof points provided.
- Close: a soft ask. "Happy to send a 90-second voice memo if it's useful"
  or "let me know if any of this fits — totally fine if not".
- No bullet points unless the format demands it.
- Never use: leverage, utilize, synergy, ROI, drive sales, opportunity,
  align, scale.

You will be given:
- Target name, type, and URL
- A summary of their recent content
- The pitch angle to lead with (A/B/C — see input)
- 1-2 proof points to weave in

Output ONLY the pitch email body. No subject line, no signature.
`.trim()

export interface OutreachTarget {
  name: string
  type: OutreachTargetType
  url: string
  notes?: string
}

interface ResearchResult {
  recentContent: string
  contactEmail: string | null
}

// Cheap heuristic research: fetch the page, strip HTML, take the first
// ~2k characters of visible text. Claude can extract the rest from there.
// Avoids needing a full crawler or sitemap.xml parser for v1.
export async function researchTarget(url: string): Promise<ResearchResult> {
  let html = ''
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'entuned-outreach/0.1' },
    })
    clearTimeout(timeout)
    if (res.ok) html = await res.text()
  } catch {
    // Network errors are tolerable — we still draft a generic pitch using
    // the target name + type alone.
  }
  // Strip script + style blocks, then tags, then collapse whitespace.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const recentContent = text.slice(0, 2000)
  const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return { recentContent, contactEmail: emailMatch ? emailMatch[0] : null }
}

export async function pickAngleAndDraft(
  client: Anthropic,
  target: OutreachTarget,
  research: ResearchResult,
  proofPoints: { label: string; quoteText: string; attribution: string }[],
): Promise<{ angle: PitchAngle; draft: string }> {
  const userMessage = `
Target: ${target.name} (${target.type})
URL: ${target.url}

Their recent content (first 2k chars of page):
${research.recentContent || '(no content retrieved)'}

${target.notes ? `My notes: ${target.notes}\n` : ''}
Pitch angles available:
${PITCH_ANGLES.map((a) => `  ${a}. ${PITCH_ANGLE_GUIDE[a]}`).join('\n')}

Proof points (use one or two):
${proofPoints.map((p) => `- ${p.label}: "${p.quoteText}" — ${p.attribution}`).join('\n')}

Task: pick the strongest pitch angle for this target and draft the email body.
Output JSON with exactly two keys:
  angle: "A" or "B" or "C"
  draft: the email body (string)
Output ONLY the JSON object. No other text.
  `.trim()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    temperature: 0.6,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()

  // Strip code fences if Claude added them despite the instruction.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  let parsed: { angle?: string; draft?: string }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`outreach drafter returned non-JSON: ${text.slice(0, 200)}`)
  }
  const angle = (PITCH_ANGLES as readonly string[]).includes(parsed.angle ?? '')
    ? (parsed.angle as PitchAngle)
    : 'C'
  const draft = (parsed.draft ?? '').trim()
  if (!draft) throw new Error('outreach drafter returned empty draft')
  return { angle, draft }
}

export interface QueueOutreachResult {
  queueItemId: string
  angle: PitchAngle
}

export async function queueOutreachTarget(
  target: OutreachTarget,
  opts?: { apiKey?: string },
): Promise<QueueOutreachResult> {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  if (!OUTREACH_TARGET_TYPES.includes(target.type)) {
    throw new Error(`unknown target type: ${target.type}`)
  }
  const client = new Anthropic({ apiKey })

  const [research, proofPoints] = await Promise.all([
    researchTarget(target.url),
    prisma.proofPoint.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { label: true, quoteText: true, attribution: true },
    }),
  ])

  const { angle, draft } = await pickAngleAndDraft(client, target, research, proofPoints)

  const externalId = `outreach:${target.url}`
  const existing = await prisma.queueItem.findUnique({ where: { externalId } })
  if (existing) {
    return { queueItemId: existing.id, angle }
  }

  const row = await prisma.queueItem.create({
    data: {
      type: 'outreach',
      subtype: target.type,
      status: 'pending',
      priority: 50, // outreach defaults higher than signal-scanner (typical p20-60)
      title: `${target.type}: ${target.name} [Angle ${angle}]`,
      draftContent: draft,
      sourceUrl: target.url,
      externalId,
      payload: {
        targetName: target.name,
        targetType: target.type,
        targetUrl: target.url,
        contactEmail: research.contactEmail,
        contactMethod: research.contactEmail ? 'email' : 'form',
        pitchAngle: angle,
        researchNotes: target.notes ?? null,
        recentContent: research.recentContent.slice(0, 600),
      },
    },
  })
  return { queueItemId: row.id, angle }
}
