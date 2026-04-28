import { useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, StoreDetail } from '../../api.js'
import { T } from '../../tokens.js'
import {
  StorePicker, S, useStoreSelection, useIcpSelection,
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
  { key: 'Launch Checklist', label: 'Launch Checklist' },
  { key: 'Hook Writing', label: 'Hook Writing' },
  { key: 'Reference Tracks', label: 'Reference Tracks' },
  { key: 'Hook → Prompt', label: 'Hook → Prompt' },
] as const

type TabKey = typeof TABS[number]['key']

export function WorkflowRouter() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [active, setActive] = useNavSub<TabKey>('Launch Checklist')
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
          <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />
          {detail && detail.icps.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: S.label, color: T.textDim, fontFamily: T.sans,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>icp</span>
              <select
                value={icpId ?? ''}
                onChange={(e) => setIcpId(e.target.value || null)}
                style={{
                  minWidth: 200, background: T.bg, color: T.text,
                  border: `1px solid ${T.border}`, padding: '6px 10px',
                  fontFamily: T.sans, fontSize: 14,
                }}
              >
                {detail.icps.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: S.xl }}>
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

      {active === 'Launch Checklist' && <PreLaunchChecklist ctx={ctx} />}
      {active === 'Hook Writing' && <HookRefresh ctx={ctx} />}
      {active === 'Reference Tracks' && <ReferenceTrackRefresh ctx={ctx} />}
      {active === 'Hook → Prompt' && <SongSeedBurst ctx={ctx} />}
      </div>
    </div>
  )
}
