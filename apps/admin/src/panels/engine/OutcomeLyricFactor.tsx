import { useEffect, useMemo, useState } from 'react'
import { api, getToken, outcomeLabel } from '../../api.js'
import type { OutcomeLyricFactorRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Section, S, useToast } from '../../ui/index.js'

/**
 * Per-outcome editable guidance string injected into the Hook Drafter user
 * message under "Lyric guidance for this outcome". Keyed by outcomeKey so
 * iterating doesn't spawn new Outcome versions.
 */
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
  const draftValue = active ? (drafts[active.outcomeKey] ?? active.templateText) : ''
  const dirty = !!active && draftValue !== active.templateText

  const save = async () => {
    if (!active || !dirty) return
    const token = getToken(); if (!token) return
    setBusy(active.outcomeKey); setErr(null)
    try {
      await api.saveOutcomeLyricFactor(active.outcomeKey, { templateText: draftValue }, token)
      setDrafts((d) => { const n = { ...d }; delete n[active.outcomeKey]; return n })
      await reload()
      toast.success(`saved guidance for ${outcomeLabel(active)}`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save') }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}
      {!rows && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {rows && rows.length === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          No active outcomes. Create one in Outcome Library first.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Outcome list */}
          <div style={{
            border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden',
            background: T.surface,
          }}>
            {rows.map((r) => {
              const on = r.outcomeKey === activeKey
              const hasGuidance = (drafts[r.outcomeKey] ?? r.templateText).trim().length > 0
              const isDirty = drafts[r.outcomeKey] !== undefined && drafts[r.outcomeKey] !== r.templateText
              return (
                <button
                  key={r.outcomeKey}
                  onClick={() => setActiveKey(r.outcomeKey)}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: on ? T.accentGlow : 'transparent',
                    border: 'none',
                    borderLeft: on ? `2px solid ${T.accent}` : '2px solid transparent',
                    borderBottom: `1px solid ${T.borderSubtle}`,
                    color: T.text,
                    padding: '10px 12px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: S.small,
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}
                >
                  <span style={{ fontWeight: on ? 500 : 400 }}>
                    {outcomeLabel(r)}
                    {isDirty && <span style={{ color: T.warn, marginLeft: 6 }}>•</span>}
                  </span>
                  <span style={{
                    fontSize: S.label, color: hasGuidance ? T.accentMuted : T.textDim,
                  }}>
                    {hasGuidance ? 'has guidance' : 'no guidance'}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Editor */}
          {active ? (
            <Section
              title={`Guidance for "${outcomeLabel(active)}"`}
              subtitle="Injected into the Hook Drafter as authoritative guidance for this outcome's emotional target. Keep it concrete: diction, imagery, what to avoid."
            >
              <textarea
                value={draftValue}
                onChange={(e) => setDrafts({ ...drafts, [active.outcomeKey]: e.target.value })}
                rows={18}
                placeholder={`e.g. for "${outcomeLabel(active)}", lean into open vowels, present-tense verbs, body-aware imagery; avoid command-form, urgency words, market-y phrasing…`}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: T.bg, color: T.text,
                  border: `1px solid ${T.border}`, borderRadius: 4,
                  padding: '10px 12px', fontFamily: T.sans, fontSize: 14,
                  lineHeight: 1.55, resize: 'vertical', outline: 'none',
                }}
              />
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button onClick={save} disabled={!dirty} busy={busy === active.outcomeKey}>
                  {busy === active.outcomeKey ? 'saving…' : (dirty ? 'save guidance' : 'no changes')}
                </Button>
                {dirty && (
                  <Button
                    variant="tiny"
                    onClick={() => setDrafts((d) => { const n = { ...d }; delete n[active.outcomeKey]; return n })}
                  >discard</Button>
                )}
                <span style={{ flex: 1 }} />
                {active.updatedAt && (
                  <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>
                    updated {new Date(active.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </Section>
          ) : (
            <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
              pick an outcome on the left to edit its lyric guidance
            </div>
          )}
        </div>
      )}
    </div>
  )
}
