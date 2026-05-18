import { useEffect, useState, useCallback } from 'react'
import { api, getToken } from '../../api.js'
import type { LiveStoreView as LiveStoreData, OutcomeWithPool, QueueEntry, PlaybackEventRow, PlayerHealthSummary } from '../../api.js'
import { T } from '@entuned/tokens'
import {
  Button, Section, Pill, S, useStoreSelection,
} from '../../ui/index.js'

// Event-type categorization for the filter chips. Lets an operator mute the
// noisy lifecycle/cache events and focus on Listener actions or Health
// problems. Keep in sync with the AudioEventType union in api.ts.
type EventCategory = 'listener' | 'operator' | 'health' | 'cache' | 'lifecycle' | 'system'
const CATEGORY_OF: Record<string, EventCategory> = {
  // Listener — things the customer/listener did.
  song_start: 'listener', song_complete: 'listener', song_skip: 'listener',
  song_love: 'listener', song_report: 'listener', ad_play: 'listener',
  // Operator — deliberate human actions.
  operator_login: 'operator', operator_logout: 'operator',
  operator_pause: 'operator', operator_resume: 'operator',
  outcome_selection: 'operator', outcome_selection_cleared: 'operator',
  mediasession_action: 'operator',
  // Health — things that signal trouble.
  playback_starved: 'health', playback_stalled: 'health',
  playback_resumed_after_stall: 'health', song_load_failed: 'health',
  wake_lock_failed: 'health', interruption_suspected: 'health',
  // Cache — IndexedDB audio cache hits/misses.
  audio_cache_hit: 'cache', audio_cache_miss: 'cache',
  // Lifecycle — window/PWA/push state changes.
  pwa_standalone_launch: 'lifecycle',
  visibility_hidden: 'lifecycle', visibility_visible: 'lifecycle',
  wake_lock_acquired: 'lifecycle', wake_lock_released: 'lifecycle',
  push_subscribed: 'lifecycle', push_unsubscribed: 'lifecycle',
  // System — sensor sampling, heartbeats.
  room_loudness_sample: 'system', heartbeat: 'system',
}
function categoryOf(t: string): EventCategory { return CATEGORY_OF[t] ?? 'system' }

const CATEGORY_LABEL: Record<EventCategory, string> = {
  listener: 'Listener', operator: 'Operator', health: 'Health',
  cache: 'Cache', lifecycle: 'Lifecycle', system: 'System',
}
const CATEGORY_TONE: Record<EventCategory, string> = {
  listener: T.text, operator: T.warn, health: T.danger,
  cache: T.textMuted, lifecycle: T.textDim, system: T.textDim,
}

export function LiveStoreView() {
  const [storeId] = useStoreSelection()
  const [data, setData] = useState<LiveStoreData | null>(null)
  const [err, setErr] = useState<string | null>(null)

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!storeId && <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>pick a location to begin</div>}
        {storeId && <Button variant="ghost" onClick={load}>Refresh</Button>}
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {storeId && !data && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {data && (
        <>
          <ActiveAndOverride data={data} onChange={load} />
          <PlayerHealth storeId={storeId!} />
          <QueueCard queue={data.queue} fallbackTier={data.fallbackTier} reason={data.reason} />
          <RecentEvents storeId={storeId!} initialEvents={data.recentEvents} />
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
      title="Current Outcome"
      subtitle={`${data.store.clientName} / ${data.store.name} · ${data.store.timezone}`}
    >
      {!a ? (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>No current outcome</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ fontSize: S.title, fontFamily: T.sans, fontWeight: 500, color: T.text }}>
            {a.outcomeDisplayTitle ?? a.outcomeTitle ?? a.outcomeId.slice(0, 8)}
          </div>
          <Pill tone={sourceTone}>{
            a.source === 'selection' ? 'Outcome Selection' :
            a.source === 'schedule' ? 'Schedule' :
            a.source === 'default' ? 'Default' :
            a.source
          }</Pill>
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

function QueueCard({ queue, reason }: {
  queue: QueueEntry[]; fallbackTier: string; reason: string | null
}) {
  return (
    <Section
      title="Up next"
      subtitle={`song playback gap${reason ? ` · ${reason}` : ''}`}
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
                {q.title ?? q.hookText ?? <span style={{ color: T.textDim }}>—</span>}
              </span>
              <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textMuted }}>
                {q.outcomeDisplayTitle ?? q.outcomeTitle ?? q.outcomeId.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// Player Health summary — surfaces only the problem events for a store,
// bucketed per day. Replaces "scan the firehose for trouble" with one
// glanceable card. Defaults to a 7-day window; bumped via the day-picker.
function PlayerHealth({ storeId }: { storeId: string }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<PlayerHealthSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    setData(null); setErr(null)
    api.playerHealth(storeId, days, token).then(setData).catch((e: any) => setErr(e.message))
  }, [storeId, days])

  const total = data ? Object.values(data.totalsByType).reduce((a, b) => a + b, 0) : 0
  const severeRowStyle = { padding: '4px 8px', borderRadius: S.r4, fontSize: S.label, fontFamily: T.sans }

  return (
    <Section
      title="Player Health"
      subtitle={data ? `${total === 0 ? 'no problems' : `${total} problem event${total === 1 ? '' : 's'}`} in last ${days} days` : 'loading…'}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[1, 7, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              fontFamily: T.sans, fontSize: S.label, padding: '3px 9px', borderRadius: 999,
              border: `1px solid ${d === days ? T.accent : T.borderSubtle}`,
              background: d === days ? T.accentGlow : 'transparent',
              color: d === days ? T.text : T.textDim, cursor: 'pointer',
            }}
          >{d === 1 ? '24h' : `${d}d`}</button>
        ))}
      </div>
      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}
      {data && total === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>No stalls, starves, or load failures.</div>
      )}
      {data && total > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(data.totalsByType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <span key={type} style={{
                ...severeRowStyle,
                background: healthSeverity(type) === 'red' ? 'rgba(226,75,74,0.12)'
                  : healthSeverity(type) === 'orange' ? 'rgba(232,180,88,0.12)'
                  : 'rgba(120,120,120,0.10)',
                color: healthSeverity(type) === 'red' ? T.danger
                  : healthSeverity(type) === 'orange' ? T.warn
                  : T.textMuted,
                border: `1px solid ${healthSeverity(type) === 'red' ? 'rgba(226,75,74,0.35)'
                  : healthSeverity(type) === 'orange' ? 'rgba(232,180,88,0.30)'
                  : T.borderSubtle}`,
              }}>{prettyEventType(type)} · {count}</span>
            ))}
        </div>
      )}
    </Section>
  )
}

function healthSeverity(type: string): 'red' | 'orange' | 'yellow' {
  if (type === 'playback_starved' || type === 'song_load_failed') return 'red'
  if (type === 'playback_stalled' || type === 'interruption_suspected' || type === 'push_unsubscribed') return 'orange'
  return 'yellow'
}

// Reconstructs continuous-play "sessions" from raw events using
// playback_session_id stamped by the player. A session is one row in the
// grouped view: head + duration + summary counts. Click to expand into the
// raw sub-events. Events with no playback_session_id (lifecycle, sensor)
// render as ungrouped rows interleaved by time.
type SessionGroup = {
  kind: 'session'
  id: string
  startedAt: string
  endedAt: string
  events: PlaybackEventRow[]
  songCount: number
  problemCount: number
}
type LooseRow = { kind: 'loose'; event: PlaybackEventRow }
type GroupedRow = SessionGroup | LooseRow

function groupBySession(events: PlaybackEventRow[]): GroupedRow[] {
  const bySession = new Map<string, PlaybackEventRow[]>()
  const loose: PlaybackEventRow[] = []
  for (const e of events) {
    if (e.playbackSessionId) {
      const arr = bySession.get(e.playbackSessionId) ?? []
      arr.push(e)
      bySession.set(e.playbackSessionId, arr)
    } else {
      loose.push(e)
    }
  }
  const groups: SessionGroup[] = [...bySession.entries()].map(([id, evs]) => {
    const sorted = [...evs].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    return {
      kind: 'session',
      id,
      startedAt: sorted[0].occurredAt,
      endedAt: sorted[sorted.length - 1].occurredAt,
      events: sorted,
      songCount: sorted.filter((e) => e.eventType === 'song_start').length,
      problemCount: sorted.filter((e) => categoryOf(e.eventType) === 'health').length,
    }
  })
  const rows: GroupedRow[] = [
    ...groups,
    ...loose.map((event): LooseRow => ({ kind: 'loose', event })),
  ]
  // Newest first (matches the rest of the event stream).
  return rows.sort((a, b) => {
    const aTime = a.kind === 'session' ? a.endedAt : a.event.occurredAt
    const bTime = b.kind === 'session' ? b.endedAt : b.event.occurredAt
    return bTime.localeCompare(aTime)
  })
}

const ALL_CATEGORIES: EventCategory[] = ['listener', 'operator', 'health', 'cache', 'lifecycle', 'system']

function RecentEvents({ storeId, initialEvents }: { storeId: string; initialEvents: PlaybackEventRow[] }) {
  const [events, setEvents] = useState<PlaybackEventRow[]>(initialEvents)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(initialEvents.length < 30)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  // Mute the noisier categories by default so the operator sees the signal
  // first. Toggle on to unmute.
  const [excludedCats, setExcludedCats] = useState<Set<EventCategory>>(
    () => new Set<EventCategory>(['system', 'lifecycle', 'cache']),
  )
  const [groupBySessions, setGroupBySessions] = useState(true)

  useEffect(() => {
    setEvents(initialEvents)
    setExhausted(initialEvents.length < 30)
    setLoadErr(null)
  }, [initialEvents])

  const toggleCat = (c: EventCategory) => {
    const next = new Set(excludedCats)
    if (next.has(c)) next.delete(c); else next.add(c)
    setExcludedCats(next)
  }

  const visible = events.filter((e) => !excludedCats.has(categoryOf(e.eventType)))

  const loadOlder = async () => {
    const token = getToken(); if (!token) return
    const oldest = events[events.length - 1]
    if (!oldest) return
    setLoadingMore(true)
    setLoadErr(null)
    try {
      const res = await api.storeEvents(storeId, { before: oldest.occurredAt, limit: 50 }, token)
      setEvents((prev) => [...prev, ...res.events])
      if (!res.nextBefore) setExhausted(true)
    } catch (e: any) {
      setLoadErr(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const grouped = groupBySessions ? groupBySession(visible) : null

  return (
    <Section title="Event Stream" subtitle={`Showing ${visible.length} of ${events.length}${exhausted ? '' : '+'}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        {ALL_CATEGORIES.map((c) => {
          const on = !excludedCats.has(c)
          return (
            <button
              key={c}
              onClick={() => toggleCat(c)}
              style={{
                fontFamily: T.sans,
                fontSize: S.label,
                padding: '3px 9px',
                borderRadius: 999,
                border: `1px solid ${on ? T.accent : T.borderSubtle}`,
                background: on ? T.accentGlow : 'transparent',
                color: on ? CATEGORY_TONE[c] : T.textDim,
                cursor: 'pointer',
              }}
              title={`${CATEGORY_LABEL[c]} events`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          )
        })}
        <label style={{ marginLeft: 'auto', fontFamily: T.sans, fontSize: S.label, color: T.textMuted, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={groupBySessions} onChange={(e) => setGroupBySessions(e.target.checked)} />
          group by playback session
        </label>
      </div>
      {visible.length === 0 ? (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>No events</div>
      ) : grouped ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {grouped.map((row) => row.kind === 'session'
            ? <SessionRow key={row.id} group={row} />
            : <EventRow key={row.event.id} event={row.event} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visible.map((e) => <EventRow key={e.id} event={e} />)}
        </div>
      )}
      {loadErr && <div style={{ marginTop: 10, fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{loadErr}</div>}
      {!exhausted && events.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <Button variant="ghost" onClick={loadOlder} busy={loadingMore}>
            {loadingMore ? 'loading…' : 'Load older'}
          </Button>
        </div>
      )}
    </Section>
  )
}

function SessionRow({ group }: { group: SessionGroup }) {
  const [open, setOpen] = useState(false)
  const start = new Date(group.startedAt)
  const end = new Date(group.endedAt)
  const startLabel = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const endLabel = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const durMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
  const dateLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <div style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '70px 110px 1fr auto',
          gap: 12,
          padding: '6px 8px',
          background: 'transparent',
          border: 'none',
          fontFamily: T.sans,
          fontSize: S.small,
          color: T.text,
          textAlign: 'left',
          cursor: 'pointer',
          alignItems: 'center',
        }}
      >
        <span style={{ color: T.textDim }}>{dateLabel}</span>
        <span style={{ color: T.textDim }}>{startLabel}–{endLabel}</span>
        <span>
          <span style={{ color: T.text }}>Session</span>
          <span style={{ color: T.textMuted }}> · {durMin}m</span>
          <span style={{ color: T.textMuted }}> · {group.songCount} song{group.songCount === 1 ? '' : 's'}</span>
          {group.problemCount > 0 && (
            <span style={{ color: T.danger }}> · {group.problemCount} problem{group.problemCount === 1 ? '' : 's'}</span>
          )}
        </span>
        <span style={{ color: T.textDim, fontSize: S.label }}>{open ? '▾' : '▸'} {group.events.length}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 16, borderLeft: `2px solid ${T.borderSubtle}`, marginLeft: 8 }}>
          {group.events.map((e) => <EventRow key={e.id} event={e} compact />)}
        </div>
      )}
    </div>
  )
}

function EventRow({ event, compact = false }: { event: PlaybackEventRow; compact?: boolean }) {
  const d = new Date(event.occurredAt)
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const color = eventColor(event.eventType)
  const detail = eventDetail(event)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: compact ? '110px 160px 1fr' : '70px 80px 160px 1fr',
      gap: 12,
      padding: compact ? '3px 8px' : '5px 8px',
      fontFamily: T.sans,
      fontSize: S.small,
      alignItems: 'center',
      borderBottom: compact ? 'none' : `1px solid ${T.borderSubtle}`,
    }}>
      {!compact && <span style={{ color: T.textDim }}>{date}</span>}
      {compact ? (
        <span style={{ color: T.textDim }}>{time}</span>
      ) : (
        <span style={{ color: T.textDim }}>{time}</span>
      )}
      <span style={{ color }}>{prettyEventType(event.eventType)}</span>
      <span style={{
        color: T.textMuted,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{detail}</span>
    </div>
  )
}

function prettyEventType(type: string): string {
  // Humanize machine event names.
  switch (type) {
    case 'operator_login': return 'Sign In'
    case 'operator_logout': return 'Sign Out'
    case 'operator_pause': return 'Operator Pause'
    case 'operator_resume': return 'Operator Resume'
    case 'song_start': return 'Song Start'
    case 'song_complete': return 'Song Complete'
    case 'song_skip': return 'Song Skip'
    case 'song_report': return 'Song Report'
    case 'song_love': return 'Song Loved'
    case 'song_load_failed': return 'Load Failed'
    case 'outcome_selection': return 'Outcome Selection'
    case 'outcome_selection_cleared': return 'Outcome Cleared'
    case 'playback_starved': return 'Playback Starved'
    case 'playback_stalled': return 'Playback Stalled'
    case 'playback_resumed_after_stall': return 'Resumed After Stall'
    case 'interruption_suspected': return 'Interruption Suspected'
    case 'wake_lock_acquired': return 'Wake Lock On'
    case 'wake_lock_released': return 'Wake Lock Off'
    case 'wake_lock_failed': return 'Wake Lock Failed'
    case 'visibility_hidden': return 'Tab Hidden'
    case 'visibility_visible': return 'Tab Visible'
    case 'mediasession_action': return 'Lockscreen Action'
    case 'pwa_standalone_launch': return 'PWA Launch'
    case 'audio_cache_hit': return 'Cache Hit'
    case 'audio_cache_miss': return 'Cache Miss'
    case 'push_subscribed': return 'Push Subscribed'
    case 'push_unsubscribed': return 'Push Unsubscribed'
    case 'ad_play': return 'Ad Play'
    case 'room_loudness_sample': return 'Loudness Sample'
    case 'heartbeat': return 'Heartbeat'
    default:
      return type
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
  }
}

function eventColor(type: string): string {
  const cat = categoryOf(type)
  if (cat === 'health') return T.danger
  if (cat === 'operator') return T.warn
  if (type === 'song_love') return T.success
  if (type === 'song_complete') return T.success
  if (cat === 'system' || cat === 'lifecycle' || cat === 'cache') return T.textMuted
  return T.text
}

function eventDetail(e: PlaybackEventRow): string {
  const parts: string[] = []
  if (e.eventType === 'room_loudness_sample' && e.extra) {
    const x = e.extra as { dbfs_a?: number; weighted?: string }
    if (typeof x.dbfs_a === 'number') {
      parts.push(`${x.dbfs_a.toFixed(1)} dBFS${x.weighted ? ` (${x.weighted}-weighted)` : ''}`)
    }
    return parts.join(' · ')
  }
  if (e.eventType === 'song_load_failed' && e.extra) {
    const x = e.extra as { reason?: string; media_error_code?: number | null }
    if (x.reason) parts.push(x.reason)
    if (x.media_error_code != null) parts.push(`code ${x.media_error_code}`)
  }
  if (e.eventType === 'heartbeat' && e.extra) {
    const x = e.extra as { is_playing?: boolean; queue_depth?: number }
    if (typeof x.queue_depth === 'number') parts.push(`queue ${x.queue_depth}`)
    if (x.is_playing === false) parts.push('idle')
  }
  if (e.eventType === 'song_complete') {
    if (e.completionReason) parts.push(e.completionReason)
    if (typeof e.playDurationMs === 'number') parts.push(`${Math.round(e.playDurationMs / 1000)}s`)
  }
  const label = e.outcomeDisplayTitle ?? e.outcomeTitle
  if (label) parts.push(label)
  if (e.reportReason) parts.push(`reason: ${e.reportReason}`)
  if (e.operatorEmail) parts.push(e.operatorEmail)
  if (e.songTitle) parts.push(e.songTitle)
  else if (e.songId && e.eventType !== 'song_load_failed') parts.push(`song ${e.songId.slice(0, 8)}`)
  return parts.join(' · ')
}
