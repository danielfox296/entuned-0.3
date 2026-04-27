import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { OutcomeFactorPromptRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Header, History } from './DecomposerRules.js'

export function OutcomeFactorPrompt() {
  const [latest, setLatest] = useState<OutcomeFactorPromptRow | null>(null)
  const [history, setHistory] = useState<OutcomeFactorPromptRow[]>([])
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken()
    if (!token) return
    try {
      const r = await api.outcomeFactorPrompt(token)
      setLatest(r.latest)
      setHistory(r.history)
      setText(r.latest?.templateText ?? '')
      setNotes('')
    } catch (e: any) {
      setErr(e.message ?? 'load failed')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    const token = getToken()
    if (!token) return
    setBusy(true); setErr(null)
    try {
      await api.saveOutcomeFactorPrompt(text, notes || undefined, token)
      await load()
    } catch (e: any) {
      setErr(e.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const dirty = text !== (latest?.templateText ?? '') || notes.trim() !== ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        title="Outcome Factor Prompt"
        subtitle="Prepended to the style string before Suno submission. Default: '{tempo_bpm}bpm, {mode}'. Available tokens: {tempo_bpm}, {mode}, {dynamics}, {instrumentation}."
        version={latest?.version}
        createdAt={latest?.createdAt}
      />

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {loaded && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="{tempo_bpm}bpm, {mode}"
            style={{
              minHeight: 220, background: T.surface, border: `1px solid ${T.border}`,
              color: T.text, fontFamily: T.mono, fontSize: 12, padding: 14,
              borderRadius: 4, resize: 'vertical', outline: 'none', lineHeight: 1.5,
            }}
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="version notes (optional)"
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.text, fontFamily: T.mono, fontSize: 12,
              padding: '8px 12px', borderRadius: 4, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={save}
              disabled={busy || !dirty}
              style={{
                background: dirty ? T.accent : T.surfaceRaised,
                color: dirty ? T.bg : T.textMuted,
                border: 'none', borderRadius: 4, padding: '9px 16px',
                fontFamily: T.mono, fontSize: 12, fontWeight: 600,
                cursor: dirty && !busy ? 'pointer' : 'default',
                opacity: busy ? 0.6 : 1,
              }}
            >{busy ? 'saving…' : 'save as new version'}</button>
            {latest && <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
              current: v{latest.version}
            </span>}
            {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</span>}
          </div>

          {history.length > 1 && (
            <History rows={history.map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt, notes: r.notes }))} />
          )}
        </>
      )}
    </div>
  )
}
