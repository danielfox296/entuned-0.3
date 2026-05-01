import { useEffect, useMemo, useState } from 'react'
import { api, getToken, outcomeLabel } from '../../api.js'
import type { HookRowFull, OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, S, useToast, LlmProgress } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

const DEFAULT_N = 5

export function HookRefresh({ ctx }: { ctx: WorkflowContext }) {
  const toast = useToast()
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [hooks, setHooks] = useState<HookRowFull[] | null>(null)
  const [selectedOutcomeIds, setSelectedOutcomeIds] = useState<Set<string>>(new Set())
  const [activeOutcomeId, setActiveOutcomeId] = useState<string | null>(null)
  const [n, setN] = useState(DEFAULT_N)
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  /** Pending text edits keyed by hook id; flushed to server onBlur. */
  const [edits, setEdits] = useState<Record<string, string>>({})
  /** Hooks the user is acting on (approve/discard) — disables card buttons. */
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)

  // Fetch outcomes once.
  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  const refetchHooks = async () => {
    if (!ctx.icpId) return
    const token = getToken(); if (!token) return
    try { setHooks(await api.icpHooks(ctx.icpId, token)) }
    catch (e: any) { setErr(e.message) }
  }

  // Load hooks whenever the active ICP changes.
  useEffect(() => {
    if (!ctx.icpId) { setHooks(null); return }
    setHooks(null)
    refetchHooks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.icpId])

  // Reset workspace when ICP changes.
  useEffect(() => {
    setSelectedOutcomeIds(new Set())
    setActiveOutcomeId(null)
    setEdits({})
    setBusy(new Set())
  }, [ctx.icpId])

  const draftsByOutcome = useMemo(() => {
    const m: Record<string, HookRowFull[]> = {}
    for (const h of hooks ?? []) {
      if (h.status !== 'draft') continue
      ;(m[h.outcomeId] ??= []).push(h)
    }
    return m
  }, [hooks])

  const approvedByOutcome = useMemo(() => {
    const m: Record<string, HookRowFull[]> = {}
    for (const h of hooks ?? []) {
      if (h.status !== 'approved') continue
      ;(m[h.outcomeId] ??= []).push(h)
    }
    return m
  }, [hooks])

  // When hooks first arrive, auto-select any outcome that already has drafts
  // so the user can pick up where they left off without manually re-selecting.
  useEffect(() => {
    if (!hooks) return
    const withDrafts = new Set<string>()
    for (const h of hooks) if (h.status === 'draft') withDrafts.add(h.outcomeId)
    if (withDrafts.size === 0) return
    setSelectedOutcomeIds((prev) => {
      const next = new Set(prev)
      withDrafts.forEach((id) => next.add(id))
      return next
    })
    setActiveOutcomeId((prev) => prev ?? Array.from(withDrafts)[0] ?? null)
  }, [hooks])

  const liveOutcomes = (outcomes ?? []).filter((o) => !o.supersededAt)

  const toggleOutcome = (id: string) => {
    setSelectedOutcomeIds((prev) => {
      const next = new Set(prev)
      const wasSelected = next.has(id)
      if (wasSelected) next.delete(id); else next.add(id)
      // Selecting a new outcome should also focus it — otherwise the
      // Generate button stays pointed at whatever was previously active,
      // which silently misfires generation against the wrong outcome.
      if (!wasSelected) {
        setActiveOutcomeId(id)
      } else if (activeOutcomeId === id) {
        // Deselected the active one — pick any other still-selected outcome,
        // or null out if nothing remains selected.
        const fallback = next.values().next().value ?? null
        setActiveOutcomeId(fallback)
      }
      return next
    })
  }

  const generate = async (outcomeId: string) => {
    if (!ctx.icpId) return
    const token = getToken(); if (!token) return
    setGenerating((s) => new Set(s).add(outcomeId))
    setErr(null)
    try {
      const r = await api.draftHooks(ctx.icpId, { outcomeId, n }, token)
      // Persist generated hooks (with their vocal-gender tags) as draft rows
      // so they survive nav.
      await api.bulkCreateHooks(
        ctx.icpId,
        { outcomeId, hooks: r.hooks, approve: false },
        token,
      )
      await refetchHooks()
    } catch (e: any) {
      setErr(e.message ?? 'generation failed')
      toast.error(e.message ?? 'failed to generate hooks')
    } finally {
      setGenerating((s) => {
        const next = new Set(s); next.delete(outcomeId); return next
      })
    }
  }

  const setEdit = (id: string, text: string) => {
    setEdits((prev) => ({ ...prev, [id]: text }))
  }

  const flushEdit = async (id: string) => {
    const text = edits[id]
    if (text === undefined) return
    const original = hooks?.find((h) => h.id === id)?.text
    if (text === original) {
      setEdits((prev) => { const { [id]: _, ...rest } = prev; return rest })
      return
    }
    const token = getToken(); if (!token) return
    try {
      await api.updateHook(id, { text }, token)
      setEdits((prev) => { const { [id]: _, ...rest } = prev; return rest })
      await refetchHooks()
    } catch (e: any) {
      toast.error(e.message ?? 'failed to save hook')
    }
  }

  const approve = async (id: string) => {
    const text = edits[id]
    const token = getToken(); if (!token) return
    setBusy((s) => new Set(s).add(id))
    try {
      // Persist any pending edit before approval.
      if (text !== undefined) {
        await api.updateHook(id, { text }, token)
        setEdits((prev) => { const { [id]: _, ...rest } = prev; return rest })
      }
      await api.approveHook(id, token)
      await refetchHooks()
      toast.success('hook approved')

    } catch (e: any) {
      toast.error(e.message ?? 'failed to approve hook')
    } finally {
      setBusy((s) => { const next = new Set(s); next.delete(id); return next })
    }
  }

  const discard = async (id: string) => {
    const token = getToken(); if (!token) return
    setBusy((s) => new Set(s).add(id))
    try {
      await api.deleteHook(id, token)
      setEdits((prev) => { const { [id]: _, ...rest } = prev; return rest })
      await refetchHooks()
    } catch (e: any) {
      toast.error(e.message ?? 'failed to remove hook')
    } finally {
      setBusy((s) => { const next = new Set(s); next.delete(id); return next })
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

  const ordered = liveOutcomes.slice().sort((a, b) => (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title))
  const activeOutcome = activeOutcomeId
    ? liveOutcomes.find((o) => o.id === activeOutcomeId) ?? null
    : null
  const selectedList = ordered.filter((o) => selectedOutcomeIds.has(o.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Outcome picker */}
      <div>
        <Heading>Add hooks for outcomes</Heading>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8, marginTop: 10,
        }}>
          {ordered.map((o) => {
            const on = selectedOutcomeIds.has(o.id)
            const approvedCount = (approvedByOutcome[o.id] ?? []).length
            const draftCount = (draftsByOutcome[o.id] ?? []).length
            return (
              <button
                key={o.id}
                onClick={() => toggleOutcome(o.id)}
                style={{
                  textAlign: 'left',
                  background: on ? T.accentGlow : T.surfaceRaised,
                  border: `1px solid ${on ? T.accent : T.border}`,
                  borderRadius: 4, padding: '10px 12px', cursor: 'pointer',
                  fontFamily: T.sans,
                }}
              >
                <div style={{ fontSize: 14, color: T.text, fontWeight: on ? 500 : 400 }}>
                  {o.displayTitle ?? o.title}
                </div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 4, fontFamily: T.mono }}>
                  {approvedCount} approved{draftCount > 0 ? ` · ${draftCount} draft${draftCount === 1 ? '' : 's'}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {selectedList.length > 0 && (
        <>
          {/* Active outcome tabs (only the selected ones) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
            {selectedList.map((o) => {
              const on = activeOutcomeId === o.id
              const draftCount = (draftsByOutcome[o.id] ?? []).length
              return (
                <button
                  key={o.id}
                  onClick={() => setActiveOutcomeId(o.id)}
                  style={{
                    background: 'transparent', border: 'none',
                    borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                    color: on ? T.text : T.textMuted,
                    padding: '8px 14px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                    marginBottom: -1,
                  }}
                >
                  {o.displayTitle ?? o.title}{draftCount > 0 ? ` · ${draftCount}` : ''}
                </button>
              )
            })}
          </div>

          {/* Generation controls */}
          {activeOutcome && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  fontSize: S.label, color: T.textDim, fontFamily: T.sans,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>generate</span>
                <input
                  type="number" min={1} max={20} value={n}
                  onChange={(e) => setN(Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_N)))}
                  style={{
                    width: 60, background: T.bg, color: T.text,
                    border: `1px solid ${T.border}`, padding: '6px 8px',
                    fontFamily: T.mono, fontSize: 14,
                  }}
                />
                <Button
                  onClick={() => generate(activeOutcome.id)}
                  disabled={generating.has(activeOutcome.id)}
                >
                  {generating.has(activeOutcome.id) ? 'generating…' : `generate ${n} draft${n === 1 ? '' : 's'}`}
                </Button>
              </div>
              {generating.has(activeOutcome.id) && (
                <LlmProgress
                  etaSeconds={Math.max(8, n * 3)}
                  label={`drafting ${n} hook${n === 1 ? '' : 's'}`}
                />
              )}
            </div>
          )}

          {/* Side-by-side: drafts (left) | approved (right) */}
          {activeOutcome && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Column title={`Drafts (${(draftsByOutcome[activeOutcome.id] ?? []).length})`}>
                {(draftsByOutcome[activeOutcome.id] ?? []).length === 0 ? (
                  <Empty>click generate to draft new hooks</Empty>
                ) : (
                  (draftsByOutcome[activeOutcome.id] ?? []).map((h) => (
                    <DraftRow
                      key={h.id}
                      hook={h}
                      pendingText={edits[h.id]}
                      busy={busy.has(h.id)}
                      onChange={(text) => setEdit(h.id, text)}
                      onBlur={() => flushEdit(h.id)}
                      onApprove={() => approve(h.id)}
                      onDiscard={() => discard(h.id)}
                    />
                  ))
                )}
              </Column>

              <Column title={`Approved (${(approvedByOutcome[activeOutcome.id] ?? []).length})`}>
                {(approvedByOutcome[activeOutcome.id] ?? []).length === 0 ? (
                  <Empty>no approved hooks yet for this outcome</Empty>
                ) : (
                  (approvedByOutcome[activeOutcome.id] ?? []).map((h) => (
                    <ApprovedRow key={h.id} hook={h} />
                  ))
                )}
              </Column>
            </div>
          )}
        </>
      )}

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

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Heading>{title}</Heading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px dashed ${T.borderSubtle}`,
      borderRadius: 4, padding: '12px 14px', color: T.textDim,
      fontFamily: T.sans, fontSize: 13,
    }}>{children}</div>
  )
}

function OutcomeTag({ title }: { title: string }) {
  return (
    <span style={{
      fontFamily: T.sans, fontSize: 11, color: T.textDim,
      background: T.bg, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 3, padding: '2px 6px',
      letterSpacing: '0.02em',
    }}>{title}</span>
  )
}

function ApprovedRow({ hook }: { hook: HookRowFull }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 4, padding: '10px 12px', display: 'flex',
      flexDirection: 'column', gap: 8,
    }}>
      <OutcomeTag title={outcomeLabel(hook.outcome)} />
      <div style={{
        fontFamily: T.sans, fontSize: 14, color: T.text,
        lineHeight: 1.5, whiteSpace: 'pre-wrap',
      }}>{hook.text}</div>
    </div>
  )
}

function DraftRow({ hook, pendingText, busy, onChange, onBlur, onApprove, onDiscard }: {
  hook: HookRowFull
  pendingText: string | undefined
  busy: boolean
  onChange: (text: string) => void
  onBlur: () => void
  onApprove: () => void
  onDiscard: () => void
}) {
  const text = pendingText !== undefined ? pendingText : hook.text
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.border}`,
      borderRadius: 4, padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <OutcomeTag title={outcomeLabel(hook.outcome)} />
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={busy}
        rows={6}
        style={{
          background: T.bg, color: T.text, border: `1px solid ${T.borderSubtle}`,
          borderRadius: 3, padding: '8px 10px', fontFamily: T.sans, fontSize: 14,
          lineHeight: 1.5, resize: 'vertical', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button onClick={onApprove} disabled={busy || !text.trim()}>
          {busy ? '…' : 'approve'}
        </Button>
        <button
          onClick={onDiscard}
          disabled={busy}
          style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textMuted, padding: '6px 12px', borderRadius: 3,
            fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
          }}
        >remove</button>
      </div>
    </div>
  )
}
