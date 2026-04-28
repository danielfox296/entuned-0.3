import { useEffect, useState } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'
import { Button } from './Button.js'
import { Input, Textarea } from './Inputs.js'
import { PanelHeader } from './PanelHeader.js'

export interface PromptVersion {
  id: string
  version: number
  createdAt: string
  notes: string | null
}

interface Props<TLatest extends { version: number; createdAt: string } | null> {
  title: string
  subtitle: string
  /** Returns latest + history. */
  load: () => Promise<{ latest: TLatest; history: PromptVersion[] }>
  /** Reads the prompt text out of the latest record. */
  textFrom: (latest: TLatest) => string
  /** Persists a new version. */
  save: (text: string, notes: string | undefined) => Promise<void>
  /** Optional textarea height override. */
  minHeight?: number
}

export function VersionedPromptEditor<TLatest extends { version: number; createdAt: string } | null>({
  title, subtitle, load, textFrom, save, minHeight = 360,
}: Props<TLatest>) {
  const [latest, setLatest] = useState<TLatest | null>(null)
  const [history, setHistory] = useState<PromptVersion[]>([])
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = async () => {
    try {
      const r = await load()
      setLatest(r.latest)
      setHistory(r.history)
      setText(r.latest ? textFrom(r.latest) : '')
      setNotes('')
    } catch (e: any) {
      setErr(e.message ?? 'load failed')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { void refresh() }, [])

  const onSave = async () => {
    if (!text.trim()) return
    setBusy(true); setErr(null)
    try {
      await save(text, notes || undefined)
      await refresh()
    } catch (e: any) {
      setErr(e.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const currentText = latest ? textFrom(latest as TLatest) : ''
  const dirty = text !== currentText || notes.trim() !== ''

  const [showHistory, setShowHistory] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader title={title} subtitle={subtitle} />

      {latest && (
        <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textDim }}>
          last saved {new Date(latest.createdAt).toLocaleString()}
        </div>
      )}

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {loaded && (
        <>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            style={{ minHeight, fontFamily: T.mono, padding: 14 }}
          />
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="note (optional)"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={onSave} disabled={!dirty || !text.trim()} busy={busy}>
              {busy ? 'saving…' : 'save'}
            </Button>
            {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
          </div>

          {history.length > 1 && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setShowHistory((v) => !v)}
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  color: T.textDim, fontFamily: T.sans, fontSize: S.small,
                  cursor: 'pointer',
                }}
              >
                {showHistory ? '▾ history' : `▸ history (${history.length})`}
              </button>
              {showHistory && <History rows={history} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function History({ rows }: { rows: PromptVersion[] }) {
  return (
    <div style={{
      marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.borderSubtle}`,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((r) => (
          <div key={r.id} style={{
            display: 'flex', gap: 12, fontSize: S.small, fontFamily: T.sans,
            color: T.textMuted, padding: '4px 0',
          }}>
            <span style={{ color: T.textDim, width: 200 }}>
              {new Date(r.createdAt).toLocaleString()}
            </span>
            <span style={{ flex: 1 }}>{r.notes ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
