import { useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ReferenceTrackRow, StoreDetail, TasteCategory, RefTrackUpdate, StyleAnalysisRow, StyleAnalysisUpdate } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, S, useToast, LlmProgress, Modal } from '../../ui/index.js'
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
  const [openTrackId, setOpenTrackId] = useState<string | null>(null)
  const [prefetchingCovers, setPrefetchingCovers] = useState(false)
  /** Track ids we've already attempted to prefetch in this session, regardless
   *  of outcome. Prevents re-fetching the same track on every storeDetail
   *  refetch but still picks up freshly-suggested tracks when they appear. */
  const prefetchedTrackIds = useRef<Set<string>>(new Set())

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
  const openTrack = openTrackId ? tracks.find((t) => t.id === openTrackId) ?? null : null

  // Eagerly resolve covers + previews for any tracks that haven't been
  // resolved AND that we haven't already attempted in this session. Re-fires
  // when new pending suggestions appear after a `suggest reference tracks`
  // call so freshly-suggested rows don't have to do a synchronous server
  // round-trip on click (which loses the user gesture and breaks audio
  // autoplay). Concurrency 3 — both providers tolerate it fine.
  useEffect(() => {
    if (!ctx.icpId) return
    const queue = tracks.filter(
      (t) => !t.previewSource && !prefetchedTrackIds.current.has(t.id),
    )
    if (queue.length === 0) return
    queue.forEach((t) => prefetchedTrackIds.current.add(t.id))
    const token = getToken(); if (!token) return
    let cancelled = false
    setPrefetchingCovers(true)
    ;(async () => {
      const work = queue.slice()
      const workers = Array.from({ length: 3 }, async () => {
        while (!cancelled) {
          const next = work.shift(); if (!next) return
          try { await api.resolveReferenceTrackPreview(next.id, false, token) } catch {}
        }
      })
      await Promise.all(workers)
      if (!cancelled) {
        await refetch()
        setPrefetchingCovers(false)
      }
    })()
    return () => { cancelled = true; setPrefetchingCovers(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.icpId, tracks])

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
          {prefetchingCovers && (
            <span style={{
              fontFamily: T.mono, fontSize: 11, color: T.textDim,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              marginLeft: 'auto',
            }}>fetching covers…</span>
          )}
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
                onResolvedPreview={refetch}
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
                onOpen={() => setOpenTrackId(t.id)}
                onResolvedPreview={refetch}
              />
            ))
          )}
        </Column>
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      <StyleAnalysisModal
        track={openTrack}
        onClose={() => setOpenTrackId(null)}
        onSaved={() => { refetch() }}
        analyzing={openTrack ? analyzing.has(openTrack.id) : false}
        onAnalyze={(force) => openTrack && analyze(openTrack, force)}
        onResolvedPreview={refetch}
      />
    </div>
  )
}

const PREVIEW_STOP_EVENT = 'entuned-preview-stop'

function PreviewButton({ track, onResolved }: {
  track: ReferenceTrackRow
  onResolved: () => void
}) {
  const toast = useToast()
  const [resolving, setResolving] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // When any other PreviewButton starts playback, stop ours.
  useEffect(() => {
    const onStop = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (audioRef.current && detail !== audioRef.current) {
        audioRef.current.pause()
        setPlaying(false)
      }
    }
    window.addEventListener(PREVIEW_STOP_EVENT, onStop)
    return () => window.removeEventListener(PREVIEW_STOP_EVENT, onStop)
  }, [])

  const ensureUrl = async (): Promise<string | null> => {
    if (track.previewUrl) return track.previewUrl
    if (track.previewSource === 'none') return null
    const token = getToken(); if (!token) return null
    setResolving(true)
    try {
      const r = await api.resolveReferenceTrackPreview(track.id, false, token)
      onResolved()
      if (r.previewSource === 'none') {
        toast.error('no preview available')
        return null
      }
      return r.previewUrl
    } catch (e: any) {
      toast.error(e.message ?? 'preview lookup failed')
      return null
    } finally {
      setResolving(false)
    }
  }

  const toggle = async () => {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    // Create + retain the Audio element synchronously on the click so the
    // browser's autoplay policy treats the eventual play() as user-initiated
    // even if we have to fetch the URL first.
    if (!audioRef.current) audioRef.current = new Audio()
    audioRef.current.onended = () => setPlaying(false)
    window.dispatchEvent(new CustomEvent(PREVIEW_STOP_EVENT, { detail: audioRef.current }))

    if (track.previewUrl) {
      audioRef.current.src = track.previewUrl
      try {
        await audioRef.current.play()
        setPlaying(true)
      } catch {
        toast.error('playback failed')
      }
      return
    }

    // Need to resolve the URL first. Some browsers may revoke the gesture
    // across the await — if so, the user can click again and the second
    // click hits the cached previewUrl path above.
    const url = await ensureUrl()
    if (!url) return
    audioRef.current.src = url
    try {
      await audioRef.current.play()
      setPlaying(true)
    } catch {
      toast.error('preview ready — click again to play')
    }
  }

  const unavailable = track.previewSource === 'none'
  const label = unavailable ? '⊘' : resolving ? '…' : playing ? '⏸' : '▶'
  const title = unavailable
    ? 'no preview available for this track'
    : resolving
      ? 'finding preview…'
      : playing ? 'pause preview' : 'play preview'

  // Sized to overlay the cover. Slightly bigger glyph so it reads well on
  // top of busy album art.
  const btnSize = 32
  return (
    <button
      onClick={toggle}
      disabled={unavailable || resolving}
      title={title}
      style={{
        background: unavailable ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.65)',
        border: `1px solid rgba(255,255,255,${unavailable ? 0.15 : 0.3})`,
        color: unavailable ? 'rgba(255,255,255,0.4)' : '#fff',
        width: btnSize, height: btnSize, borderRadius: btnSize / 2,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: unavailable ? 'default' : 'pointer',
        fontFamily: T.sans, fontSize: 13, padding: 0,
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        boxShadow: unavailable ? 'none' : '0 1px 4px rgba(0,0,0,0.4)',
      }}
    >{label}</button>
  )
}

/** Album art with the play button overlaid in the centre. */
function CoverWithPlay({ track, size, rounded = 4, onResolvedPreview }: {
  track: ReferenceTrackRow
  size: number
  rounded?: number
  onResolvedPreview: () => void
}) {
  return (
    <div style={{
      position: 'relative', width: size, height: size, flexShrink: 0,
    }}>
      <Cover url={track.coverUrl} size={size} rounded={rounded} />
      <div style={{
        position: 'absolute', top: 0, left: 0, width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto' }}>
          <PreviewButton track={track} onResolved={onResolvedPreview} />
        </div>
      </div>
    </div>
  )
}

function PendingRow({ track, edit, busy, onChange, onBlur, onApprove, onDiscard, onResolvedPreview }: {
  track: ReferenceTrackRow
  edit: RefTrackUpdate | undefined
  busy: boolean
  onChange: (patch: RefTrackUpdate) => void
  onBlur: () => void
  onApprove: () => void
  onDiscard: () => void
  onResolvedPreview: () => void
}) {
  const v = (k: keyof RefTrackUpdate, fallback: any) =>
    edit?.[k] !== undefined ? (edit[k] as any) : fallback

  return (
    <div style={cardStyle(false)}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <CoverWithPlay track={track} size={56} onResolvedPreview={() => onResolvedPreview()} />
        <div style={{ fontFamily: T.sans, fontSize: 14, color: T.text, flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track.artist} — {track.title}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            suggested
          </div>
        </div>
      </div>
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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

function ApprovedRow({ track, analyzing, onAnalyze, onOpen, onResolvedPreview }: {
  track: ReferenceTrackRow
  analyzing: boolean
  onAnalyze: (force: boolean) => void
  onOpen: () => void
  onResolvedPreview: () => void
}) {
  const analysis = track.styleAnalysis
  return (
    <div style={cardStyle(true)}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <CoverWithPlay track={track} size={56} onResolvedPreview={() => onResolvedPreview()} />
        <button
          onClick={onOpen}
          title={analysis ? 'view & edit style analysis' : 'open track details'}
          style={{
            background: 'transparent', border: 'none', padding: 0, margin: 0,
            textAlign: 'left', cursor: 'pointer',
            fontFamily: T.sans, fontSize: 14, color: T.text, fontWeight: 500,
            flex: 1,
          }}
        >
          <span style={{ borderBottom: `1px dashed ${T.borderSubtle}` }}>
            {track.artist} — {track.title}
          </span>
          {track.year && <span style={{ color: T.textDim, fontWeight: 400 }}> ({track.year})</span>}
        </button>
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
      {/* Re-analyze lives inside the edit modal now. Only the first-time
          "run style analysis" prompt is on the row, since opening the modal
          for an unanalyzed track shows an empty state instead of the editor. */}
      {!analysis && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => onAnalyze(false)} disabled={analyzing}>
            {analyzing ? 'analyzing…' : 'run style analysis'}
          </Button>
        </div>
      )}
      {analyzing && <LlmProgress etaSeconds={30} label="analyzing track" />}
    </div>
  )
}

function Cover({ url, size, rounded = 4 }: { url: string | null; size: number; rounded?: number }) {
  if (!url) {
    return (
      <div style={{
        width: size, height: size, flexShrink: 0,
        background: T.bg, border: `1px solid ${T.borderSubtle}`,
        borderRadius: rounded, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        color: T.textDim, fontFamily: T.mono, fontSize: Math.max(10, size / 4),
      }}>♪</div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{
        width: size, height: size, flexShrink: 0,
        objectFit: 'cover', borderRadius: rounded,
        background: T.bg, display: 'block',
      }}
    />
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

const ANALYSIS_FIELDS: { key: keyof StyleAnalysisUpdate; label: string }[] = [
  { key: 'vibePitch', label: 'Vibe Pitch' },
  { key: 'eraProductionSignature', label: 'Era / Production Signature' },
  { key: 'instrumentationPalette', label: 'Instrumentation Palette' },
  { key: 'standoutElement', label: 'Standout Element' },
  { key: 'arrangementShape', label: 'Arrangement Shape' },
  { key: 'dynamicCurve', label: 'Dynamic Curve' },
  { key: 'vocalCharacter', label: 'Vocal Character' },
  { key: 'vocalArrangement', label: 'Vocal Arrangement' },
  { key: 'harmonicAndGroove', label: 'Harmonic & Groove' },
]

function StyleAnalysisModal({ track, onClose, onSaved, analyzing, onAnalyze, onResolvedPreview }: {
  track: ReferenceTrackRow | null
  onClose: () => void
  onSaved: () => void
  analyzing: boolean
  onAnalyze: (force: boolean) => void
  onResolvedPreview: () => void
}) {
  const toast = useToast()
  const [draft, setDraft] = useState<StyleAnalysisUpdate>({})
  const [saving, setSaving] = useState(false)

  // Reset the draft whenever the modal opens for a different track or the
  // underlying analysis is replaced (e.g. after re-analyze).
  const analysis: StyleAnalysisRow | null = track?.styleAnalysis ?? null
  const analysisKey = analysis?.id ?? null
  useEffect(() => { setDraft({}) }, [analysisKey])

  if (!track) return null

  const v = (k: keyof StyleAnalysisUpdate, fallback: any) =>
    draft[k] !== undefined ? (draft[k] as any) : fallback

  const save = async () => {
    if (!analysis) return
    if (Object.keys(draft).length === 0) { onClose(); return }
    const token = getToken(); if (!token) return
    setSaving(true)
    try {
      await api.updateStyleAnalysis(analysis.id, draft, token)
      toast.success('analysis saved')
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!track}
      onClose={onClose}
      title={`${track.artist} — ${track.title}${track.year ? ` (${track.year})` : ''}`}
      footer={analysis ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <button
            onClick={() => onAnalyze(true)}
            disabled={analyzing || saving}
            style={ghostBtnStyle}
            title="discard the current analysis and run again"
          >
            {analyzing ? 'reanalyzing…' : 're-analyze'}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtnStyle} disabled={saving}>cancel</button>
          <Button onClick={save} disabled={saving || Object.keys(draft).length === 0}>
            {saving ? 'saving…' : 'save'}
          </Button>
        </div>
      ) : null}
      width={760}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Track header with album art */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          paddingBottom: 12, borderBottom: `1px solid ${T.borderSubtle}`,
        }}>
          <CoverWithPlay track={track} size={80} rounded={6} onResolvedPreview={onResolvedPreview} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.sans, fontSize: 15, color: T.text, fontWeight: 500 }}>
              {track.artist}
            </div>
            <div style={{ fontFamily: T.sans, fontSize: 14, color: T.textMuted }}>
              {track.title}{track.year ? ` (${track.year})` : ''}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, marginTop: 2 }}>
              {BUCKET_LABEL[track.bucket]} · used {track.useCount}×
            </div>
          </div>
        </div>

        {!analysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: T.sans, fontSize: 14, color: T.textMuted, lineHeight: 1.6 }}>
              No style analysis yet for this track.
            </div>
            <div>
              <Button onClick={() => onAnalyze(false)} disabled={analyzing}>
                {analyzing ? 'analyzing…' : 'run style analysis'}
              </Button>
            </div>
            {analyzing && <LlmProgress etaSeconds={30} label="analyzing track" />}
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
              paddingBottom: 10, borderBottom: `1px solid ${T.borderSubtle}`,
            }}>
              <Field label="status">
                <select
                  value={v('status', analysis.status)}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as any }))}
                  style={inputStyle}
                >
                  <option value="draft">draft</option>
                  <option value="verified">verified</option>
                </select>
              </Field>
              <Field label="confidence">
                <select
                  value={v('confidence', analysis.confidence) ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, confidence: (e.target.value || null) as any }))}
                  style={inputStyle}
                >
                  <option value="">—</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </Field>
            </div>

            {/* Narrative fields, two per row. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {ANALYSIS_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <textarea
                    value={v(key, (analysis as any)[key]) ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value || null }))}
                    rows={6}
                    style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                  />
                </Field>
              ))}
            </div>

            {analyzing && <LlmProgress etaSeconds={30} label="re-analyzing track" />}

            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim }}>
              instructions v{analysis.styleAnalyzerInstructionsVersion}
              {analysis.verifiedAt ? ` · verified ${new Date(analysis.verifiedAt).toLocaleDateString()}` : ''}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
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
