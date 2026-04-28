import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { HookRowFull, OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, S, useToast } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

type Draft = {
  /** Stable client-side id so React keys + edits don't get confused. */
  key: string
  text: string
  saving?: boolean
  saved?: boolean
}

const DEFAULT_N = 5

export function HookRefresh({ ctx }: { ctx: WorkflowContext }) {
  const toast = useToast()
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [hooks, setHooks] = useState<HookRowFull[] | null>(null)
  const [selectedOutcomeIds, setSelectedOutcomeIds] = useState<Set<string>>(new Set())
  const [activeOutcomeId, setActiveOutcomeId] = useState<string | null>(null)
  const [n, setN] = useState(DEFAULT_N)
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({}) // outcomeId → drafts
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)

  // Fetch outcomes once.
  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  // Fetch existing hooks whenever the active ICP changes.
  useEffect(() => {
    if (!ctx.icpId) { setHooks(null); return }
    const token = getToken(); if (!token) return
    setHooks(null)
    api.icpHooks(ctx.icpId, token).then(setHooks).catch((e) => setErr(e.message))
  }, [ctx.icpId])

  // Reset workspace when ICP changes.
  useEffect(() => {
    setSelectedOutcomeIds(new Set())
    setActiveOutcomeId(null)
    setDrafts({})
  }, [ctx.icpId])

  const approvedByOutcome = useMemo(() => {
    const m: Record<string, HookRowFull[]> = {}
    for (const h of hooks ?? []) {
      if (h.status !== 'approved') continue
      ;(m[h.outcomeId] ??= []).push(h)
    }
    return m
  }, [hooks])

  const liveOutcomes = (outcomes ?? []).filter((o) => !o.supersededAt)

  const toggleOutcome = (id: string) => {
    setSelectedOutcomeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    if (!activeOutcomeId) setActiveOutcomeId(id)
  }

  const generate = async (outcomeId: string) => {
    if (!ctx.icpId) return
    const token = getToken(); if (!token) return
    setGenerating((s) => new Set(s).add(outcomeId))
    setErr(null)
    try {
      const r = await api.draftHooks(ctx.icpId, { outcomeId, n }, token)
      const next: Draft[] = r.hooks.map((text, i) => ({
        key: `${outcomeId}-${Date.now()}-${i}`,
        text,
      }))
      setDrafts((d) => ({ ...d, [outcomeId]: [...(d[outcomeId] ?? []), ...next] }))
    } catch (e: any) {
      setErr(e.message ?? 'generation failed')
      toast.error(e.message ?? 'generation failed')
    } finally {
      setGenerating((s) => {
        const next = new Set(s); next.delete(outcomeId); return next
      })
    }
  }

  const editDraft = (outcomeId: string, key: string, text: string) => {
    setDrafts((d) => ({
      ...d,
      [outcomeId]: (d[outcomeId] ?? []).map((x) => x.key === key ? { ...x, text, saved: false } : x),
    }))
  }

  const discard = (outcomeId: string, key: string) => {
    setDrafts((d) => ({
      ...d,
      [outcomeId]: (d[outcomeId] ?? []).filter((x) => x.key !== key),
    }))
  }

  const approve = async (outcomeId: string, key: string) => {
    if (!ctx.icpId) return
    const draft = drafts[outcomeId]?.find((x) => x.key === key)
    if (!draft || !draft.text.trim()) return
    const token = getToken(); if (!token) return
    setDrafts((d) => ({
      ...d,
      [outcomeId]: (d[outcomeId] ?? []).map((x) => x.key === key ? { ...x, saving: true } : x),
    }))
    try {
      const created = await api.createHook(
        ctx.icpId,
        { text: draft.text.trim(), outcomeId, approve: true },
        token,
      )
      // Reflect in approved list immediately.
      setHooks((prev) => prev ? [...prev, created] : [created])
      setDrafts((d) => ({
        ...d,
        [outcomeId]: (d[outcomeId] ?? []).map((x) => x.key === key ? { ...x, saving: false, saved: true } : x),
      }))
      toast.success('hook approved')
    } catch (e: any) {
      setErr(e.message ?? 'approve failed')
      toast.error(e.message ?? 'approve failed')
      setDrafts((d) => ({
        ...d,
        [outcomeId]: (d[outcomeId] ?? []).map((x) => x.key === key ? { ...x, saving: false } : x),
      }))
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

  const ordered = liveOutcomes.slice().sort((a, b) => a.title.localeCompare(b.title))
  const activeOutcome = activeOutcomeId
    ? liveOutcomes.find((o) => o.id === activeOutcomeId) ?? null
    : null
  const selectedList = ordered.filter((o) => selectedOutcomeIds.has(o.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Outcome picker */}
      <div>
        <Heading>Pick outcomes to refresh</Heading>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8, marginTop: 10,
        }}>
          {ordered.map((o) => {
            const on = selectedOutcomeIds.has(o.id)
            const approvedCount = (approvedByOutcome[o.id] ?? []).length
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
                  {o.title}
                </div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 4, fontFamily: T.mono }}>
                  v{o.version} · {approvedCount} approved
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
              const draftCount = (drafts[o.id] ?? []).filter((x) => !x.saved).length
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
                  {o.title}{draftCount > 0 ? ` · ${draftCount}` : ''}
                </button>
              )
            })}
          </div>

          {/* Generation controls */}
          {activeOutcome && (
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
          )}

          {/* Side-by-side: current approved (left) | new drafts (right) */}
          {activeOutcome && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Column title={`Currently approved (${(approvedByOutcome[activeOutcome.id] ?? []).length})`}>
                {(approvedByOutcome[activeOutcome.id] ?? []).length === 0 ? (
                  <Empty>no approved hooks yet for this outcome</Empty>
                ) : (
                  (approvedByOutcome[activeOutcome.id] ?? []).map((h) => (
                    <ApprovedRow key={h.id} text={h.text} />
                  ))
                )}
              </Column>

              <Column title={`New drafts (${(drafts[activeOutcome.id] ?? []).filter((x) => !x.saved).length})`}>
                {(drafts[activeOutcome.id] ?? []).length === 0 ? (
                  <Empty>click generate to draft new hooks</Empty>
                ) : (
                  (drafts[activeOutcome.id] ?? []).map((d) => (
                    <DraftRow
                      key={d.key}
                      draft={d}
                      onChange={(text) => editDraft(activeOutcome.id, d.key, text)}
                      onApprove={() => approve(activeOutcome.id, d.key)}
                      onDiscard={() => discard(activeOutcome.id, d.key)}
                    />
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
      fontFamily: T.mono, fontSize: 12, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.04em',
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

function ApprovedRow({ text }: { text: string }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 4, padding: '10px 12px', fontFamily: T.sans,
      fontSize: 14, color: T.text, lineHeight: 1.5, whiteSpace: 'pre-wrap',
    }}>{text}</div>
  )
}

function DraftRow({ draft, onChange, onApprove, onDiscard }: {
  draft: Draft
  onChange: (text: string) => void
  onApprove: () => void
  onDiscard: () => void
}) {
  const saved = draft.saved
  return (
    <div style={{
      background: saved ? T.accentGlow : T.surfaceRaised,
      border: `1px solid ${saved ? T.accent : T.border}`,
      borderRadius: 4, padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <textarea
        value={draft.text}
        onChange={(e) => onChange(e.target.value)}
        disabled={saved}
        rows={Math.min(6, Math.max(2, Math.ceil(draft.text.length / 60)))}
        style={{
          background: T.bg, color: T.text, border: `1px solid ${T.borderSubtle}`,
          borderRadius: 3, padding: '8px 10px', fontFamily: T.sans, fontSize: 14,
          lineHeight: 1.5, resize: 'vertical', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {saved ? (
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.accent }}>
            ✓ approved
          </span>
        ) : (
          <>
            <Button
              onClick={onApprove}
              disabled={draft.saving || !draft.text.trim()}
            >
              {draft.saving ? 'approving…' : 'approve'}
            </Button>
            <button
              onClick={onDiscard}
              disabled={draft.saving}
              style={{
                background: 'transparent', border: `1px solid ${T.border}`,
                color: T.textMuted, padding: '6px 12px', borderRadius: 3,
                fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
              }}
            >discard</button>
          </>
        )}
      </div>
    </div>
  )
}
