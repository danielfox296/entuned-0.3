import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ReferenceTrackRow, StoreDetail, TasteCategory, RefTrackUpdate } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, S, useToast, LlmProgress } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

const BUCKETS: TasteCategory[] = ['FormationEra', 'Subculture', 'Aspirational']

const BUCKET_LABEL: Record<TasteCategory, string> = {
  FormationEra: 'Formation Era',
  Subculture: 'Subculture',
  Aspirational: 'Aspirational',
}

export function ReferenceTrackRefresh({ ctx }: { ctx: WorkflowContext }) {
  const toast = useToast()
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set())
  const [pendingMutation, setPendingMutation] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, RefTrackUpdate>>({})
  const [err, setErr] = useState<string | null>(null)

  const refetch = async () => {
    if (!ctx.storeId) return
    const token = getToken(); if (!token) return
    try {
      const d = await api.storeDetail(ctx.storeId, token)
      setDetail(d)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    setDetail(null)
    setEdits({})
    if (ctx.storeId) refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.storeId])

  const tracks: ReferenceTrackRow[] = useMemo(() => {
    if (!detail || !ctx.icpId) return []
    const icp = detail.icps.find((i) => i.id === ctx.icpId)
    return icp?.referenceTracks ?? []
  }, [detail, ctx.icpId])

  const pending = tracks.filter((t) => t.status === 'pending')
  const approved = tracks.filter((t) => t.status === 'approved')

  const suggest = async () => {
    if (!ctx.icpId) return
    const token = getToken(); if (!token) return
    setSuggesting(true)
    setErr(null)
    try {
      const r = await api.suggestReferenceTracks(ctx.icpId, token)
      await refetch()
      toast.success(`${r.createdCount} new suggestion${r.createdCount === 1 ? '' : 's'}`)
    } catch (e: any) {
      setErr(e.message ?? 'suggestion failed')
      toast.error(e.message ?? 'suggestion failed')
    } finally {
      setSuggesting(false)
    }
  }

  const setEdit = (id: string, patch: RefTrackUpdate) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
  }

  const flushEdits = async (id: string) => {
    const patch = edits[id]
    if (!patch || Object.keys(patch).length === 0) return
    const token = getToken(); if (!token) return
    try {
      await api.updateReferenceTrack(id, patch, token)
      setEdits((prev) => { const { [id]: _, ...rest } = prev; return rest })
      await refetch()
    } catch (e: any) {
      toast.error(e.message ?? 'update failed')
    }
  }

  const approve = async (t: ReferenceTrackRow) => {
    const token = getToken(); if (!token) return
    setPendingMutation((s) => new Set(s).add(t.id))
    try {
      // Persist any in-flight edits before approval so what was on screen is what gets saved.
      if (edits[t.id]) {
        await api.updateReferenceTrack(t.id, edits[t.id]!, token)
        setEdits((prev) => { const { [t.id]: _, ...rest } = prev; return rest })
      }
      await api.approveReferenceTrack(t.id, token)
      await refetch()
      toast.success('approved')
    } catch (e: any) {
      toast.error(e.message ?? 'approve failed')
    } finally {
      setPendingMutation((s) => { const next = new Set(s); next.delete(t.id); return next })
    }
  }

  const discard = async (t: ReferenceTrackRow) => {
    const token = getToken(); if (!token) return
    setPendingMutation((s) => new Set(s).add(t.id))
    try {
      await api.deleteReferenceTrack(t.id, token)
      await refetch()
    } catch (e: any) {
      toast.error(e.message ?? 'discard failed')
    } finally {
      setPendingMutation((s) => { const next = new Set(s); next.delete(t.id); return next })
    }
  }

  const analyze = async (t: ReferenceTrackRow, force = false) => {
    const token = getToken(); if (!token) return
    setAnalyzing((s) => new Set(s).add(t.id))
    try {
      await api.decomposeReferenceTrack(t.id, force, token)
      await refetch()
      toast.success('analysis complete')
    } catch (e: any) {
      toast.error(e.message ?? 'analysis failed')
    } finally {
      setAnalyzing((s) => { const next = new Set(s); next.delete(t.id); return next })
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Suggest action */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={suggest} disabled={suggesting}>
            {suggesting ? 'suggesting…' : 'suggest reference tracks'}
          </Button>
          <span style={{ fontFamily: T.sans, fontSize: S.small, color: T.textDim }}>
            generates new candidates for this ICP based on the current reference-track prompt
          </span>
        </div>
        {suggesting && <LlmProgress etaSeconds={45} label="suggesting reference tracks" />}
      </div>

      {/* Two columns: suggestions (left) | approved (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Column title={`Suggested (${pending.length})`}>
          {pending.length === 0 ? (
            <Empty>click suggest to draft new candidates</Empty>
          ) : (
            pending.map((t) => (
              <PendingRow
                key={t.id}
                track={t}
                edit={edits[t.id]}
                busy={pendingMutation.has(t.id)}
                onChange={(patch) => setEdit(t.id, patch)}
                onBlur={() => flushEdits(t.id)}
                onApprove={() => approve(t)}
                onDiscard={() => discard(t)}
              />
            ))
          )}
        </Column>

        <Column title={`Approved (${approved.length})`}>
          {approved.length === 0 ? (
            <Empty>no approved reference tracks yet</Empty>
          ) : (
            approved.map((t) => (
              <ApprovedRow
                key={t.id}
                track={t}
                analyzing={analyzing.has(t.id)}
                onAnalyze={(force) => analyze(t, force)}
              />
            ))
          )}
        </Column>
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
    </div>
  )
}

function PendingRow({ track, edit, busy, onChange, onBlur, onApprove, onDiscard }: {
  track: ReferenceTrackRow
  edit: RefTrackUpdate | undefined
  busy: boolean
  onChange: (patch: RefTrackUpdate) => void
  onBlur: () => void
  onApprove: () => void
  onDiscard: () => void
}) {
  const v = (k: keyof RefTrackUpdate, fallback: any) =>
    edit?.[k] !== undefined ? (edit[k] as any) : fallback

  return (
    <div style={cardStyle(false)}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="artist">
          <input
            value={v('artist', track.artist) ?? ''}
            onChange={(e) => onChange({ artist: e.target.value })}
            onBlur={onBlur}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="title">
          <input
            value={v('title', track.title) ?? ''}
            onChange={(e) => onChange({ title: e.target.value })}
            onBlur={onBlur}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="year">
          <input
            type="number"
            value={v('year', track.year) ?? ''}
            onChange={(e) => onChange({ year: e.target.value === '' ? null : Number(e.target.value) })}
            onBlur={onBlur}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="bucket">
          <select
            value={v('bucket', track.bucket)}
            onChange={(e) => onChange({ bucket: e.target.value as TasteCategory })}
            onBlur={onBlur}
            disabled={busy}
            style={inputStyle}
          >
            {BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
          </select>
        </Field>
      </div>

      {track.suggestedRationale && (
        <div style={{
          fontFamily: T.sans, fontSize: 12, color: T.textDim,
          background: T.bg, border: `1px solid ${T.borderSubtle}`,
          borderRadius: 3, padding: '6px 8px', lineHeight: 1.5,
        }}>{track.suggestedRationale}</div>
      )}

      <Field label="notes">
        <textarea
          value={v('operatorNotes', track.operatorNotes) ?? ''}
          onChange={(e) => onChange({ operatorNotes: e.target.value || null })}
          onBlur={onBlur}
          disabled={busy}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={onApprove} disabled={busy}>{busy ? '…' : 'approve'}</Button>
        <button
          onClick={onDiscard}
          disabled={busy}
          style={ghostBtnStyle}
        >discard</button>
      </div>
    </div>
  )
}

function ApprovedRow({ track, analyzing, onAnalyze }: {
  track: ReferenceTrackRow
  analyzing: boolean
  onAnalyze: (force: boolean) => void
}) {
  const analysis = track.styleAnalysis
  return (
    <div style={cardStyle(true)}>
      <div style={{ fontFamily: T.sans, fontSize: 14, color: T.text, fontWeight: 500 }}>
        {track.artist} — {track.title}
        {track.year && <span style={{ color: T.textDim, fontWeight: 400 }}> ({track.year})</span>}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: T.mono, fontSize: 12, color: T.textDim,
      }}>
        <span>{BUCKET_LABEL[track.bucket]}</span>
        <span>·</span>
        <span>used {track.useCount}×</span>
        <span>·</span>
        <span style={{ color: analysis ? T.accent : T.textDim }}>
          {analysis ? `analyzed (${analysis.status})` : 'not analyzed'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {analysis ? (
          <button onClick={() => onAnalyze(true)} disabled={analyzing} style={ghostBtnStyle}>
            {analyzing ? 'reanalyzing…' : 're-analyze'}
          </button>
        ) : (
          <Button onClick={() => onAnalyze(false)} disabled={analyzing}>
            {analyzing ? 'analyzing…' : 'run style analysis'}
          </Button>
        )}
      </div>
      {analyzing && <LlmProgress etaSeconds={30} label="analyzing track" />}
    </div>
  )
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Heading>{title}</Heading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontFamily: T.mono, fontSize: 11, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>{label}</span>
      {children}
    </label>
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

const cardStyle = (approved: boolean): React.CSSProperties => ({
  background: T.surfaceRaised,
  border: `1px solid ${approved ? T.borderSubtle : T.border}`,
  borderRadius: 4,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
})

const inputStyle: React.CSSProperties = {
  background: T.bg,
  color: T.text,
  border: `1px solid ${T.borderSubtle}`,
  borderRadius: 3,
  padding: '6px 8px',
  fontFamily: T.sans,
  fontSize: 14,
  outline: 'none',
}

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${T.border}`,
  color: T.textMuted,
  padding: '6px 12px',
  borderRadius: 3,
  fontFamily: T.sans,
  fontSize: 13,
  cursor: 'pointer',
}
