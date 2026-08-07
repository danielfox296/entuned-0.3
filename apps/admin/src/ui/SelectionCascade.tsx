import { useCallback, useEffect, useState } from 'react'
import { api, getToken } from '../api.js'
import type { ClientListRow, StoreSummary, IcpSummary } from '../api.js'
import { HeaderSelect } from './HeaderSelect.js'

// The Client → Location → ICP selector shared by the Clients and Workflows
// shells. Both used to own a private copy of this cascade; they now share one
// so the two stay in step and there is a single place that knows how an ICP
// becomes reachable.
//
// The location step is OPTIONAL. Dash used to source its ICP list from
// `GET /admin/stores/:id`, whose query is `storeLinks: { some: { storeId } }`.
// An ICP with no StoreICP link was therefore unreachable — which is every
// Station ICP until a Store actually picks that station (Card 23). Picking
// "— all locations —" widens the ICP list to every ICP on the client, which is
// how an operator reaches a station's pool to give it reference tracks, hooks
// and songs. Picking a location narrows it back to that location's ICPs, which
// is the behaviour every existing paid-client flow depends on.

/** Sentinel for the "no location filter" option. Distinct from '' (= nothing
 *  picked / show the placeholder), which is what a null clientId renders. */
const ALL_LOCATIONS = '__all__'

export interface SelectionCascade {
  clients: ClientListRow[] | null
  stores: StoreSummary[] | null
  /** Stores belonging to the selected client. Empty when no client is picked. */
  clientStores: StoreSummary[]
  /** ICPs on the selected client, narrowed to the selected location if there is one. */
  icps: IcpSummary[]
  clientId: string | null
  storeId: string | null
  icpId: string | null
  setClientId: (id: string | null) => void
  setStoreId: (id: string | null) => void
  setIcpId: (id: string | null) => void
  selectedClient: ClientListRow | null
  selectedIcp: IcpSummary | null
  /** Refetch the client list — call after creating/renaming/deleting a client. */
  reloadClients: () => void
  /** Refetch the store list — call after creating/renaming/deleting a location. */
  reloadStores: () => void
  /** Refetch the ICP list for the current scope. Await it before selecting a
   *  just-created ICP, or the reconcile below will snap the selection back to
   *  the first row of the stale list. */
  reloadIcps: () => Promise<void>
  error: string | null
}

export function useSelectionCascade(
  selection: {
    clientId: string | null
    setClientId: (id: string | null) => void
    storeId: string | null
    setStoreId: (id: string | null) => void
    icpId: string | null
    setIcpId: (id: string | null) => void
  },
): SelectionCascade {
  const { clientId, setClientId, storeId, setStoreId, icpId, setIcpId } = selection
  const [clients, setClients] = useState<ClientListRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [icps, setIcps] = useState<IcpSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reloadClients = useCallback(() => {
    const token = getToken(); if (!token) return
    api.clients(token).then(setClients).catch((e) => setError(e.message))
  }, [])

  const reloadStores = useCallback(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setError(e.message))
  }, [])

  // Two modes, one request either way:
  //   a location is picked → that location's ICPs, whoever owns them. Every
  //     free location's pools belong to the Free Tier client, so filtering by
  //     the location's own client would drop them.
  //   "all locations"      → the client's own ICPs, which is where the Station
  //     pools live and how they become reachable at all.
  const reloadIcps = useCallback(async () => {
    const token = getToken(); if (!token) return
    if (!clientId) { setIcps([]); return }
    try { setIcps(await api.icps(token, storeId ? { storeId } : { clientId })) }
    catch (e: any) { setError(e.message) }
  }, [clientId, storeId])

  useEffect(() => { reloadClients(); reloadStores() }, [reloadClients, reloadStores])
  useEffect(() => { setIcps(null); void reloadIcps() }, [reloadIcps])

  // Reconcile the location when the client changes. Snapping to the client's
  // first location (rather than to "all") preserves the behaviour every
  // existing flow was built on — reaching a station ICP is an explicit widening.
  useEffect(() => {
    if (!clientId || !stores) return
    const match = stores.filter((s) => s.clientId === clientId)
    if (match.length === 0) { if (storeId) setStoreId(null); return }
    if (storeId && !match.some((s) => s.id === storeId)) setStoreId(match[0]!.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, stores])

  const clientStores = stores && clientId ? stores.filter((s) => s.clientId === clientId) : []

  // Reconcile the ICP against whatever the current client/location admits.
  // Waits for the list to actually load — clearing on `null` would wipe a
  // persisted selection on every mount.
  useEffect(() => {
    if (icps === null) return
    if (icpId && icps.some((i) => i.id === icpId)) return
    setIcpId(icps[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icps, icpId])

  return {
    clients, stores, clientStores, icps: icps ?? [],
    clientId, storeId, icpId,
    setClientId, setStoreId, setIcpId,
    selectedClient: clients?.find((c) => c.id === clientId) ?? null,
    selectedIcp: icps?.find((i) => i.id === icpId) ?? null,
    reloadClients, reloadStores, reloadIcps,
    error,
  }
}

/** The three header dropdowns. Rendered inline with the panel title by both
 *  the Clients and Workflows shells. */
export function CascadeSelectors({ cascade, clientLabel }: {
  cascade: SelectionCascade
  /** Optional richer client labels (the Clients shell appends owner email). */
  clientLabel?: (c: ClientListRow) => string
}) {
  const { clients, clientStores, icps, clientId, storeId, icpId, setClientId, setStoreId, setIcpId } = cascade

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <HeaderSelect
        label="client"
        value={clientId ?? ''}
        onChange={(v) => setClientId(v || null)}
        placeholder={clients ? '— pick a client —' : 'loading…'}
        options={(clients ?? []).map((c) => ({
          value: c.id,
          label: clientLabel ? clientLabel(c) : c.companyName,
        }))}
      />
      <HeaderSelect
        label="location"
        value={clientId ? (storeId ?? ALL_LOCATIONS) : ''}
        onChange={(v) => setStoreId(v === ALL_LOCATIONS || v === '' ? null : v)}
        placeholder="— pick a client first —"
        options={clientId
          ? [{ value: ALL_LOCATIONS, label: '— all locations —' }, ...clientStores.map((s) => ({ value: s.id, label: s.name }))]
          : []}
        disabled={!clientId}
      />
      <HeaderSelect
        label="icp"
        value={icpId ?? ''}
        onChange={(v) => setIcpId(v || null)}
        placeholder={!clientId
          ? '— pick a client first —'
          : (icps.length === 0 ? (storeId ? 'no ICPs at this location' : 'no ICPs') : '— pick an ICP —')}
        options={icps.map((i) => ({
          value: i.id,
          // Station ICPs read as an ICP name alone; the tag says why this one
          // has no location and what it feeds.
          label: i.station ? `${i.name} · station` : i.name,
        }))}
        disabled={!clientId || icps.length === 0}
      />
    </div>
  )
}
