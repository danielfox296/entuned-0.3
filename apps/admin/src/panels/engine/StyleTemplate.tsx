import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { StyleTemplateRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, PanelHeader, S } from '../../ui/index.js'

// Field labels — mapped from the camelCase keys exposed by the server's
// STYLE_TEMPLATE_AVAILABLE_FIELDS. New fields added on the server automatically
// surface here as the raw key if no label exists below; safe default.
const FIELD_LABELS: Record<string, string> = {
  vibePitch: 'Vibe pitch (track essence)',
  eraProductionSignature: 'Era / production signature',
  instrumentationPalette: 'Instrumentation palette',
  standoutElement: 'Standout element (MAYA)',
  vocalCharacter: 'Vocal character',
  vocalArrangement: 'Vocal arrangement',
  harmonicAndGroove: 'Harmonic & groove',
  arrangementShape: 'Arrangement shape (Bernie owns — usually omit)',
  dynamicCurve: 'Dynamic curve (Bernie owns — usually omit)',
}

export function StyleTemplate() {
  const [latest, setLatest] = useState<StyleTemplateRow | null>(null)
  const [history, setHistory] = useState<StyleTemplateRow[]>([])
  const [available, setAvailable] = useState<string[]>([])
  const [fields, setFields] = useState<string[]>([])
  const [charCap, setCharCap] = useState<number>(950)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.styleTemplate(token)
      setLatest(r.latest)
      setHistory(r.history)
      setAvailable(r.availableFields)
      setFields(r.latest?.fields ?? [])
      setCharCap(r.latest?.charCap ?? 950)
      setNotes('')
    } catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }
  useEffect(() => { load() }, [])

  const excluded = useMemo(
    () => available.filter((f) => !fields.includes(f)),
    [available, fields],
  )

  const labelFor = (f: string) => FIELD_LABELS[f] ?? f

  const moveUp = (i: number) => {
    if (i <= 0) return
    const next = [...fields]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    setFields(next)
  }
  const moveDown = (i: number) => {
    if (i >= fields.length - 1) return
    const next = [...fields]
    ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
    setFields(next)
  }
  const remove = (i: number) => setFields(fields.filter((_, idx) => idx !== i))
  const add = (f: string) => setFields([...fields, f])

  const dirty = useMemo(() => {
    if (!latest) return fields.length > 0 || charCap !== 950
    return (
      fields.length !== latest.fields.length ||
      fields.some((f, i) => f !== latest.fields[i]) ||
      charCap !== latest.charCap ||
      notes.trim().length > 0
    )
  }, [latest, fields, charCap, notes])

  const valid = fields.length > 0 && charCap >= 100 && charCap <= 2000

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      await api.saveStyleTemplate(
        { fields, charCap, notes: notes.trim() || undefined },
        token,
      )
      await load()
    } catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Style Template (Mars legacy builder)"
        subtitle="Which decomposition fields compose Mars's legacy style portion, in order, plus the total char cap. The router and anchor builders are unaffected — this only configures the legacy fallback (STYLE_BUILDER=legacy)."
      />

      {err && <div style={{ color: T.danger, fontFamily: T.sans, fontSize: S.small }}>{err}</div>}

      {!loaded ? (
        <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>
      ) : (
        <>
          {/* Included fields — order matters; controls reorder. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Included fields (top → bottom = order in style portion)</Label>
            <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
              {fields.length === 0 && (
                <div style={{ padding: 14, color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
                  no fields — add some from the list below
                </div>
              )}
              {fields.map((f, i) => (
                <div key={f} style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr auto',
                  alignItems: 'center', gap: 8, padding: '8px 12px',
                  borderBottom: i < fields.length - 1 ? `1px solid ${T.borderSubtle}` : 'none',
                  background: T.surface,
                }}>
                  <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>{i + 1}</span>
                  <span style={{ fontFamily: T.sans, fontSize: S.small, color: T.text }}>
                    {labelFor(f)} <span style={{ color: T.textDim }}>({f})</span>
                  </span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <Button variant="tiny" onClick={() => moveUp(i)} disabled={i === 0}>↑</Button>
                    <Button variant="tiny" onClick={() => moveDown(i)} disabled={i === fields.length - 1}>↓</Button>
                    <Button variant="tinyDanger" onClick={() => remove(i)}>×</Button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Available to add */}
          {excluded.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label>Available to add</Label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {excluded.map((f) => (
                  <button key={f} onClick={() => add(f)} style={{
                    background: T.surfaceRaised, color: T.text,
                    border: `1px solid ${T.border}`, borderRadius: 4,
                    padding: '4px 10px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: S.label,
                  }}>+ {labelFor(f)}</button>
                ))}
              </div>
            </div>
          )}

          {/* Cap + notes */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 200 }}>
              <Label>Total char cap (Suno's style field cap is 1000)</Label>
              <Input
                type="number"
                value={String(charCap)}
                onChange={(e) => setCharCap(Number(e.target.value) || 0)}
                min={100}
                max={2000}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <Label>Change notes (changelog, optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="why are you changing it" />
            </div>
          </div>

          {/* Save */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="primary" onClick={save} disabled={!valid || !dirty} busy={busy}>
              {busy ? '…' : `save as v${(latest?.version ?? 0) + 1}`}
            </Button>
            {latest && (
              <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>
                current: v{latest.version} · {latest.fields.length} fields · cap {latest.charCap}
              </span>
            )}
          </div>

          {/* Version history */}
          {history.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label>Version history</Label>
              <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
                {history.map((h, i) => (
                  <div key={h.id} style={{
                    display: 'grid', gridTemplateColumns: '60px 1fr 1fr 160px',
                    alignItems: 'center', gap: 8, padding: '8px 12px',
                    borderBottom: i < history.length - 1 ? `1px solid ${T.borderSubtle}` : 'none',
                    background: T.surface, fontFamily: T.sans, fontSize: S.small, color: T.text,
                  }}>
                    <span style={{ color: i === 0 ? T.accent : T.textDim, fontWeight: i === 0 ? 600 : 400 }}>v{h.version}</span>
                    <span title={h.fields.join(', ')} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.textMuted }}>
                      [{h.fields.join(', ')}] · cap {h.charCap}
                    </span>
                    <span title={h.notes ?? ''} style={{ color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.notes ?? ''}</span>
                    <span style={{ color: T.textDim }}>{new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: T.sans, fontSize: S.label, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.03em',
    }}>{children}</span>
  )
}
