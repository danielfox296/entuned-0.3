import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { IcpDetail, IcpUpdate } from '../../api.js'
import { T } from '@entuned/tokens'
import { S, useToast, useStoreSelection, useIcpSelection } from '../../ui/index.js'

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

export function IcpEditor({ onIcpsChanged }: { onIcpsChanged?: () => Promise<void> | void } = {}) {
  // The ICP comes from the shell's header selector, which can reach an ICP with
  // no location — that's the only way to edit a Station's ICP (Card 23).
  // `storeId` is still read, but only to decide whether "+ new ICP" is possible:
  // POST /admin/icps parents the new ICP to a location.
  const [storeId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()
  const [detail, setDetail] = useState<IcpDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newIcpName, setNewIcpName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const reloadDetail = async () => {
    if (!icpId) { setDetail(null); return }
    const token = getToken(); if (!token) return
    try {
      setDetail(await api.icpDetail(icpId, token))
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => {
    setDetail(null)
    void reloadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icpId])

  const createIcp = async () => {
    if (!storeId || !newIcpName.trim()) return
    const token = getToken(); if (!token) return
    setCreateBusy(true); setErr(null)
    try {
      const created = await api.createIcp({ storeId, name: newIcpName.trim() }, token)
      setCreating(false); setNewIcpName('')
      // Await the list refresh before selecting — the header's reconcile snaps
      // an unknown icpId back to the first row of whatever list it has.
      await onIcpsChanged?.()
      setIcpId(created.id)
    } catch (e: any) { setErr(e.message) }
    finally { setCreateBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      {!icpId && !storeId && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          pick a client above to begin
        </div>
      )}
      {!icpId && storeId && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          this location has no ICPs yet — click <strong>+ new ICP</strong> below to create the first one
        </div>
      )}

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            disabled={!storeId}
            title={storeId ? undefined : 'pick a location above — a new ICP is parented to one'}
            style={primaryBtn(!!storeId, false)}
          >+ new ICP</button>
        )}
        {!storeId && (
          <span style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim, fontStyle: 'italic' }}>
            pick a location to create a new ICP
          </span>
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

      {icpId && !detail && !err && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {detail && <IcpFields detail={detail} onSaved={reloadDetail} />}
    </div>
  )
}

function IcpFields({ detail, onSaved }: { detail: IcpDetail; onSaved: () => void }) {
  const icp = detail.icp
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

  // Where this ICP lives. A station ICP has no locations, which without this
  // line reads as "something is missing" rather than "this is a shared pool".
  const scope = icp.station
    ? `station pool · ${icp.station.displayName}${detail.stores.length > 0 ? ` · ${detail.stores.length} location${detail.stores.length === 1 ? '' : 's'} listening` : ' · no locations on it yet'}`
    : detail.stores.length > 0
      ? detail.stores.map((s) => s.name).join(', ')
      : 'no locations'

  return (
    <Section
      title={`Psychographic profile — ${icp.name}`}
      subtitle={`${detail.client.name} · ${scope} · updated ${new Date(icp.updatedAt).toLocaleString()}`}
    >
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

function extractIcp(icp: IcpDetail['icp']): IcpUpdate {
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

