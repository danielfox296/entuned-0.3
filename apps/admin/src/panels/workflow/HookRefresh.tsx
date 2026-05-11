import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { HookVocalGender, OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, useToast, LlmProgress } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

const DEFAULT_N = 5

type DraftRow = {
  text: string
  vocalGender: HookVocalGender
  /** Set once the row has been written to the DB. */
  hookId: string | null
  /** True while accepting or saving an edit. */
  saving: boolean
  /** True when an already-accepted row has been re-opened for edit. */
  editing: boolean
}

export function HookRefresh({ ctx }: { ctx: WorkflowContext }) {
  const toast = useToast()
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [acceptedCounts, setAcceptedCounts] = useState<Record<string, number>>({})
  const [activeOutcomeId, setActiveOutcomeId] = useState<string | null>(null)
  const [n, setN] = useState(DEFAULT_N)
  const [drafting, setDrafting] = useState(false)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  // Approved-hook counts power the per-card badge. Refreshed on ICP change;
  // bumped locally on each Accept to avoid a refetch per click.
  useEffect(() => {
    setAcceptedCounts({})
    setActiveOutcomeId(null)
    setRows([])
    setErr(null)
    if (!ctx.icpId) return
    const token = getToken(); if (!token) return
    api.icpHooks(ctx.icpId, token).then((hooks) => {
      const counts: Record<string, number> = {}
      for (const h of hooks) {
        if (h.status !== 'approved') continue
        counts[h.outcomeId] = (counts[h.outcomeId] ?? 0) + 1
      }
      setAcceptedCounts(counts)
    }).catch((e) => setErr(e.message))
  }, [ctx.icpId])

  const liveOutcomes = useMemo(
    () => (outcomes ?? [])
      .filter((o) => !o.supersededAt)
      .slice()
      .sort((a, b) => (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title)),
    [outcomes],
  )

  const selectOutcome = (id: string) => {
    if (id === activeOutcomeId) return
    setActiveOutcomeId(id)
    setRows([])
    setErr(null)
  }

  const draft = async () => {
    if (!ctx.icpId || !activeOutcomeId) return
    const token = getToken(); if (!token) return
    setDrafting(true); setErr(null)
    try {
      const r = await api.draftHooks(ctx.icpId, { outcomeId: activeOutcomeId, n }, token)
      setRows(r.hooks.map((h) => ({
        text: h.text,
        vocalGender: h.vocalGender,
        hookId: null,
        saving: false,
        editing: false,
      })))
    } catch (e: any) {
      setErr(e.message ?? 'failed to draft hooks')
      toast.error(e.message ?? 'failed to draft hooks')
    } finally {
      setDrafting(false)
    }
  }

  const setRowText = (idx: number, text: string) => {
    setRows((rs) => rs.map((r, i) => i === idx ? { ...r, text } : r))
  }

  const accept = async (idx: number) => {
    if (!ctx.icpId || !activeOutcomeId) return
    const row = rows[idx]
    if (!row || row.saving || row.hookId) return
    const text = row.text.trim()
    if (!text) return
    const token = getToken(); if (!token) return
    const outcomeId = activeOutcomeId
    setRows((rs) => rs.map((r, i) => i === idx ? { ...r, saving: true } : r))
    try {
      const created = await api.createHook(ctx.icpId, {
        text, outcomeId, vocalGender: row.vocalGender, approve: true,
      }, token)
      setRows((rs) => rs.map((r, i) => i === idx
        ? { ...r, saving: false, hookId: created.id, editing: false }
        : r))
      setAcceptedCounts((c) => ({ ...c, [outcomeId]: (c[outcomeId] ?? 0) + 1 }))
      toast.success('hook saved')
    } catch (e: any) {
      setRows((rs) => rs.map((r, i) => i === idx ? { ...r, saving: false } : r))
      toast.error(e.message ?? 'failed to save hook')
    }
  }

  const startEdit = (idx: number) => {
    setRows((rs) => rs.map((r, i) => i === idx ? { ...r, editing: true } : r))
  }

  const saveEdit = async (idx: number) => {
    const row = rows[idx]
    if (!row?.hookId || row.saving) return
    const text = row.text.trim()
    if (!text) return
    const token = getToken(); if (!token) return
    setRows((rs) => rs.map((r, i) => i === idx ? { ...r, saving: true } : r))
    try {
      await api.updateHook(row.hookId, { text }, token)
      setRows((rs) => rs.map((r, i) => i === idx
        ? { ...r, saving: false, editing: false }
        : r))
      toast.success('hook updated')
    } catch (e: any) {
      setRows((rs) => rs.map((r, i) => i === idx ? { ...r, saving: false } : r))
      toast.error(e.message ?? 'failed to update hook')
    }
  }

  if (!ctx.icpId) {
    return (
      <div style={{
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '14px 18px', color: T.textMuted,
        fontFamily: T.sans, fontSize: 14,
      }}>
        select a store and ICP above to begin
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Heading>Add hooks for outcomes</Heading>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'start',
      }}>
        {/* Left (1/3): outcome cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {liveOutcomes.map((o) => {
            const active = activeOutcomeId === o.id
            const count = acceptedCounts[o.id] ?? 0
            return (
              <div
                key={o.id}
                onClick={() => selectOutcome(o.id)}
                style={{
                  background: active ? T.accentGlow : T.surfaceRaised,
                  border: `1px solid ${active ? T.accent : T.border}`,
                  borderRadius: 4, padding: '8px 12px',
                  cursor: active ? 'default' : 'pointer',
                  fontFamily: T.sans,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    fontSize: 14, color: T.text, fontWeight: active ? 600 : 500,
                    flex: 1,
                  }}>
                    {o.displayTitle ?? o.title}
                  </div>
                  <div style={{
                    fontSize: 13, color: T.textDim, fontFamily: T.mono,
                  }}>
                    {count}
                  </div>
                </div>
                {active && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <input
                      type="number" min={1} max={20} value={n}
                      onChange={(e) => setN(Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_N)))}
                      style={{
                        width: 60, background: T.bg, color: T.text,
                        border: `1px solid ${T.border}`, padding: '4px 6px',
                        fontFamily: T.mono, fontSize: 13,
                      }}
                    />
                    <Button onClick={draft} disabled={drafting}>
                      {drafting ? 'drafting…' : 'Draft'}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Right (2/3): drafted rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!activeOutcomeId && (
            <Empty>select an outcome to start drafting hooks</Empty>
          )}
          {activeOutcomeId && drafting && (
            <LlmProgress
              etaSeconds={Math.max(8, n * 3)}
              label={`drafting ${n} hook${n === 1 ? '' : 's'}`}
            />
          )}
          {activeOutcomeId && !drafting && rows.length === 0 && (
            <Empty>click Draft to generate hooks</Empty>
          )}
          {rows.map((row, idx) => {
            const accepted = !!row.hookId
            const locked = accepted && !row.editing
            const buttonLabel = row.saving
              ? '…'
              : !accepted ? 'Accept'
              : row.editing ? 'Save' : 'Edit'
            const onClick = !accepted ? () => accept(idx)
              : row.editing ? () => saveEdit(idx)
              : () => startEdit(idx)
            return (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <textarea
                  value={row.text}
                  onChange={(e) => setRowText(idx, e.target.value)}
                  disabled={locked || row.saving}
                  rows={2}
                  style={{
                    flex: 1,
                    background: locked ? T.surfaceRaised : T.bg,
                    color: locked ? T.textMuted : T.text,
                    border: `1px solid ${locked ? T.borderSubtle : T.border}`,
                    borderRadius: 3, padding: '8px 10px',
                    fontFamily: T.sans, fontSize: 14, lineHeight: 1.4,
                    resize: 'vertical', outline: 'none',
                  }}
                />
                <Button onClick={onClick} disabled={row.saving || !row.text.trim()}>
                  {buttonLabel}
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: T.sans, fontSize: 13, color: T.textDim, fontWeight: 500,
    }}>{children}</div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px dashed ${T.borderSubtle}`,
      borderRadius: 4, padding: '20px 14px', color: T.textDim,
      fontFamily: T.sans, fontSize: 13, textAlign: 'center',
    }}>{children}</div>
  )
}
