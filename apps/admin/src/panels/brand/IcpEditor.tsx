import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type {
  StoreSummary, StoreDetail, IcpUpdate, NewReferenceTrack, ReferenceTrackRow,
  StyleAnalysisRow, StyleAnalysisUpdate, TasteCategory,
} from '../../api.js'
import { T } from '../../tokens.js'
import { PanelHeader, StorePicker as UIStorePicker, S, Pill, ConfirmDelete } from '../../ui/index.js'

// Width per field (px). Compact for short scalars, prose for paragraphs.
type FieldWidth = 'compact' | 'short' | 'prose'
const W = {
  compact: 240,   // single-word / short-phrase scalars
  short:   320,   // medium scalars (name, location)
  prose:   640,   // long-form paragraphs — readable column
} as const

const ICP_FIELDS: { key: keyof IcpUpdate; label: string; rows: number; width: FieldWidth }[] = [
  { key: 'name', label: 'name', rows: 1, width: 'short' },
  { key: 'ageRange', label: 'age range', rows: 1, width: 'compact' },
  { key: 'location', label: 'location', rows: 1, width: 'short' },
  { key: 'politicalSpectrum', label: 'political spectrum', rows: 1, width: 'compact' },
  { key: 'openness', label: 'openness', rows: 2, width: 'prose' },
  { key: 'fears', label: 'fears', rows: 3, width: 'prose' },
  { key: 'values', label: 'values', rows: 3, width: 'prose' },
  { key: 'desires', label: 'desires', rows: 3, width: 'prose' },
  { key: 'unexpressedDesires', label: 'unexpressed desires', rows: 3, width: 'prose' },
  { key: 'turnOffs', label: 'turn-offs', rows: 3, width: 'prose' },
]

const BUCKETS: TasteCategory[] = ['FormationEra', 'Subculture', 'Aspirational']

export function IcpEditor() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [icpId, setIcpId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newIcpName, setNewIcpName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId) { setDetail(null); setIcpId(null); return }
    const token = getToken(); if (!token) return
    setDetail(null); setIcpId(null)
    api.storeDetail(storeId, token).then((d) => {
      setDetail(d)
      setIcpId(d.icps[0]?.id ?? null)
    }).catch((e) => setErr(e.message))
  }, [storeId])

  const reloadDetail = async () => {
    if (!storeId) return
    const token = getToken(); if (!token) return
    try {
      const d = await api.storeDetail(storeId, token)
      setDetail(d)
      // Keep current selection if still present, else default to first ICP.
      setIcpId((cur) => (cur && d.icps.some((i) => i.id === cur)) ? cur : (d.icps[0]?.id ?? null))
    } catch (e: any) { setErr(e.message) }
  }

  const createIcp = async () => {
    if (!storeId || !newIcpName.trim()) return
    const token = getToken(); if (!token) return
    setCreateBusy(true); setErr(null)
    try {
      const created = await api.createIcp({ storeId, name: newIcpName.trim() }, token)
      setCreating(false); setNewIcpName('')
      await reloadDetail()
      setIcpId(created.id)
    } catch (e: any) { setErr(e.message) }
    finally { setCreateBusy(false) }
  }

  const selectedIcp = detail && icpId ? detail.icps.find((i) => i.id === icpId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="ICP Editor"
        subtitle="A store can have many ICPs. Pick one to edit psychographic fields, manage reference tracks, run the decomposer."
      />

      <UIStorePicker stores={stores} storeId={storeId} onPick={(id) => { setStoreId(id); setCreating(false); setNewIcpName('') }} />

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {storeId && !detail && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {detail && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase' }}>
            ICPs ({detail.icps.length})
          </span>
          {detail.icps.length > 0 && (
            <select
              value={icpId ?? ''}
              onChange={(e) => setIcpId(e.target.value || null)}
              style={{ ...inputStyle, maxWidth: 320, width: 'auto' }}
            >
              {detail.icps.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          )}
          {!creating && (
            <button onClick={() => setCreating(true)} style={primaryBtn(true, false)}>+ new ICP</button>
          )}
          {creating && (
            <>
              <input
                autoFocus
                placeholder="ICP name"
                value={newIcpName}
                onChange={(e) => setNewIcpName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createIcp(); if (e.key === 'Escape') { setCreating(false); setNewIcpName('') } }}
                style={{ ...inputStyle, maxWidth: 260, width: 'auto' }}
              />
              <button onClick={() => void createIcp()} disabled={!newIcpName.trim() || createBusy} style={primaryBtn(!!newIcpName.trim(), createBusy)}>
                {createBusy ? 'creating…' : 'create'}
              </button>
              <button onClick={() => { setCreating(false); setNewIcpName('') }} style={ghostBtn}>cancel</button>
            </>
          )}
        </div>
      )}

      {detail && detail.icps.length === 0 && !creating && (
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: 20,
          fontFamily: T.mono, fontSize: 14, color: T.textMuted,
        }}>
          This store has no ICPs yet. Click <strong>+ new ICP</strong> above to create the first one.
        </div>
      )}

      {detail && selectedIcp && (
        <>
          <IcpFields detail={detail} icp={selectedIcp} onSaved={reloadDetail} />
          <ReferenceTracks detail={detail} icp={selectedIcp} onChanged={reloadDetail} />
        </>
      )}
    </div>
  )
}

type IcpWithRefs = StoreDetail['icps'][number]

function IcpFields({ detail: _detail, icp, onSaved }: { detail: StoreDetail; icp: IcpWithRefs; onSaved: () => void }) {
  const [draft, setDraft] = useState<IcpUpdate>(() => extractIcp(icp))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setDraft(extractIcp(icp)); setErr(null) }, [icp.id, icp.updatedAt])

  const set = <K extends keyof IcpUpdate>(k: K, v: IcpUpdate[K]) => setDraft({ ...draft, [k]: v })
  const dirty = JSON.stringify(draft) !== JSON.stringify(extractIcp(icp))

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      await api.updateIcp(icp.id, draft, token)
      onSaved()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <Section title={`Psychographic profile — ${icp.name}`} subtitle={`updated ${new Date(icp.updatedAt).toLocaleString()}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {ICP_FIELDS.map((f) => (
          <div key={String(f.key)} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            width: '100%', maxWidth: W[f.width],
          }}>
            <label style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{f.label}</label>
            {f.rows === 1 ? (
              <input
                value={(draft[f.key] as string | null) ?? ''}
                onChange={(e) => set(f.key, e.target.value || null)}
                style={inputStyle}
              />
            ) : (
              <textarea
                rows={f.rows}
                value={(draft[f.key] as string | null) ?? ''}
                onChange={(e) => set(f.key, e.target.value || null)}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 28 * f.rows, lineHeight: 1.5 }}
              />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button
          onClick={save}
          disabled={busy || !dirty}
          style={primaryBtn(dirty, busy)}
        >{busy ? 'saving…' : 'save profile'}</button>
        {err && <span style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>
    </Section>
  )
}

function extractIcp(icp: IcpWithRefs): IcpUpdate {
  const out: IcpUpdate = {}
  for (const f of ICP_FIELDS) (out as any)[f.key] = (icp as any)[f.key] ?? null
  return out
}

function ReferenceTracks({ detail: _detail, icp, onChanged }: { detail: StoreDetail; icp: IcpWithRefs; onChanged: () => void }) {
  const [adding, setAdding] = useState<NewReferenceTrack | null>(null)
  const grouped: Record<TasteCategory, ReferenceTrackRow[]> = {
    FormationEra: [], Subculture: [], Aspirational: [],
  }
  for (const r of icp.referenceTracks) grouped[r.bucket].push(r)

  return (
    <Section title={`Reference tracks — ${icp.name}`} subtitle={`${icp.referenceTracks.length} total — bucket describes the ICP's relationship to the music`}>
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setAdding(adding ? null : { bucket: 'FormationEra', artist: '', title: '', year: null, operatorNotes: null })}
          style={primaryBtn(!adding, false)}
        >{adding ? 'cancel' : '+ new reference'}</button>
      </div>
      {adding && (
        <NewRefTrackRow
          icpId={icp.id}
          draft={adding}
          onChange={setAdding}
          onCreated={() => { setAdding(null); onChanged() }}
        />
      )}
      {BUCKETS.map((b) => (
        <div key={b} style={{ marginBottom: 22 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          }}>
            <Pill tone="muted" variant="soft" uppercase>{b}</Pill>
            <span style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono }}>
              {grouped[b].length}
            </span>
          </div>
          {grouped[b].length === 0 && (
            <div style={{ color: T.textDim, fontSize: 14, fontFamily: T.mono, padding: '4px 0' }}>none</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {grouped[b].map((r) => (
              <RefTrackRow key={r.id} track={r} onChanged={onChanged} />
            ))}
          </div>
        </div>
      ))}
    </Section>
  )
}

function NewRefTrackRow({ icpId, draft, onChange, onCreated }: {
  icpId: string
  draft: NewReferenceTrack
  onChange: (d: NewReferenceTrack) => void
  onCreated: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = draft.artist.trim() && draft.title.trim()
  const create = async () => {
    const token = getToken(); if (!token || !valid) return
    setBusy(true); setErr(null)
    try {
      await api.createReferenceTrack(icpId, draft, token)
      onCreated()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }
  return (
    <div style={{
      background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
      borderRadius: 4, padding: 12, marginBottom: 14, display: 'grid',
      gridTemplateColumns: '140px 1fr 1fr 90px', gap: 8,
    }}>
      <select value={draft.bucket} onChange={(e) => onChange({ ...draft, bucket: e.target.value as TasteCategory })} style={inputStyle}>
        {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <input value={draft.artist} placeholder="artist" onChange={(e) => onChange({ ...draft, artist: e.target.value })} style={inputStyle} />
      <input value={draft.title} placeholder="title" onChange={(e) => onChange({ ...draft, title: e.target.value })} style={inputStyle} />
      <input
        value={draft.year ?? ''} placeholder="year"
        onChange={(e) => onChange({ ...draft, year: e.target.value ? parseInt(e.target.value, 10) || null : null })}
        style={inputStyle}
      />
      <textarea
        rows={2}
        value={draft.operatorNotes ?? ''}
        placeholder="operator notes (producer-ear hints — sidechain, flammed snare, etc.)"
        onChange={(e) => onChange({ ...draft, operatorNotes: e.target.value || null })}
        style={{ ...inputStyle, gridColumn: '1 / -1', resize: 'vertical', lineHeight: 1.4 }}
      />
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={create} disabled={busy || !valid} style={primaryBtn(!!valid, busy)}>
          {busy ? 'creating…' : 'create'}
        </button>
        {err && <span style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>
    </div>
  )
}

function RefTrackRow({ track, onChanged }: { track: ReferenceTrackRow; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftNotes, setDraftNotes] = useState(track.operatorNotes ?? '')
  const [busy, setBusy] = useState<'save' | 'delete' | 'decompose' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setDraftNotes(track.operatorNotes ?? '') }, [track.operatorNotes])

  const saveNotes = async () => {
    const token = getToken(); if (!token) return
    setBusy('save'); setErr(null)
    try {
      await api.updateReferenceTrack(track.id, { operatorNotes: draftNotes || null }, token)
      setEditing(false)
      onChanged()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const remove = async () => {
    const token = getToken(); if (!token) return
    setBusy('delete'); setErr(null)
    try {
      await api.deleteReferenceTrack(track.id, token)
      onChanged()
    } catch (e: any) { setErr(e.message); setBusy(null) }
  }

  const runDecompose = async (force = false) => {
    const token = getToken(); if (!token) return
    setBusy('decompose'); setErr(null)
    try {
      await api.decomposeReferenceTrack(track.id, force, token)
      setExpanded(true)
      onChanged()
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy(null) }
  }

  const dec = track.styleAnalysis
  const verified = dec?.status === 'verified'

  return (
    <div style={{
      border: `1px solid ${expanded ? T.borderActive : T.borderSubtle}`, borderRadius: 4,
      background: expanded ? T.surfaceRaised : T.surface, overflow: 'hidden',
      transition: 'border-color 0.15s ease, background 0.15s ease',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, 1fr) minmax(200px, 2fr) 60px auto auto',
        gap: 12, padding: '12px 16px', alignItems: 'center',
      }}>
        <span style={{ fontSize: 14, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>{track.artist}</span>
        <span style={{ fontSize: 14, fontFamily: T.sans, color: T.textMuted, fontStyle: 'italic' }}>{track.title}</span>
        <span style={{ fontSize: 14, fontFamily: T.mono, color: T.textDim }}>{track.year ?? ''}</span>
        <DecompositionBadge dec={dec} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => runDecompose(verified)}
            disabled={busy === 'decompose'}
            style={ghostBtn}
            title={verified ? 'overwrite verified decomposition' : 'run decomposer'}
          >{busy === 'decompose' ? '…' : 'Decompose'}</button>
          <button onClick={() => setExpanded(!expanded)} style={ghostBtn} title={expanded ? 'collapse' : 'expand'}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${T.borderSubtle}`, padding: 14, background: T.bg }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>operator notes</label>
              {!editing && (
                <button onClick={() => setEditing(true)} style={ghostBtn}>edit</button>
              )}
            </div>
            {editing ? (
              <>
                <textarea
                  rows={3}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                  placeholder="producer-ear hints injected as authoritative context"
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={saveNotes} disabled={busy === 'save'} style={primaryBtn(true, busy === 'save')}>
                    {busy === 'save' ? 'saving…' : 'save'}
                  </button>
                  <button onClick={() => { setEditing(false); setDraftNotes(track.operatorNotes ?? '') }} style={ghostBtn}>cancel</button>
                </div>
              </>
            ) : (
              <div style={{
                fontFamily: T.mono, fontSize: 14, color: track.operatorNotes ? T.text : T.textDim,
                padding: '6px 0', whiteSpace: 'pre-wrap', lineHeight: 1.5,
              }}>{track.operatorNotes ?? '(none)'}</div>
            )}
          </div>

          {dec ? (
            <DecompositionEditor dec={dec} onChanged={onChanged} />
          ) : (
            <div style={{ fontSize: 14, fontFamily: T.mono, color: T.textDim }}>
              no decomposition yet — click "decompose" to run it
            </div>
          )}

          {err && <div style={{ marginTop: 10, fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

          <div style={{
            marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.borderSubtle}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <ConfirmDelete
              label="Delete reference track"
              entity={`${track.artist} — ${track.title}`}
              busy={busy === 'delete'}
              onConfirm={remove}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function DecompositionBadge({ dec }: { dec: StyleAnalysisRow | null }) {
  if (!dec) return <Pill tone="dim" variant="soft" uppercase>no decomp</Pill>
  const verified = dec.status === 'verified'
  const conf = dec.confidence
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <Pill tone={verified ? 'success' : 'muted'} variant="soft" uppercase>
        {verified ? 'verified' : 'draft'}
      </Pill>
      {conf && (
        <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, letterSpacing: '0.04em' }}>
          conf · {conf}
        </span>
      )}
    </div>
  )
}

const DECOMP_FIELDS: { key: keyof StyleAnalysisUpdate; label: string }[] = [
  { key: 'vibePitch', label: 'vibe pitch' },
  { key: 'eraProductionSignature', label: 'era production signature' },
  { key: 'instrumentationPalette', label: 'instrumentation palette' },
  { key: 'standoutElement', label: 'standout element' },
  { key: 'arrangementShape', label: 'arrangement shape' },
  { key: 'dynamicCurve', label: 'dynamic curve' },
  { key: 'vocalCharacter', label: 'vocal character' },
  { key: 'vocalArrangement', label: 'vocal arrangement' },
  { key: 'harmonicAndGroove', label: 'harmonic & groove' },
]

function DecompositionEditor({ dec, onChanged }: { dec: StyleAnalysisRow; onChanged: () => void }) {
  const [draft, setDraft] = useState<StyleAnalysisUpdate>(() => extractDec(dec))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setDraft(extractDec(dec)); setErr(null) }, [dec.id, dec.updatedAt])

  const set = <K extends keyof StyleAnalysisUpdate>(k: K, v: StyleAnalysisUpdate[K]) => setDraft({ ...draft, [k]: v })
  const dirty = JSON.stringify(draft) !== JSON.stringify(extractDec(dec))

  const persist = async (status?: 'draft' | 'verified') => {
    const token = getToken(); if (!token) return
    const body = status ? { ...draft, status } : draft
    setBusy(true); setErr(null)
    try {
      await api.updateStyleAnalysis(dec.id, body, token)
      onChanged()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const isVerified = dec.status === 'verified'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {isVerified && (
        <div style={{
          background: '#3d2a00', border: '1px solid #7a5500', borderRadius: 4,
          padding: '8px 12px', fontFamily: T.mono, fontSize: 14, color: '#f5c842',
        }}>
          ⚠ This decomposition is verified. Edits will revert it to draft — re-verify when done.
        </div>
      )}
      <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono }}>
        rules v{dec.styleAnalyzerInstructionsVersion} · status {dec.status}
        {dec.verifiedAt && ` · verified ${new Date(dec.verifiedAt).toLocaleString()}`}
      </div>
      <label style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>confidence</label>
      <select
        value={(draft.confidence as string) ?? ''}
        onChange={(e) => set('confidence', (e.target.value || null) as any)}
        style={{ ...inputStyle, maxWidth: 160 }}
      >
        <option value="">—</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      {DECOMP_FIELDS.map((f) => (
        <div key={String(f.key)} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{f.label}</label>
          <textarea
            rows={3}
            value={(draft[f.key] as string | null) ?? ''}
            onChange={(e) => set(f.key, (e.target.value || null) as any)}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button onClick={() => persist()} disabled={busy || !dirty} style={primaryBtn(dirty, busy)}>
          {busy ? 'saving…' : 'save edits'}
        </button>
        {dec.status !== 'verified' && (
          <button onClick={() => persist('verified')} disabled={busy} style={primaryBtn(true, busy)}>
            save & mark verified
          </button>
        )}
        {dec.status === 'verified' && (
          <button onClick={() => persist('draft')} disabled={busy} style={ghostBtn}>
            unverify
          </button>
        )}
        {err && <span style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>
    </div>
  )
}

function extractDec(d: StyleAnalysisRow): StyleAnalysisUpdate {
  return {
    confidence: (d.confidence as any) ?? null,
    vibePitch: d.vibePitch,
    eraProductionSignature: d.eraProductionSignature,
    instrumentationPalette: d.instrumentationPalette,
    standoutElement: d.standoutElement,
    arrangementShape: d.arrangementShape,
    dynamicCurve: d.dynamicCurve,
    vocalCharacter: d.vocalCharacter,
    vocalArrangement: d.vocalArrangement,
    harmonicAndGroove: d.harmonicAndGroove,
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, padding: 18,
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 14, padding: '7px 10px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 4, padding: '7px 14px',
    fontFamily: T.mono, fontSize: 14, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '4px 10px', borderRadius: 3, fontFamily: T.mono, fontSize: 13, cursor: 'pointer',
}

