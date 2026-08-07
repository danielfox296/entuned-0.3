import { ListChecks } from 'lucide-react'
import { T } from '@entuned/tokens'
import {
  S, useClientSelection, useStoreSelection, useIcpSelection,
  useSelectionCascade, CascadeSelectors,
} from '../../ui/index.js'
import { useNavSub } from '../../nav.js'
import { HookRefresh } from './HookRefresh.js'
import { ReferenceTrackRefresh } from './ReferenceTrackRefresh.js'
import { PreLaunchChecklist } from './PreLaunchChecklist.js'
import { SongSeedQueue } from '../seeding/SongSeedQueue.js'

/** What the workflow tabs get from the header selectors.
 *
 *  `storeId` is nullable on purpose: the Launch Checklist is a property of a
 *  location, but Reference Tracks / Hook Writing / Pipeline are properties of
 *  an ICP and every endpoint they call is keyed by icpId alone. Requiring a
 *  location there made Station ICPs — which have no location — unworkable. */
export type WorkflowContext = {
  storeId: string | null
  icpId: string | null
  clientId: string | null
  clientName: string | null
  /** True when the selected ICP is a Station's pool. */
  isStationIcp: boolean
}

const TABS = [
  { key: 'Launch Checklist', label: 'Launch Checklist' },
  { key: 'Reference Tracks', label: 'Reference Tracks' },
  { key: 'Hook Writing', label: 'Hook Writing' },
  { key: 'Pipeline', label: 'Pipeline' },
] as const

type TabKey = typeof TABS[number]['key']

export function WorkflowRouter() {
  const [clientId, setClientId] = useClientSelection()
  const [storeId, setStoreId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()
  const cascade = useSelectionCascade({
    clientId, setClientId, storeId, setStoreId, icpId, setIcpId,
  })
  const [active, setActive] = useNavSub<TabKey>('Launch Checklist')

  const ctx: WorkflowContext = {
    storeId,
    icpId,
    clientId,
    clientName: cascade.selectedClient?.companyName ?? null,
    isStationIcp: !!cascade.selectedIcp?.station,
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
        <CascadeSelectors cascade={cascade} />
      </div>

      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: S.xl }}>
      {cascade.error && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{cascade.error}</div>}

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
      {active === 'Reference Tracks' && <ReferenceTrackRefresh ctx={ctx} />}
      {active === 'Hook Writing' && <HookRefresh ctx={ctx} />}
      {active === 'Pipeline' && <SongSeedQueue ctx={ctx} />}
      </div>
    </div>
  )
}
