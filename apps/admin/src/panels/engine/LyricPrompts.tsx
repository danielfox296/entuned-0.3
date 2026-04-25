import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { T } from '../../App.js'
import { Header, History } from './DecomposerRules.js'

type Kind = 'draft' | 'edit'

export function LyricPrompts() {
  const [kind, setKind] = useState<Kind>('draft')
  const [data, setData] = useState<{
    draft: { latest: LyricPromptRow | null; history: LyricPromptRow[] }
    edit: { latest: LyricPromptRow | null; history: LyricPromptRow[] }
  } | null>(null)
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const token = getToken()
    if (!token) return
    try {
      const r = await api.lyricPrompts(token)
      setData(r)
    } catch (e: any) {
      setErr(e.message ?? 'load failed')
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!data) return
    setText(data[kind].latest?.promptText ?? '')
    setNotes('')
    setErr(null)
  }, [kind, data])

  const save = async () => {
    const token = getToken()
    if (!token || !text.trim()) return
    setBusy(true); setErr(null)
    try {
      if (kind === 'draft') await api.saveDraftPrompt(text, notes || undefined, token)
      else await api.saveEditPrompt(text, notes || undefined, token)
      await load()
    } catch (e: any) {
      setErr(e.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const current = data?.[kind].latest ?? null
  const history = data?.[kind].history ?? []
  const dirty = text !== (current?.promptText ?? '') || notes.trim() !== ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        title="Lyric Prompts"
        subtitle="Bernie draft and edit prompts (Anthropic-side lyric generation)"
        version={current?.version}
        createdAt={current?.createdAt}
      />

      <div style={{ display: 'flex', gap: 4 }}>
        {(['draft', 'edit'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            style={{
              background: kind === k ? T.surfaceRaised : 'transparent',
              border: `1px solid ${kind === k ? T.accent : T.border}`,
              color: kind === k ? T.accent : T.textMuted,
              padding: '6px 14px', borderRadius: 4,
              fontFamily: T.mono, fontSize: 11, cursor: 'pointer',
            }}
          >{k}</button>
        ))}
      </div>

      {!data && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {data && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            style={{
              minHeight: 360, background: T.surface, border: `1px solid ${T.border}`,
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
              disabled={busy || !dirty || !text.trim()}
              style={{
                background: dirty ? T.accent : T.surfaceRaised,
                color: dirty ? T.bg : T.textMuted,
                border: 'none', borderRadius: 4, padding: '9px 16px',
                fontFamily: T.mono, fontSize: 12, fontWeight: 600,
                cursor: dirty && !busy ? 'pointer' : 'default',
                opacity: busy ? 0.6 : 1,
              }}
            >{busy ? 'saving…' : `save ${kind} as new version`}</button>
            {current && <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
              current: v{current.version}
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
