import { useState } from 'react'
import { api, getToken } from '../../api.js'
import { VersionedPromptEditor, History as SharedHistory, Button, LlmProgress, useToast } from '../../ui/index.js'
import type { PromptVersion } from '../../ui/index.js'
import { T } from '@entuned/tokens'

export function DecomposerRules() {
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ total: number; processed: number; failed: number; errors: { id: string; artist: string; title: string; error: string }[] } | null>(null)

  const [bpmRunning, setBpmRunning] = useState(false)
  const [bpmProgress, setBpmProgress] = useState<{ succeeded: number; skipped: number; failed: number; remaining: number } | null>(null)

  const runAll = async () => {
    const token = getToken(); if (!token) return
    setRunning(true)
    setResult(null)
    try {
      const r = await api.decomposeAllReferenceTracks(token)
      setResult(r)
      if (r.failed === 0) {
        toast.success(`decomposed ${r.processed} track${r.processed === 1 ? '' : 's'}`)
      } else {
        toast.error(`${r.processed} ok, ${r.failed} failed`)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'decompose-all failed')
    } finally {
      setRunning(false)
    }
  }

  // Loops the cheap backfill endpoint until remaining hits 0 (or an error).
  // Each call processes up to 50 rows; the server returns the count still
  // needing backfill so we know when we're done.
  const runBpmBackfill = async () => {
    const token = getToken(); if (!token) return
    setBpmRunning(true)
    setBpmProgress(null)
    let totalSucceeded = 0
    let totalSkipped = 0
    let totalFailed = 0
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await api.backfillBpm(token, 50)
        totalSucceeded += r.succeeded
        totalSkipped += r.skipped
        totalFailed += r.failed
        setBpmProgress({ succeeded: totalSucceeded, skipped: totalSkipped, failed: totalFailed, remaining: r.remaining })
        if (r.total === 0 || r.remaining === 0) break
      }
      if (totalFailed === 0) {
        toast.success(`backfilled ${totalSucceeded} BPM${totalSucceeded === 1 ? '' : 's'}${totalSkipped > 0 ? ` (${totalSkipped} unresolved)` : ''}`)
      } else {
        toast.error(`${totalSucceeded} ok, ${totalFailed} failed`)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'bpm-backfill failed')
    } finally {
      setBpmRunning(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <VersionedPromptEditor
        title="Decomposition"
        subtitle=""
        load={async () => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          const r = await api.musicologicalRules(token)
          return { latest: r.latest, history: r.history }
        }}
        textFrom={(latest) => latest?.rulesText ?? ''}
        save={async (text, notes) => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          await api.saveMusicologicalRules(text, notes, token)
        }}
        minHeight={420}
      />

      <div style={{
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={runAll} disabled={running}>
            {running ? 'decomposing…' : 'decompose all reference tracks'}
          </Button>
          <span style={{ fontFamily: T.sans, fontSize: 13, color: T.textDim }}>
            reruns decomposition on every approved reference track across all ICPs
          </span>
        </div>
        {running && <LlmProgress etaSeconds={60} label="decomposing all reference tracks" />}
        {result && (
          <div style={{ fontFamily: T.mono, fontSize: 12, color: result.failed > 0 ? T.danger : T.accent }}>
            {result.processed}/{result.total} decomposed
            {result.failed > 0 && ` · ${result.failed} failed`}
            {result.errors.length > 0 && (
              <ul style={{ margin: '6px 0 0', padding: '0 0 0 16px', color: T.danger }}>
                {result.errors.map((e) => (
                  <li key={e.id}>{e.artist} — {e.title}: {e.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div style={{
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={runBpmBackfill} disabled={bpmRunning}>
            {bpmRunning ? 'backfilling…' : 'backfill BPM (cheap)'}
          </Button>
          <span style={{ fontFamily: T.sans, fontSize: 13, color: T.textDim }}>
            fills bpm on existing decompositions via a Haiku side route — ~$0.005–0.01 per track. resumable; loops until done.
          </span>
        </div>
        {bpmRunning && <LlmProgress etaSeconds={120} label="backfilling BPM" />}
        {bpmProgress && (
          <div style={{ fontFamily: T.mono, fontSize: 12, color: bpmProgress.failed > 0 ? T.danger : T.accent }}>
            {bpmProgress.succeeded} filled
            {bpmProgress.skipped > 0 && ` · ${bpmProgress.skipped} unresolved`}
            {bpmProgress.failed > 0 && ` · ${bpmProgress.failed} failed`}
            {bpmProgress.remaining > 0
              ? ` · ${bpmProgress.remaining} remaining`
              : ' · done'}
          </div>
        )}
      </div>
    </div>
  )
}

// Re-exported for any panels still importing from here.
export { SharedHistory as History }
export function Header(_: { title: string; subtitle: string; version?: number; createdAt?: string }) {
  return null
}
export type { PromptVersion }
