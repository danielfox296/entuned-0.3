import { useEffect, useMemo, useState } from 'react'
import { api, getToken, outcomeLabel } from '../../api.js'
import type { OutcomeLyricFactorRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, S, useToast } from '../../ui/index.js'

export function OutcomeLyricFactor() {
  const [rows, setRows] = useState<OutcomeLyricFactorRow[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const toast = useToast()

  const reload = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.outcomeLyricFactors(token)
      setRows(r)
      if (!activeKey && r.length > 0) setActiveKey(r[0]!.outcomeKey)
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { void reload() }, [])

  const active = useMemo(
    () => (rows && activeKey ? rows.find((r) => r.outcomeKey === activeKey) ?? null : null),
    [rows, activeKey],
  )
  const draftValue = active ? (drafts[active.outcomeKey] ?? active.templateText ?? '') : ''
  const savedValue = active?.templateText ?? ''
  const dirty = !!active && draftValue !== savedValue

  const save = async () => {
    if (!active || !dirty) return
    const token = getToken(); if (!token) return
    setBusy(active.outcomeKey); setErr(null)
    try {
      await api.saveOutcomeLyricFactor(active.outcomeKey, { templateText: draftValue }, token)
      setDrafts((d) => { const n = { ...d }; delete n[active.outcomeKey]; return n })
      await reload()
      toast.success(`saved lyric direction for ${outcomeLabel(active)}`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save') }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: T.sans, fontSize: 13, color: T.textDim, lineHeight: 1.5 }}>
        Per-outcome lyric direction injected into the hook drafter (and downstream consumers). Layered on top of the universal craft system prompt; defines the outcome-specific behavioral overlay. No ICP data is injected.
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}
      {!rows && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {rows && rows.length === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          No active outcomes. Create one in Outcome Library first.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          {/* Outcome tabs — horizontal across the top */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            borderBottom: `1px solid ${T.border}`, paddingBottom: 10,
          }}>
            {rows.map((r) => {
              const on = r.outcomeKey === activeKey
              const hasPrompt = (drafts[r.outcomeKey] ?? r.templateText ?? '').trim().length > 0
              const isDirty = drafts[r.outcomeKey] !== undefined && drafts[r.outcomeKey] !== (r.templateText ?? '')
              return (
                <button
                  key={r.outcomeKey}
                  onClick={() => setActiveKey(r.outcomeKey)}
                  style={{
                    background: on ? T.accentGlow : 'transparent',
                    border: on ? `1px solid ${T.accent}` : `1px solid ${T.borderSubtle}`,
                    borderRadius: 4,
                    color: on ? T.text : T.textMuted,
                    padding: '6px 14px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: 13, fontWeight: on ? 500 : 400,
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'all 0.1s ease',
                  }}
                >
                  <span>{outcomeLabel(r)}</span>
                  {isDirty && <span style={{ color: T.warn, fontSize: 16, lineHeight: 1 }}>•</span>}
                  {!isDirty && (
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: hasPrompt ? T.success : T.borderSubtle,
                      flexShrink: 0,
                    }} />
                  )}
                </button>
              )
            })}
          </div>

          {/* Editor */}
          {active ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontFamily: T.sans, fontSize: 14, color: T.text, fontWeight: 500 }}>
                {outcomeLabel(active)}
              </div>
              <textarea
                value={draftValue}
                onChange={(e) => setDrafts({ ...drafts, [active.outcomeKey]: e.target.value })}
                rows={24}
                placeholder="Per-outcome lyric direction (sensory seeds, anti-clustering rules, spread vectors, do-not list)…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: T.bg, color: T.text,
                  border: `1px solid ${T.border}`, borderRadius: 4,
                  padding: '12px 14px', fontFamily: T.sans, fontSize: 13,
                  lineHeight: 1.6, resize: 'vertical', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button onClick={save} disabled={!dirty} busy={busy === active.outcomeKey}>
                  {busy === active.outcomeKey ? 'saving…' : (dirty ? 'save' : 'no changes')}
                </Button>
                {dirty && (
                  <Button
                    variant="tiny"
                    onClick={() => setDrafts((d) => { const n = { ...d }; delete n[active.outcomeKey]; return n })}
                  >discard</Button>
                )}
                <span style={{ flex: 1 }} />
                {active.updatedAt && (
                  <span style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim }}>
                    updated {new Date(active.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
              pick an outcome above to edit its lyric direction
            </div>
          )}
        </>
      )}
    </div>
  )
}
