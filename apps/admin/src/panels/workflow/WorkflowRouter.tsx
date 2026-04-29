import { useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, StoreSummary, StoreDetail } from '../../api.js'
import { T } from '../../tokens.js'
import {
  S, HeaderSelect, useClientSelection, useStoreSelection, useIcpSelection,
} from '../../ui/index.js'
import { useNavSub } from '../../nav.js'
import { HookRefresh } from './HookRefresh.js'
import { ReferenceTrackRefresh } from './ReferenceTrackRefresh.js'
import { PreLaunchChecklist } from './PreLaunchChecklist.js'
import { SongSeedBurst } from './SongSeedBurst.js'
import { SongSeedQueue } from '../seeding/SongSeedQueue.js'

export type WorkflowContext = {
  storeId: string | null
  store: StoreDetail | null
  icpId: string | null
  clientId: string | null
  clientName: string | null
}

const TABS = [
  { key: 'Launch Checklist', label: 'Launch Checklist' },
  { key: 'Hook Writing', label: 'Hook Writing' },
  { key: 'Reference Tracks', label: 'Reference Tracks' },
  { key: 'Hook → Prompt', label: 'Hook → Prompt' },
  { key: 'Song Creation Queue', label: 'Song Creation Queue' },
] as const

type TabKey = typeof TABS[number]['key']

export function WorkflowRouter() {
  const [clients, setClients] = useState<ClientListRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [clientId, setClientId] = useClientSelection()
  const [storeId, setStoreId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [active, setActive] = useNavSub<TabKey>('Launch Checklist')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
    api.clients(token).then(setClients).catch((e) => setErr(e.message))
  }, [])

  // Reconcile store when client changes.
  useEffect(() => {
    if (!clientId || !stores) return
    const match = stores.filter((s) => s.clientId === clientId)
    if (match.length === 0) { if (storeId) setStoreId(null); return }
    if (!storeId || !match.some((s) => s.id === storeId)) {
      setStoreId(match[0]!.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, stores])

  useEffect(() => {
    if (!storeId) { setDetail(null); return }
    const token = getToken(); if (!token) return
    setDetail(null)
    api.storeDetail(storeId, token).then((d) => {
      setDetail(d)
      // Reconcile persisted ICP against new store's ICPs.
      const valid = d.icps.find((i) => i.id === icpId)
      if (!valid) setIcpId(d.icps[0]?.id ?? null)
    }).catch((e) => setErr(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  const clientStores = stores && clientId
    ? stores.filter((s) => s.clientId === clientId)
    : []

  const ctx: WorkflowContext = {
    storeId,
    store: detail,
    icpId,
    clientId: detail?.store.clientId ?? null,
    clientName: detail?.store.clientName ?? null,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Custom panel header: title on the left, persistent selectors on the right. */}
      <div style={{
        padding: '14px 28px', borderBottom: `1px solid ${T.borderSubtle}`,
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <span style={{ display: 'inline-flex', color: T.accent }}>
          <ListChecks size={18} strokeWidth={1.75} />
        </span>
        <h1 style={{
          fontSize: 21, fontFamily: T.heading, fontWeight: 700,
          color: T.text, margin: 0, letterSpacing: '-0.02em',
        }}>Workflows</h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <HeaderSelect
            label="client"
            value={clientId ?? ''}
            onChange={(v) => setClientId(v || null)}
            placeholder={clients ? '— pick a client —' : 'loading…'}
            options={(clients ?? []).map((c) => ({ value: c.id, label: c.companyName }))}
          />
          <HeaderSelect
            label="location"
            value={storeId ?? ''}
            onChange={(v) => setStoreId(v || null)}
            placeholder={!clientId ? '— pick a client first —' : (clientStores.length === 0 ? 'no locations' : '— pick a location —')}
            options={clientStores.map((s) => ({ value: s.id, label: s.name }))}
            disabled={!clientId || clientStores.length === 0}
          />
          <HeaderSelect
            label="icp"
            value={icpId ?? ''}
            onChange={(v) => setIcpId(v || null)}
            placeholder={!detail ? '— pick a location —' : (detail.icps.length === 0 ? 'no ICPs' : '— pick an ICP —')}
            options={(detail?.icps ?? []).map((i) => ({ value: i.id, label: i.name }))}
            disabled={!detail || detail.icps.length === 0}
          />
        </div>
      </div>

      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: S.xl }}>
      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {/* Workflow tabs */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-start',
        borderBottom: `1px solid ${T.borderSubtle}`,
      }}>
        {TABS.map((t) => {
          const on = active === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : T.textMuted,
                padding: '8px 14px', cursor: 'pointer',
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{t.label}</button>
          )
        })}
      </div>

      {active === 'Launch Checklist' && <PreLaunchChecklist ctx={ctx} />}
      {active === 'Hook Writing' && <HookRefresh ctx={ctx} />}
      {active === 'Reference Tracks' && <ReferenceTrackRefresh ctx={ctx} />}
      {active === 'Hook → Prompt' && <SongSeedBurst ctx={ctx} />}
      {active === 'Song Creation Queue' && <SongSeedQueue ctx={ctx} />}
      </div>
    </div>
  )
}
