import { useEffect, useState, useRef, useCallback } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, LiveStoreView as LiveStoreData, OutcomeWithPool, QueueEntry, PlaybackEventRow } from '../../api.js'
import { T } from '../../tokens.js'
import {
  Button, Section, PanelHeader, StorePicker, Pill, S, useStoreSelection,
} from '../../ui/index.js'

const REFRESH_MS = 10000

export function LiveStoreView() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [data, setData] = useState<LiveStoreData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

  const load = useCallback(async () => {
    if (!storeId) return
    const token = getToken(); if (!token) return
    try {
      setData(await api.liveStore(storeId, token))
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [storeId])

  useEffect(() => {
    if (!storeId) { setData(null); return }
    setData(null)
    load()
  }, [storeId, load])

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (storeId && autoRefresh) {
      intervalRef.current = window.setInterval(load, REFRESH_MS)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [storeId, autoRefresh, load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Live Store View"
        subtitle="Real-time per-store playback: active outcome, override controls, upcoming queue, recent events."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />
        {storeId && (
          <>
            <Button variant="ghost" onClick={load}>refresh</Button>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: S.small, color: T.textMuted, fontFamily: T.sans, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              auto-refresh ({REFRESH_MS / 1000}s)
            </label>
          </>
        )}
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {storeId && !data && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {data && (
        <>
          <ActiveAndOverride data={data} onChange={load} />
          <QueueCard queue={data.queue} fallbackTier={data.fallbackTier} reason={data.reason} />
          <RecentEvents events={data.recentEvents} />
        </>
      )}
    </div>
  )
}

function ActiveAndOverride({ data, onChange }: { data: LiveStoreData; onChange: () => void }) {
  const a = data.active
  const sourceTone: 'warn' | 'success' | 'muted' =
    a?.source === 'selection' ? 'warn' :
    a?.source === 'schedule' ? 'success' : 'muted'

  const [busy, setBusy] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const clear = async () => {
    const token = getToken(); if (!token) return
    setBusy('clear')
    try { await api.clearOutcomeSelection(data.store.id, token); onChange() }
    catch (e: any) { alert(e.message) }
    finally { setBusy(null) }
  }

  const apply = async (oc: OutcomeWithPool) => {
    if (oc.poolSize === 0) {
      if (!window.confirm(`"${oc.title}" has no songs available — playback will be silent. Continue?`)) return
    }
    const token = getToken(); if (!token) return
    setBusy(oc.outcomeId)
    try { await api.setOutcomeSelection(data.store.id, oc.outcomeId, token); setShowPicker(false); onChange() }
    catch (e: any) { alert(e.message) }
    finally { setBusy(null) }
  }

  const sorted = [...data.outcomes].sort((x, y) => {
    if (x.outcomeId === a?.outcomeId) return -1
    if (y.outcomeId === a?.outcomeId) return 1
    return x.title.localeCompare(y.title)
  })

  return (
    <Section
      title="Active outcome"
      subtitle={`${data.store.clientName} / ${data.store.name} · ${data.store.timezone}`}
    >
      {!a ? (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>no active outcome</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ fontSize: S.title, fontFamily: T.sans, fontWeight: 500, color: T.text }}>
            {a.outcomeTitle ?? a.outcomeId.slice(0, 8)}
          </div>
          <Pill tone={sourceTone}>{a.source}</Pill>
          {a.expiresAt && (
            <span style={{ fontSize: S.small, fontFamily: T.sans, color: T.textMuted }}>
              expires {new Date(a.expiresAt).toLocaleString()}
            </span>
          )}
          <Button variant="ghost" onClick={() => setShowPicker((s) => !s)}>
            {showPicker ? 'cancel' : 'override'}
          </Button>
          {a.source === 'selection' && (
            <Button variant="danger" onClick={clear} busy={busy === 'clear'}>
              {busy === 'clear' ? '…' : 'clear override'}
            </Button>
          )}
        </div>
      )}

      {showPicker && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8,
          paddingTop: 12,
          borderTop: `1px solid ${T.borderSubtle}`,
          marginTop: 4,
        }}>
          {sorted.map((o) => {
            const isActive = a?.outcomeId === o.outcomeId
            const empty = o.poolSize === 0
            return (
              <button
                key={o.outcomeId}
                onClick={() => apply(o)}
                disabled={busy === o.outcomeId || isActive}
                style={{
                  background: isActive ? T.accentGlow : T.surfaceRaised,
                  border: `1px solid ${isActive ? T.accent : T.border}`,
                  borderRadius: S.r4,
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontFamily: T.sans,
                  fontSize: S.small,
                  color: T.text,
                  cursor: isActive ? 'default' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  opacity: busy === o.outcomeId ? 0.6 : 1,
                }}
              >
                <span style={{ fontWeight: 500 }}>{o.title}</span>
                <span style={{
                  fontSize: S.label,
                  fontFamily: T.sans,
                  color: empty ? T.danger : T.textMuted,
                }}>
                  pool: {o.poolSize}{isActive ? ' · active' : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

function QueueCard({ queue, fallbackTier, reason }: {
  queue: QueueEntry[]; fallbackTier: string; reason: string | null
}) {
  return (
    <Section
      title="Next up"
      subtitle={`fallback tier: ${fallbackTier}${reason ? ` · ${reason}` : ''}`}
    >
      {queue.length === 0 ? (
        <div style={{ color: T.danger, fontFamily: T.sans, fontSize: S.small }}>queue empty — {reason ?? 'unknown'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queue.map((q, i) => (
            <div key={q.songId} style={{
              display: 'grid',
              gridTemplateColumns: '24px 1fr 1fr',
              gap: 12,
              padding: '8px 12px',
              background: T.surfaceRaised,
              border: `1px solid ${T.borderSubtle}`,
              borderRadius: S.r4,
              alignItems: 'center',
            }}>
              <span style={{ fontFamily: T.sans, fontSize: S.small, color: T.accentMuted }}>{i + 1}</span>
              <span style={{ fontFamily: T.sans, fontSize: S.small, color: T.text }}>
                {q.hookText ?? <span style={{ color: T.textDim }}>(hook {q.hookId.slice(0, 8)})</span>}
              </span>
              <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textMuted }}>
                {q.outcomeTitle ?? q.outcomeId.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function RecentEvents({ events }: { events: PlaybackEventRow[] }) {
  return (
    <Section title="Recent events" subtitle={`last ${events.length}`}>
      {events.length === 0 ? (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>no events</div>
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
      display: 'grid',
      gridTemplateColumns: '80px 160px 1fr',
      gap: 12,
      padding: '5px 8px',
      fontFamily: T.sans,
      fontSize: S.small,
      alignItems: 'center',
      borderBottom: `1px solid ${T.borderSubtle}`,
    }}>
      <span style={{ color: T.textDim }}>{t}</span>
      <span style={{ color }}>{event.eventType}</span>
      <span style={{
        color: T.textMuted,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{detail}</span>
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
