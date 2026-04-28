import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, StoreDetail } from '../../api.js'
import { T } from '../../tokens.js'
import {
  PanelHeader, StorePicker, S, useStoreSelection, useIcpSelection,
} from '../../ui/index.js'
import { useNavSub } from '../../nav.js'
import { HookRefresh } from './HookRefresh.js'
import { ReferenceTrackRefresh } from './ReferenceTrackRefresh.js'
import { PreLaunchChecklist } from './PreLaunchChecklist.js'
import { SongSeedBurst } from './SongSeedBurst.js'

export type WorkflowContext = {
  storeId: string | null
  store: StoreDetail | null
  icpId: string | null
  clientId: string | null
  clientName: string | null
}

const TABS = [
  { key: 'launch', label: 'Pre-Launch Checklist' },
  { key: 'hooks', label: 'Hook Refresh' },
  { key: 'tracks', label: 'Reference Track Refresh' },
  { key: 'burst', label: 'Song Seed Burst' },
] as const

type TabKey = typeof TABS[number]['key']

export function WorkflowRouter() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [active, setActive] = useNavSub<TabKey>('launch')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

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

  const ctx: WorkflowContext = {
    storeId,
    store: detail,
    icpId,
    clientId: detail?.store.clientId ?? null,
    clientName: detail?.store.clientName ?? null,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Workflows"
        subtitle="Multi-step actions for the selected client, store, and ICP."
      />

      {/* Persistent context selector */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, background: T.surfaceRaised,
        border: `1px solid ${T.borderSubtle}`, borderRadius: 4,
      }}>
        <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

        {detail && detail.icps.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: S.label, color: T.textDim, fontFamily: T.sans,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>icp</span>
            <select
              value={icpId ?? ''}
              onChange={(e) => setIcpId(e.target.value || null)}
              style={{
                minWidth: 320, background: T.bg, color: T.text,
                border: `1px solid ${T.border}`, padding: '6px 10px',
                fontFamily: T.sans, fontSize: 14,
              }}
            >
              {detail.icps.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}

        {detail && (
          <div style={{ fontSize: S.small, color: T.textDim, fontFamily: T.mono }}>
            client: {detail.store.clientName} · store: {detail.store.name} · tz: {detail.store.timezone}
          </div>
        )}
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {/* Workflow tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
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

      {active === 'launch' && <PreLaunchChecklist ctx={ctx} />}
      {active === 'hooks' && <HookRefresh ctx={ctx} />}
      {active === 'tracks' && <ReferenceTrackRefresh ctx={ctx} />}
      {active === 'burst' && <SongSeedBurst ctx={ctx} />}
    </div>
  )
}
