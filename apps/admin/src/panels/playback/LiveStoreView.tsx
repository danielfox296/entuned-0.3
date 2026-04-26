import { useEffect, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, LiveStoreView as LiveStoreData, OutcomeWithPool, QueueEntry, PlaybackEventRow } from '../../api.js'
import { T } from '../../tokens.js'

const REFRESH_MS = 10000

export function LiveStoreView() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [data, setData] = useState<LiveStoreData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

  const load = async () => {
    if (!storeId) return
    const token = getToken(); if (!token) return
    try {
      setData(await api.liveStore(storeId, token))
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => {
    if (!storeId) { setData(null); return }
    setData(null)
    load()
  }, [storeId])

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (storeId && autoRefresh) {
      intervalRef.current = window.setInterval(load, REFRESH_MS)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [storeId, autoRefresh])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Live Store View</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Real-time per-store playback: active outcome, upcoming queue, override controls, recent events.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />
        {storeId && (
          <>
            <button onClick={load} style={ghostBtn}>refresh</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted, fontFamily: T.mono, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              auto-refresh ({REFRESH_MS / 1000}s)
            </label>
          </>
        )}
      </div>

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {storeId && !data && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {data && (
        <>
          <ActiveCard data={data} onChange={load} />
          <QueueCard queue={data.queue} fallbackTier={data.fallbackTier} reason={data.reason} />
          <OverridePicker data={data} onChanged={load} />
          <RecentEvents events={data.recentEvents} />
        </>
      )}
    </div>
  )
}

function StorePicker({ stores, storeId, onPick }: {
  stores: StoreSummary[] | null; storeId: string | null; onPick: (id: string) => void
}) {
  if (!stores) return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading stores…</div>
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
          <option key={s.id} value={s.id}>{s.clientName} — {s.name}</option>
        ))}
      </select>
    </div>
  )
}

function ActiveCard({ data, onChange }: { data: LiveStoreData; onChange: () => void }) {
  const a = data.active
  const sourceColor = a?.source === 'selection' ? T.warn : a?.source === 'schedule' ? T.success : T.textMuted
  const [busy, setBusy] = useState(false)
  const clear = async () => {
    const token = getToken(); if (!token) return
    if (!confirm('Clear the manual override and revert to schedule/default?')) return
    setBusy(true)
    try { await api.clearOutcomeSelection(data.store.id, token); onChange() }
    catch (e: any) { alert(e.message) }
    finally { setBusy(false) }
  }
  return (
    <Section title="Active outcome" subtitle={`${data.store.clientName} / ${data.store.name} · ${data.store.timezone}`}>
      {!a ? (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>no active outcome</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{a.outcomeTitle ?? a.outcomeId.slice(0, 8)}</div>
          <span style={{
            fontSize: 10, fontFamily: T.mono, color: sourceColor,
            border: `1px solid ${sourceColor}`, borderRadius: 3, padding: '2px 8px',
          }}>{a.source}</span>
          {a.expiresAt && (
            <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textMuted }}>
              expires {new Date(a.expiresAt).toLocaleString()}
            </span>
          )}
          {a.source === 'selection' && (
            <button onClick={clear} disabled={busy} style={dangerGhostBtn}>
              {busy ? '…' : 'clear override'}
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

function QueueCard({ queue, fallbackTier, reason }: {
  queue: QueueEntry[]; fallbackTier: string; reason: string | null
}) {
  return (
    <Section title="Next up" subtitle={`fallback tier: ${fallbackTier}${reason ? ` · ${reason}` : ''}`}>
      {queue.length === 0 ? (
        <div style={{ color: T.danger, fontFamily: T.mono, fontSize: 12 }}>queue empty — {reason ?? 'unknown'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queue.map((q, i) => (
            <div key={q.songId} style={{
              display: 'grid', gridTemplateColumns: '24px 1fr 1fr', gap: 12, padding: '8px 12px',
              background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`, borderRadius: 4,
              alignItems: 'center',
            }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accentMuted }}>{i + 1}</span>
              <span style={{ fontFamily: T.sans, fontSize: 12, color: T.text }}>
                {q.hookText ?? <span style={{ color: T.textDim }}>(hook {q.hookId.slice(0, 8)})</span>}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>
                {q.outcomeTitle ?? q.outcomeId.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function OverridePicker({ data, onChanged }: { data: LiveStoreData; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const apply = async (oc: OutcomeWithPool) => {
    const token = getToken(); if (!token) return
    if (oc.poolSize === 0 && !confirm(`"${oc.title}" has an empty pool for this store's ICP. Override anyway?`)) return
    if (!confirm(`Override the active outcome with "${oc.title}"? Lasts until the next schedule boundary (or 30 min minimum).`)) return
    setBusy(oc.outcomeId)
    try { await api.setOutcomeSelection(data.store.id, oc.outcomeId, token); onChanged() }
    catch (e: any) { alert(e.message) }
    finally { setBusy(null) }
  }
  const sorted = [...data.outcomes].sort((a, b) => b.poolSize - a.poolSize)
  return (
    <Section title="Mode override" subtitle="Force a specific outcome. Auto-expires at the next schedule boundary or 30 minutes minimum.">
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8,
      }}>
        {sorted.map((o) => {
          const isActive = data.active?.outcomeId === o.outcomeId
          const empty = o.poolSize === 0
          return (
            <button
              key={o.outcomeId}
              onClick={() => apply(o)}
              disabled={busy === o.outcomeId || isActive}
              style={{
                background: isActive ? T.accentGlow : T.surfaceRaised,
                border: `1px solid ${isActive ? T.accent : T.border}`,
                borderRadius: 4, padding: '10px 12px', textAlign: 'left',
                fontFamily: T.sans, fontSize: 12, color: T.text,
                cursor: isActive ? 'default' : 'pointer',
                display: 'flex', flexDirection: 'column', gap: 4,
                opacity: busy === o.outcomeId ? 0.6 : 1,
              }}
            >
              <span style={{ fontWeight: 500 }}>{o.title}</span>
              <span style={{ fontSize: 10, fontFamily: T.mono, color: empty ? T.danger : T.textMuted }}>
                pool: {o.poolSize}{isActive ? ' · active' : ''}
              </span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

function RecentEvents({ events }: { events: PlaybackEventRow[] }) {
  return (
    <Section title="Recent events" subtitle={`last ${events.length}`}>
      {events.length === 0 ? (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>no events</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {events.map((e) => <EventRow key={e.id} event={e} />)}
        </div>
      )}
    </Section>
  )
}

function EventRow({ event }: { event: PlaybackEventRow }) {
  const t = new Date(event.occurredAt).toLocaleTimeString()
  const color = eventColor(event.eventType)
  const detail = eventDetail(event)
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '80px 160px 1fr', gap: 12, padding: '5px 8px',
      fontFamily: T.mono, fontSize: 11, alignItems: 'center',
      borderBottom: `1px solid ${T.borderSubtle}`,
    }}>
      <span style={{ color: T.textDim }}>{t}</span>
      <span style={{ color }}>{event.eventType}</span>
      <span style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
    </div>
  )
}

function eventColor(type: string): string {
  if (type.startsWith('outcome_selection')) return T.warn
  if (type === 'song_skip' || type === 'song_report') return T.danger
  if (type === 'song_love' || type === 'song_complete') return T.success
  if (type === 'playback_starved') return T.danger
  return T.text
}

function eventDetail(e: PlaybackEventRow): string {
  const parts: string[] = []
  if (e.outcomeTitle) parts.push(e.outcomeTitle)
  if (e.reportReason) parts.push(`reason: ${e.reportReason}`)
  if (e.operatorEmail) parts.push(`by ${e.operatorEmail}`)
  if (e.songId) parts.push(`song ${e.songId.slice(0, 8)}`)
  return parts.join(' · ')
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, padding: 18,
    }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '5px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
}

const dangerGhostBtn: CSSProperties = {
  ...ghostBtn, borderColor: T.danger, color: T.danger,
}
