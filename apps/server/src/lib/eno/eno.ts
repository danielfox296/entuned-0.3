// Card 14 Eno — orchestrates batch generation of Submissions.
// One Submission = one assembled Suno-ready prompt with hook + ref track + Mars style + Bernie lyrics.
//
// Per Card 14 spec, OutcomePrependTemplate prepends Outcome fields onto the style portion.
// Locked 2026-04-25 (Daniel's Suno reality check): Outcome physiology stays OUT of the style portion
// entirely; tempo/mode/dynamics live on Suno's separate params. The OutcomePrependTemplate row is
// preserved for provenance but seeded as an empty template so the prepend is a no-op. Admin can flip
// this on if the policy ever changes.

import { prisma } from '../../db.js'
import { marsAssemble } from '../mars/mars.js'
import { generateLyrics } from '../bernie/bernie.js'

export const PREPEND_TEMPLATE_SEED = '' // empty by default; see header note.

export async function getOrSeedPrependTemplate(): Promise<{ id: string; version: number; templateText: string }> {
  const row = await prisma.outcomePrependTemplate.findFirst({ orderBy: { version: 'desc' } })
  if (row) return row
  return prisma.outcomePrependTemplate.create({
    data: { version: 1, templateText: PREPEND_TEMPLATE_SEED, notes: 'Auto-seeded v1 (empty — outcome stays on Suno params, not style)' },
  })
}

export function applyPrepend(stylePortion: string, outcome: { tempoBpm: number; mode: string; dynamics: string | null; instrumentation: string | null }, templateText: string): string {
  if (!templateText.trim()) return stylePortion
  const filled = templateText
    .replace(/\{tempo_bpm\}/g, String(outcome.tempoBpm))
    .replace(/\{mode\}/g, outcome.mode)
    .replace(/\{dynamics\}/g, outcome.dynamics ?? '')
    .replace(/\{instrumentation\}/g, outcome.instrumentation ?? '')
  return `${filled.trim()} ${stylePortion}`
}

export interface EnoRunOptions {
  icpId: string
  outcomeId: string
  n: number
  triggeredBy: 'manual' | 'cron'
  triggeredByUser?: string
}

export interface EnoRunResult {
  enoRunId: string
  requestedN: number
  producedN: number
  reason: 'complete' | 'pool_exhausted' | 'precheck_failed'
  errors: string[]
}

export async function runEno(opts: EnoRunOptions): Promise<EnoRunResult> {
  const enoRun = await prisma.enoRun.create({
    data: {
      icpId: opts.icpId,
      outcomeId: opts.outcomeId,
      requestedN: opts.n,
      triggeredBy: opts.triggeredBy,
      triggeredByUser: opts.triggeredByUser ?? null,
    },
  })

  // Precheck: Outcome exists + active.
  const outcome = await prisma.outcome.findUnique({ where: { id: opts.outcomeId } })
  if (!outcome || outcome.supersededAt) {
    await prisma.enoRun.update({ where: { id: enoRun.id }, data: { producedN: 0, reason: 'precheck_failed', finishedAt: new Date() } })
    return { enoRunId: enoRun.id, requestedN: opts.n, producedN: 0, reason: 'precheck_failed', errors: ['outcome_missing_or_superseded'] }
  }

  let produced = 0
  const errors: string[] = []
  let exhausted = false

  for (let i = 0; i < opts.n; i++) {
    try {
      const result = await createSubmission(enoRun.id, opts.icpId, opts.outcomeId)
      if (!result.ok) {
        errors.push(result.reason ?? 'unknown')
        if (result.reason === 'pool_exhausted_hooks' || result.reason === 'pool_exhausted_reference_tracks') {
          exhausted = true
          break
        }
      } else {
        produced++
      }
    } catch (e: any) {
      errors.push(`unexpected: ${e.message ?? e}`)
    }
  }

  const reason: EnoRunResult['reason'] = exhausted ? 'pool_exhausted' : 'complete'
  await prisma.enoRun.update({
    where: { id: enoRun.id },
    data: { producedN: produced, reason, finishedAt: new Date() },
  })

  return { enoRunId: enoRun.id, requestedN: opts.n, producedN: produced, reason, errors }
}

interface CreateSubmissionResult {
  ok: boolean
  submissionId?: string
  reason?: string
}

async function createSubmission(enoRunId: string, icpId: string, outcomeId: string): Promise<CreateSubmissionResult> {
  // 1. Pick an approved hook scoped to this ICP+Outcome that has no in-flight or accepted submission.
  const hook = await pickAvailableHook(icpId, outcomeId)
  if (!hook) return { ok: false, reason: 'pool_exhausted_hooks' }

  // 2. Pick a reference track for this ICP that has a decomposition (Mars needs one).
  const refTrack = await pickReferenceTrack(icpId)
  if (!refTrack || !refTrack.decomposition) return { ok: false, reason: 'pool_exhausted_reference_tracks' }

  // 3. Eagerly persist Submission as 'assembling' so partial failure leaves a trace.
  const submission = await prisma.submission.create({
    data: {
      enoRunId, icpId, hookId: hook.id, outcomeId, referenceTrackId: refTrack.id, status: 'assembling',
    },
  })

  try {
    // Outcome row (for prepend template).
    const outcome = await prisma.outcome.findUniqueOrThrow({ where: { id: outcomeId } })

    // Mars assembly.
    const decomposition = refTrack.decomposition
    const mars = await marsAssemble(decomposition, outcome)

    // OutcomePrependTemplate.
    const prepend = await getOrSeedPrependTemplate()
    const finalStyle = applyPrepend(mars.style, outcome, prepend.templateText)

    // Bernie lyrics (two-pass: draft → edit). Bernie returns the active prompt
    // versions it actually used, so provenance is exact even mid-edit.
    const client = await prisma.client.findUnique({ where: { id: (await prisma.iCP.findUniqueOrThrow({ where: { id: icpId } })).clientId } })
    const lyrics = await generateLyrics({
      hookText: hook.text,
      brandLyricGuidelines: client?.brandLyricGuidelines ?? null,
    })

    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: 'queued',
        style: finalStyle,
        stylePortionRaw: mars.style,
        negativeStyle: mars.negativeStyle,
        vocalGender: mars.vocalGender,
        lyrics: lyrics.lyrics,
        title: lyrics.title,
        outcomePrependTemplateVersion: prepend.version,
        marsPromptVersion: mars.styleTemplateVersion,
        bernieDraftPromptVersion: lyrics.draftPromptVersion,
        bernieEditPromptVersion: lyrics.editPromptVersion,
        firedFailureRuleIds: mars.firedFailureRuleIds,
      },
    })

    return { ok: true, submissionId: submission.id }
  } catch (e: any) {
    await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'failed', errorText: e?.message ?? String(e) },
    })
    return { ok: false, reason: `assembly_failed: ${e?.message ?? e}` }
  }
}

/**
 * Pick an approved Hook for (icpId, outcomeId) that has no in-flight or accepted Submission.
 * Round-robin via createdAt ASC tiebreak (least recently created hook first).
 * Per Card 14 spec, the select-then-mark-in-flight race is accepted at MVP scale.
 */
async function pickAvailableHook(icpId: string, outcomeId: string): Promise<{ id: string; text: string } | null> {
  const hooks = await prisma.hook.findMany({
    where: { icpId, outcomeId, status: 'approved' },
    select: {
      id: true, text: true,
      submissions: { select: { status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  for (const h of hooks) {
    const blocking = h.submissions.some((s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted')
    if (!blocking) return { id: h.id, text: h.text }
  }
  return null
}

/**
 * Pick a reference track for the ICP that has a verified-or-draft Decomposition.
 * Lowest useCount first; ties broken by createdAt ASC. Mars needs a Decomposition to produce style.
 */
type RefTrackWithDecomp = Awaited<ReturnType<typeof prisma.referenceTrack.findFirstOrThrow<{ include: { decomposition: true } }>>>

async function pickReferenceTrack(icpId: string): Promise<RefTrackWithDecomp | null> {
  const tracks = await prisma.referenceTrack.findMany({
    where: { icpId, decomposition: { isNot: null } },
    include: { decomposition: true },
    orderBy: [{ useCount: 'asc' }, { createdAt: 'asc' }],
    take: 1,
  })
  const t = tracks[0]
  if (!t || !t.decomposition) return null
  return t as RefTrackWithDecomp
}
