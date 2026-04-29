import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreDetail, IcpUpdate } from '../../api.js'
import { T } from '../../tokens.js'
import { S, useToast, useStoreSelection } from '../../ui/index.js'

// Width per field (px). Compact for short scalars, prose for paragraphs.
type FieldWidth = 'compact' | 'short' | 'prose'
const W = {
  compact: 240,   // single-word / short-phrase scalars
  short:   320,   // medium scalars (name, location)
  prose:   640,   // long-form paragraphs — readable column
} as const

const ICP_FIELDS: { key: keyof IcpUpdate; label: string; rows: number; width: FieldWidth; hint?: string }[] = [
  { key: 'name', label: 'name', rows: 1, width: 'short', hint: 'short label for this customer profile (e.g. "Mindful Mover")' },
  { key: 'ageRange', label: 'age range', rows: 1, width: 'compact', hint: 'e.g. 28–45 (skews 32–40)' },
  { key: 'location', label: 'geography', rows: 1, width: 'short', hint: 'where they live, work, vacation' },
  { key: 'politicalSpectrum', label: 'political spectrum', rows: 1, width: 'compact', hint: 'general lean; only as relevant to their tastes' },
  { key: 'openness', label: 'openness', rows: 2, width: 'prose', hint: 'how curious / experimental they are about new things' },
  { key: 'fears', label: 'fears', rows: 3, width: 'prose', hint: 'what they are quietly afraid of — invisibility, irrelevance, decline, exclusion' },
  { key: 'values', label: 'values', rows: 3, width: 'prose', hint: 'what they believe in and signal — comma- or sentence-separated' },
  { key: 'desires', label: 'desires', rows: 3, width: 'prose', hint: 'what they openly want — to feel, to look, to belong to' },
  { key: 'unexpressedDesires', label: 'unexpressed desires', rows: 3, width: 'prose', hint: 'what they want but won\'t say out loud — permission, status, relief' },
  { key: 'turnOffs', label: 'turn-offs', rows: 3, width: 'prose', hint: 'aesthetics, sounds, behaviors that break the spell' },
]

export function IcpEditor() {
  const [storeId] = useStoreSelection()
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [icpId, setIcpId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newIcpName, setNewIcpName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

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
      {!storeId && <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>pick a location to begin</div>}

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
        <IcpFields detail={detail} icp={selectedIcp} onSaved={reloadDetail} />
      )}
    </div>
  )
}

type IcpWithRefs = StoreDetail['icps'][number]

function IcpFields({ detail: _detail, icp, onSaved }: { detail: StoreDetail; icp: IcpWithRefs; onSaved: () => void }) {
  const [draft, setDraft] = useState<IcpUpdate>(() => extractIcp(icp))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => { setDraft(extractIcp(icp)); setErr(null) }, [icp.id, icp.updatedAt])

  const set = <K extends keyof IcpUpdate>(k: K, v: IcpUpdate[K]) => setDraft({ ...draft, [k]: v })
  const dirty = JSON.stringify(draft) !== JSON.stringify(extractIcp(icp))

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      await api.updateIcp(icp.id, draft, token)
      onSaved()
      toast.success(`ICP "${icp.name}" saved`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save ICP') }
    finally { setBusy(false) }
  }

  return (
    <Section title={`Psychographic profile — ${icp.name}`} subtitle={`updated ${new Date(icp.updatedAt).toLocaleString()}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {ICP_FIELDS.filter((f) => f.rows === 1).map((f) => (
          <div key={String(f.key)} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            width: '100%', maxWidth: W[f.width],
          }}>
            <label style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{f.label}</label>
            <input
              value={(draft[f.key] as string | null) ?? ''}
              onChange={(e) => set(f.key, e.target.value || null)}
              style={inputStyle}
              title={f.hint}
            />
            {f.hint && <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.sans, fontStyle: 'italic' }}>{f.hint}</span>}
          </div>
        ))}
      </div>
      {/* Prose textareas use a 2-column subgrid (label on left, field on right) so the label can
          never get visually severed from its field by a scroll fold. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', columnGap: 16, rowGap: 14, marginTop: 16, alignItems: 'start' }}>
        {ICP_FIELDS.filter((f) => f.rows > 1).map((f) => (
          <div key={String(f.key)} style={{ display: 'contents' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8 }}>
              <label style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{f.label}</label>
              {f.hint && <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.sans, fontStyle: 'italic', lineHeight: 1.4 }}>{f.hint}</span>}
            </div>
            <textarea
              rows={f.rows}
              value={(draft[f.key] as string | null) ?? ''}
              onChange={(e) => set(f.key, e.target.value || null)}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 28 * f.rows, lineHeight: 1.5, maxWidth: W.prose }}
            />
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

