import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type {
  StoreSummary, StoreDetail, IcpUpdate, NewReferenceTrack, ReferenceTrackRow,
  DecompositionRow, DecompositionUpdate, Bucket,
} from '../../api.js'
import { T } from '../../tokens.js'

const ICP_FIELDS: { key: keyof IcpUpdate; label: string; rows: number }[] = [
  { key: 'name', label: 'name', rows: 1 },
  { key: 'ageRange', label: 'age range', rows: 1 },
  { key: 'location', label: 'location', rows: 1 },
  { key: 'politicalSpectrum', label: 'political spectrum', rows: 1 },
  { key: 'openness', label: 'openness', rows: 2 },
  { key: 'fears', label: 'fears', rows: 3 },
  { key: 'values', label: 'values', rows: 3 },
  { key: 'desires', label: 'desires', rows: 3 },
  { key: 'unexpressedDesires', label: 'unexpressed desires', rows: 3 },
  { key: 'turnOffs', label: 'turn-offs', rows: 3 },
]

const BUCKETS: Bucket[] = ['FormationEra', 'Subculture', 'Aspirational']

export function IcpEditor() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId) { setDetail(null); return }
    const token = getToken(); if (!token) return
    setDetail(null)
    api.storeDetail(storeId, token).then(setDetail).catch((e) => setErr(e.message))
  }, [storeId])

  const reloadDetail = async () => {
    if (!storeId) return
    const token = getToken(); if (!token) return
    try {
      const d = await api.storeDetail(storeId, token)
      setDetail(d)
    } catch (e: any) { setErr(e.message) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>ICP Editor</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Per-store ICP. Edit psychographic fields, manage reference tracks, run the decomposer.
        </div>
      </div>

      <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {storeId && !detail && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {detail && (
        <>
          {detail.sharedWith.length > 0 && <SharedNotice sharedWith={detail.sharedWith} />}
          <IcpFields detail={detail} onSaved={reloadDetail} />
          <ReferenceTracks detail={detail} onChanged={reloadDetail} />
        </>
      )}
    </div>
  )
}

function StorePicker({ stores, storeId, onPick }: {
  stores: StoreSummary[] | null
  storeId: string | null
  onPick: (id: string) => void
}) {
  if (!stores) return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading stores…</div>
  if (stores.length === 0) return <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>no stores</div>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>store</span>
      <select
        value={storeId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        style={{
          background: T.surface, border: `1px solid ${T.border}`, color: T.text,
          fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 4,
          outline: 'none', minWidth: 320,
        }}
      >
        <option value="" disabled>— pick a store —</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.clientName} — {s.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function SharedNotice({ sharedWith }: { sharedWith: { id: string; name: string; clientName: string }[] }) {
  return (
    <div style={{
      background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
      borderRadius: 4, padding: '10px 14px', fontFamily: T.mono, fontSize: 11,
      color: T.text,
    }}>
      <span style={{ color: T.accent }}>shared ICP</span> — also used by{' '}
      {sharedWith.map((s, i) => (
        <span key={s.id} style={{ color: T.textMuted }}>
          {s.clientName} / {s.name}{i < sharedWith.length - 1 ? ', ' : ''}
        </span>
      ))}. Edits affect every store using this ICP.
    </div>
  )
}

function IcpFields({ detail, onSaved }: { detail: StoreDetail; onSaved: () => void }) {
  const [draft, setDraft] = useState<IcpUpdate>(() => extractIcp(detail))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setDraft(extractIcp(detail)); setErr(null) }, [detail.icp.id, detail.icp.updatedAt])

  const set = <K extends keyof IcpUpdate>(k: K, v: IcpUpdate[K]) => setDraft({ ...draft, [k]: v })
  const dirty = JSON.stringify(draft) !== JSON.stringify(extractIcp(detail))

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      await api.updateIcp(detail.icp.id, draft, token)
      onSaved()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <Section title="Psychographic profile" subtitle={`updated ${new Date(detail.icp.updatedAt).toLocaleString()}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {ICP_FIELDS.map((f) => (
          <div key={String(f.key)} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{f.label}</label>
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
        {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>
    </Section>
  )
}

function extractIcp(d: StoreDetail): IcpUpdate {
  const out: IcpUpdate = {}
  for (const f of ICP_FIELDS) (out as any)[f.key] = (d.icp as any)[f.key] ?? null
  return out
}

function ReferenceTracks({ detail, onChanged }: { detail: StoreDetail; onChanged: () => void }) {
  const [adding, setAdding] = useState<NewReferenceTrack | null>(null)
  const grouped: Record<Bucket, ReferenceTrackRow[]> = {
    FormationEra: [], Subculture: [], Aspirational: [],
  }
  for (const r of detail.icp.referenceTracks) grouped[r.bucket].push(r)

  return (
    <Section title="Reference tracks" subtitle={`${detail.icp.referenceTracks.length} total — bucket describes the ICP's relationship to the music`}>
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => setAdding(adding ? null : { bucket: 'FormationEra', artist: '', title: '', year: null, operatorNotes: null })}
          style={primaryBtn(!adding, false)}
        >{adding ? 'cancel' : '+ new reference'}</button>
      </div>
      {adding && (
        <NewRefTrackRow
          icpId={detail.icp.id}
          draft={adding}
          onChange={setAdding}
          onCreated={() => { setAdding(null); onChanged() }}
        />
      )}
      {BUCKETS.map((b) => (
        <div key={b} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 10, color: T.accentMuted, fontFamily: T.mono,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
          }}>{b} ({grouped[b].length})</div>
          {grouped[b].length === 0 && (
            <div style={{ color: T.textDim, fontSize: 11, fontFamily: T.mono, padding: '4px 0' }}>none</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
      <select value={draft.bucket} onChange={(e) => onChange({ ...draft, bucket: e.target.value as Bucket })} style={inputStyle}>
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
        {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</span>}
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
    if (!confirm(`Delete "${track.artist} — ${track.title}"?`)) return
    setBusy('delete'); setErr(null)
    try {
      await api.deleteReferenceTrack(track.id, token)
      onChanged()
    } catch (e: any) { setErr(e.message); setBusy(null) }
  }

  const runDecompose = async (force = false) => {
    const token = getToken(); if (!token) return
    if (!confirm(force
      ? 'Overwrite the verified decomposition? This calls Anthropic with web search.'
      : 'Run decomposer? This calls Anthropic with web search and overwrites the existing draft.')) return
    setBusy('decompose'); setErr(null)
    try {
      await api.decomposeReferenceTrack(track.id, force, token)
      setExpanded(true)
      onChanged()
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy(null) }
  }

  const dec = track.decomposition
  const verified = dec?.status === 'verified'

  return (
    <div style={{
      border: `1px solid ${T.borderSubtle}`, borderRadius: 4,
      background: T.surface, overflow: 'hidden',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px auto auto', gap: 10, padding: '10px 12px', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>{track.artist}</span>
        <span style={{ fontSize: 12, fontFamily: T.sans, color: T.textMuted, fontStyle: 'italic' }}>{track.title}</span>
        <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim }}>{track.year ?? ''}</span>
        <DecompositionBadge dec={dec} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setExpanded(!expanded)} style={ghostBtn}>{expanded ? '▴' : '▾'}</button>
          <button
            onClick={() => runDecompose(verified)}
            disabled={busy === 'decompose'}
            style={ghostBtn}
            title={verified ? 'overwrite verified decomposition' : 'run decomposer'}
          >{busy === 'decompose' ? '…' : 'decompose'}</button>
          <button onClick={remove} disabled={busy === 'delete'} style={dangerGhostBtn}>×</button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${T.borderSubtle}`, padding: 14, background: T.bg }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>operator notes</label>
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
                fontFamily: T.mono, fontSize: 11, color: track.operatorNotes ? T.text : T.textDim,
                padding: '6px 0', whiteSpace: 'pre-wrap', lineHeight: 1.5,
              }}>{track.operatorNotes ?? '(none)'}</div>
            )}
          </div>

          {dec ? (
            <DecompositionEditor dec={dec} onChanged={onChanged} />
          ) : (
            <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
              no decomposition yet — click "decompose" to run it
            </div>
          )}

          {err && <div style={{ marginTop: 10, fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}
        </div>
      )}
    </div>
  )
}

function DecompositionBadge({ dec }: { dec: DecompositionRow | null }) {
  if (!dec) return <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim }}>no decomp</span>
  const verified = dec.status === 'verified'
  const conf = dec.confidence
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: T.mono, fontSize: 10 }}>
      <span style={{ color: verified ? T.success : T.accentMuted }}>{verified ? '✓ verified' : 'draft'}</span>
      {conf && <span style={{ color: T.textDim }}>conf: {conf}</span>}
    </div>
  )
}

const DECOMP_FIELDS: { key: keyof DecompositionUpdate; label: string }[] = [
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

function DecompositionEditor({ dec, onChanged }: { dec: DecompositionRow; onChanged: () => void }) {
  const [draft, setDraft] = useState<DecompositionUpdate>(() => extractDec(dec))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setDraft(extractDec(dec)); setErr(null) }, [dec.id, dec.updatedAt])

  const set = <K extends keyof DecompositionUpdate>(k: K, v: DecompositionUpdate[K]) => setDraft({ ...draft, [k]: v })
  const dirty = JSON.stringify(draft) !== JSON.stringify(extractDec(dec))

  const persist = async (status?: 'draft' | 'verified') => {
    const token = getToken(); if (!token) return
    const body = status ? { ...draft, status } : draft
    setBusy(true); setErr(null)
    try {
      await api.updateDecomposition(dec.id, body, token)
      onChanged()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono }}>
        rules v{dec.musicologicalRulesVersion} · status {dec.status}
        {dec.verifiedAt && ` · verified ${new Date(dec.verifiedAt).toLocaleString()}`}
      </div>
      <label style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>confidence</label>
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
          <label style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{f.label}</label>
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
        {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>
    </div>
  )
}

function extractDec(d: DecompositionRow): DecompositionUpdate {
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
        <div style={{ fontSize: 13, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 4, padding: '7px 14px',
    fontFamily: T.mono, fontSize: 11, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '4px 10px', borderRadius: 3, fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
}

const dangerGhostBtn: CSSProperties = {
  ...ghostBtn, borderColor: T.danger, color: T.danger,
}
