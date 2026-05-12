import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { RetentionResponse, StoreRetentionRow, CohortRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button } from '../../ui/index.js'
import { useNavSub } from '../../nav.js'

type Tab = 'Overview' | 'Stores' | 'Gone Dark'
const TABS: Tab[] = ['Overview', 'Stores', 'Gone Dark']
type WindowDays = 7 | 14 | 28 | 90

const STATUS_SORT: Record<StoreRetentionRow['status'], number> = {
  gone_dark: 0, quiet: 1, active: 2, never_played: 3,
}

export function RetentionDashboard() {
  const [tab, setTab] = useNavSub<Tab>('Overview')
  const [windowDays, setWindowDays] = useState<WindowDays>(28)
  const [data, setData] = useState<RetentionResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (w: WindowDays) => {
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null)
    try { setData(await api.retention(w, token)) }
    catch (e: any) { setErr(e.message ?? 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(windowDays) }, [])

  const handleWindow = (w: WindowDays) => { setWindowDays(w); load(w) }

  const goneDarkCount = data?.stores.filter(
    (s) => s.status === 'gone_dark' || s.status === 'quiet',
  ).length ?? 0

  const sortedStores = useMemo(() => {
    if (!data) return []
    return [...data.stores].sort((a, b) => {
      const sd = STATUS_SORT[a.status] - STATUS_SORT[b.status]
      if (sd !== 0) return sd
      if (a.lastPlayAt && b.lastPlayAt) return a.lastPlayAt.localeCompare(b.lastPlayAt)
      if (!a.lastPlayAt) return 1
      if (!b.lastPlayAt) return -1
      return 0
    })
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tab row + window selector */}
      <div style={{
        display: 'flex', alignItems: 'center', borderBottom: `1px solid ${T.borderSubtle}`,
      }}>
        <div style={{ display: 'flex', flex: 1 }}>
          {TABS.map((t) => {
            const on = tab === t
            const label = t === 'Gone Dark' ? `Gone Dark (${goneDarkCount})` : t
            return (
              <button key={t} onClick={() => setTab(t)} style={tabBtnStyle(on)}>
                {label}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4 }}>
          {([7, 14, 28, 90] as WindowDays[]).map((w) => (
            <button key={w} onClick={() => handleWindow(w)} style={{
              background: windowDays === w ? T.surfaceRaised : 'transparent',
              border: `1px solid ${windowDays === w ? T.accent : T.border}`,
              color: windowDays === w ? T.accent : T.textMuted,
              padding: '4px 10px', borderRadius: 4,
              fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
            }}>{w}d</button>
          ))}
          <Button variant="ghost" onClick={() => load(windowDays)}>refresh</Button>
        </div>
      </div>

      {loading && (
        <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: 14 }}>Loading…</div>
      )}
      {err && (
        <div style={{ color: T.danger, fontFamily: T.sans, fontSize: 14 }}>{err}</div>
      )}

      {data && !loading && (
        <>
          {tab === 'Overview' && <OverviewTab data={data} />}
          {tab === 'Stores' && <StoresTab stores={sortedStores} />}
          {tab === 'Gone Dark' && (
            <StoresTab stores={sortedStores.filter(
              (s) => s.status === 'gone_dark' || s.status === 'quiet',
            )} />
          )}
        </>
      )}
    </div>
  )
}

// ── Overview tab ───────────────────────────────────────────────

function OverviewTab({ data }: { data: RetentionResponse }) {
  const { overview, cohorts } = data
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total Stores" value={overview.totalStores} color={T.textMuted} />
        <StatCard label="Active (7d)" value={overview.activeStores} color={T.success} />
        <StatCard label="Activated" value={overview.activatedStores} color={T.accent} />
        <StatCard label="Gone Dark" value={overview.goneDarkStores} color={T.danger} />
        <StatCard label="Free" value={overview.freeStores} color={T.textMuted} />
        <StatCard label="Paid" value={overview.paidStores} color={T.gold} />
      </div>

      {/* Cohort table */}
      <div>
        <div style={{
          fontSize: 13, fontFamily: T.sans, color: T.textDim,
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
        }}>Cohort conversion</div>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <CohortHeader />
          {cohorts.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: 14 }}>
              No cohort data yet
            </div>
          )}
          {cohorts.map((row) => <CohortDataRow key={row.cohortWeek} row={row} />)}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '12px 18px', borderRadius: 4,
      border: `1px solid ${T.border}`, background: T.surface, minWidth: 120,
    }}>
      <div style={{ fontFamily: T.sans, fontSize: 28, fontWeight: 600, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: T.sans, fontSize: 12, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  )
}

const COHORT_COLS = '120px 80px 80px 120px 90px'

function CohortHeader() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COHORT_COLS, gap: 8,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.sans, fontSize: 12, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.4,
    }}>
      <span>Cohort Week</span>
      <span style={{ textAlign: 'right' }}>Signups</span>
      <span style={{ textAlign: 'right' }}>Activated</span>
      <span style={{ textAlign: 'right' }}>→ Paid</span>
      <span style={{ textAlign: 'right' }}>Still Active</span>
    </div>
  )
}

function CohortDataRow({ row }: { row: CohortRow }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COHORT_COLS, gap: 8,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.sans, fontSize: 14, alignItems: 'center',
    }}>
      <span style={{ color: T.text, fontWeight: 500 }}>{row.cohortWeek}</span>
      <span style={{ textAlign: 'right', color: T.textMuted }}>{row.signups}</span>
      <span style={{ textAlign: 'right', color: row.activated > 0 ? T.accent : T.textDim }}>
        {row.activated}
      </span>
      <span style={{ textAlign: 'right', color: row.convertedToPaid > 0 ? T.gold : T.textDim }}>
        {row.convertedToPaid}
      </span>
      <span style={{ textAlign: 'right', color: row.stillActive > 0 ? T.success : T.textDim }}>
        {row.stillActive}
      </span>
    </div>
  )
}

// ── Stores tab ─────────────────────────────────────────────────

const STORE_COLS = '1.8fr 1.4fr 80px 110px 120px 80px 70px 70px 80px 80px'

function StoresTab({ stores }: { stores: StoreRetentionRow[] }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <StoreHeader />
      {stores.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: 14 }}>
          No stores to show
        </div>
      )}
      {stores.map((s) => <StoreDataRow key={s.storeId} row={s} />)}
    </div>
  )
}

function StoreHeader() {
  const cell: CSSProperties = {
    fontFamily: T.sans, fontSize: 11, color: T.textDim,
    textTransform: 'uppercase', letterSpacing: 0.4,
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: STORE_COLS, gap: 8,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
    }}>
      <span style={cell}>Store</span>
      <span style={cell}>Client</span>
      <span style={{ ...cell, textAlign: 'right' }}>Tier</span>
      <span style={cell}>Status</span>
      <span style={{ ...cell, textAlign: 'right' }}>Last Play</span>
      <span style={{ ...cell, textAlign: 'right' }}>Hours</span>
      <span style={{ ...cell, textAlign: 'right' }}>Sessions</span>
      <span style={{ ...cell, textAlign: 'right' }}>Songs</span>
      <span style={{ ...cell, textAlign: 'right' }}>Skip %</span>
      <span style={{ ...cell, textAlign: 'right' }}>Activated</span>
    </div>
  )
}

const STATUS_COLOR: Record<StoreRetentionRow['status'], string> = {
  active: T.success,
  quiet: T.warn,
  gone_dark: T.danger,
  never_played: T.textDim,
}
const STATUS_LABEL: Record<StoreRetentionRow['status'], string> = {
  active: 'active',
  quiet: 'quiet',
  gone_dark: 'gone dark',
  never_played: 'never played',
}

function StoreDataRow({ row }: { row: StoreRetentionRow }) {
  const statusColor = STATUS_COLOR[row.status]
  const skipPct = (row.skipRate * 100).toFixed(0) + '%'
  const skipColor = row.skipRate > 0.4 ? T.danger : T.textMuted

  const lastPlayLabel = row.lastPlayAt
    ? new Date(row.lastPlayAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: STORE_COLS, gap: 8,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.sans, fontSize: 13, alignItems: 'center',
    }}>
      <span style={{ color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.storeName}
      </span>
      <span style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.clientName}
      </span>
      <span style={{ color: T.textDim, textAlign: 'right', fontSize: 12 }}>{row.tier}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: statusColor, flexShrink: 0,
          display: 'inline-block',
        }} />
        <span style={{ color: statusColor, fontSize: 12 }}>{STATUS_LABEL[row.status]}</span>
      </span>
      <span style={{ color: T.textMuted, textAlign: 'right' }}>{lastPlayLabel}</span>
      <span style={{ color: T.textMuted, textAlign: 'right' }}>{row.totalHoursPlayed}h</span>
      <span style={{ color: T.textMuted, textAlign: 'right' }}>{row.sessionsInWindow}</span>
      <span style={{ color: T.textMuted, textAlign: 'right' }}>{row.songsPlayed}</span>
      <span style={{ color: skipColor, textAlign: 'right' }}>{row.songsPlayed > 0 ? skipPct : '—'}</span>
      <span style={{ textAlign: 'right', color: row.activated ? T.success : T.textDim }}>
        {row.activated ? '✓' : '—'}
      </span>
    </div>
  )
}

// ── Shared tab button style ────────────────────────────────────

function tabBtnStyle(on: boolean): CSSProperties {
  return {
    background: 'transparent', border: 'none',
    borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
    color: on ? T.text : T.textMuted,
    padding: '8px 14px', cursor: 'pointer',
    fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
    marginBottom: -1,
  }
}
