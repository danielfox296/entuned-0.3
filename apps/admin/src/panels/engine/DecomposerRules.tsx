import { useState } from 'react'
import { api, getToken } from '../../api.js'
import { VersionedPromptEditor, History as SharedHistory, Button, LlmProgress, useToast } from '../../ui/index.js'
import type { PromptVersion } from '../../ui/index.js'
import { T } from '../../tokens.js'

export function DecomposerRules() {
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ total: number; processed: number; failed: number; errors: { id: string; artist: string; title: string; error: string }[] } | null>(null)

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
    </div>
  )
}

// Re-exported for any panels still importing from here.
export { SharedHistory as History }
export function Header(_: { title: string; subtitle: string; version?: number; createdAt?: string }) {
  return null
}
export type { PromptVersion }
