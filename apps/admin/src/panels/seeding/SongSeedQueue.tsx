import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { SongSeedRow, StoreSummary, OutcomeRowFull, SeedBuilderResult, SongSeedStatus } from '../../api.js'
import { T } from '../../tokens.js'
import { PanelHeader, StorePicker as UIStorePicker, S, useStoreSelection } from '../../ui/index.js'
import { SongSeed } from './SongSeed.js'

const FILTERS: { key: string; label: string; status?: SongSeedStatus; claimedBy?: string }[] = [
  { key: 'pending', label: 'pending', status: 'queued', claimedBy: 'unclaimed' },
  { key: 'mine', label: 'in progress (mine)', status: 'queued', claimedBy: 'me' },
  { key: 'all_queued', label: 'all queued', status: 'queued' },
  { key: 'accepted', label: 'accepted', status: 'accepted' },
  { key: 'abandoned', label: 'abandoned', status: 'abandoned' },
  { key: 'skipped', label: 'skipped', status: 'skipped' },
  { key: 'failed', label: 'failed', status: 'failed' },
]

export function SongSeedQueue() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [icpId, setIcpId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('pending')
  const [songSeeds, setSongSeeds] = useState<SongSeedRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<SeedBuilderResult | null>(null)
  const [runOutcome, setRunOutcome] = useState<string>('')
  const [runN, setRunN] = useState(1)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  const currentStore = storeId && stores ? stores.find((x) => x.id === storeId) ?? null : null
  const storeIcps = currentStore?.icps ?? []
  const selectedIcp = icpId ? storeIcps.find((i) => i.id === icpId) ?? null : null

  useEffect(() => {
    if (!storeId || !stores) { setIcpId(null); return }
    const s = stores.find((x) => x.id === storeId)
    // Default to first ICP; if current selection is no longer present, reset.
    if (!s || s.icps.length === 0) { setIcpId(null); return }
    setIcpId((cur) => (cur && s.icps.some((i) => i.id === cur)) ? cur : s.icps[0]!.id)
  }, [storeId, stores])

  const reload = async () => {
    if (!icpId) { setSongSeeds(null); return }
    const token = getToken(); if (!token) return
    const f = FILTERS.find((x) => x.key === filter)
    try {
      setSongSeeds(await api.songSeeds(token, {
        icpId, status: f?.status, claimedBy: f?.claimedBy, limit: 100,
      }))
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { reload() }, [icpId, filter])

  const launch = async () => {
    const token = getToken(); if (!token || !icpId || !runOutcome) return
    setRunning(true); setRunResult(null); setErr(null)
    try {
      const result = await api.runSeedBuilder({ icpId, outcomeId: runOutcome, n: runN }, token)
      setRunResult(result)
      reload()
    } catch (e: any) { setErr(e.message) }
    finally { setRunning(false) }
  }

  if (openId) {
    return <SongSeed songSeedId={openId} onClose={() => { setOpenId(null); reload() }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Song Seed Queue"
        subtitle="Generate Song Seeds, claim them, paste prompts into Suno, seed accepted takes."
      />

      <UIStorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {currentStore && storeIcps.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase' }}>ICP</span>
          <select value={icpId ?? ''} onChange={(e) => setIcpId(e.target.value || null)} style={inputStyle} disabled={storeIcps.length === 1}>
            {storeIcps.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      )}

      {currentStore && storeIcps.length === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 14 }}>
          this store has no ICPs yet — create one in the ICP Editor first
        </div>
      )}

      {icpId && (
        <Section title="Run Seed Builder" subtitle="Generates SongSeeds for the selected ICP and Outcome. Each seed is permanently bound to one ICP.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: T.mono, fontSize: 13, color: T.accent,
              border: `1px solid ${T.accentMuted}`, borderRadius: 3, padding: '6px 10px',
            }}>
              ICP: {selectedIcp?.name ?? icpId.slice(0, 8)}
            </span>
            <span style={{ color: T.textDim, fontFamily: T.mono }}>+</span>
            <select value={runOutcome} onChange={(e) => setRunOutcome(e.target.value)} style={inputStyle}>
              <option value="" disabled>— pick outcome —</option>
              {(outcomes ?? []).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
            <input type="number" min={1} max={20} value={runN} onChange={(e) => setRunN(parseInt(e.target.value, 10) || 1)} style={{ ...inputStyle, width: 80 }} />
            <button onClick={launch} disabled={running || !runOutcome} style={primaryBtn(!!runOutcome, running)}>
              {running ? 'running…' : `run (${runN})`}
            </button>
          </div>
          {runResult && (
            <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 14, color: T.textMuted }}>
              produced {runResult.producedN}/{runResult.requestedN} · {runResult.reason}
              {runResult.errors.length > 0 && (
                <div style={{ color: T.danger, marginTop: 4 }}>
                  errors: {runResult.errors.join('; ')}
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {icpId && (
        <>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => {
              const on = filter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  style={{
                    background: on ? T.surfaceRaised : 'transparent',
                    border: `1px solid ${on ? T.accent : T.border}`,
                    color: on ? T.accent : T.textMuted,
                    padding: '6px 12px', borderRadius: 4,
                    fontFamily: T.mono, fontSize: 14, cursor: 'pointer',
                  }}
                >{f.label}</button>
              )
            })}
            <button onClick={reload} style={ghostBtn}>refresh</button>
          </div>

          {!songSeeds && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

          {songSeeds && songSeeds.length === 0 && (
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 14, padding: '12px 0' }}>
              no songSeeds match
            </div>
          )}

          {songSeeds && songSeeds.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {songSeeds.map((s) => <SeedListRow key={s.id} sub={s} onOpen={() => setOpenId(s.id)} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SeedListRow({ sub, onOpen }: { sub: SongSeedRow; onOpen: () => void }) {
  const statusColor = statusColorOf(sub.status)
  return (
    <div
      onClick={onOpen}
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: '90px 1fr 1fr 110px', gap: 14, alignItems: 'center',
      }}
    >
      <span style={{
        fontSize: 13, fontFamily: T.mono, color: statusColor,
        border: `1px solid ${statusColor}`, borderRadius: 3, padding: '2px 8px', textAlign: 'center',
      }}>{sub.status}{sub.claimedById ? ' · claimed' : ''}</span>
      <span style={{ fontSize: 14, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sub.title ?? sub.hook.text}
      </span>
      <span style={{ fontSize: 13, fontFamily: T.mono, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sub.outcome.title} · {sub.referenceTrack ? `${sub.referenceTrack.artist} — ${sub.referenceTrack.title}` : 'no ref'}
      </span>
      <span style={{ fontSize: 13, fontFamily: T.mono, color: T.textDim, textAlign: 'right' }}>
        {new Date(sub.createdAt).toLocaleString()}
      </span>
    </div>
  )
}

function statusColorOf(s: SongSeedStatus): string {
  switch (s) {
    case 'queued': return T.warn
    case 'accepted': return T.success
    case 'abandoned': return T.textDim
    case 'skipped': return T.textDim
    case 'failed': return T.danger
    case 'assembling': return T.accentMuted
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 14, padding: '7px 10px', borderRadius: 4, outline: 'none',
  boxSizing: 'border-box',
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
  padding: '5px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 13, cursor: 'pointer',
}
