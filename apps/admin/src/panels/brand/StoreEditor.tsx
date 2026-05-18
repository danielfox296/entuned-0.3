import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, OutcomeRowFull, StoreCreateBody, StoreUpdateBody } from '../../api.js'
import { T } from '@entuned/tokens'
import {
  Button, Input, Select, Section, Field, KV,
  S, useToast, useStoreSelection,
} from '../../ui/index.js'
import { TierPanel } from './TierPanel.js'

const COMMON_TZ = [
  'America/Denver', 'America/Chicago', 'America/New_York', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'America/Honolulu',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'UTC',
]

export function StoreEditor({ onStoresChanged }: { onStoresChanged?: () => void } = {}) {
  const [clients, setClients] = useState<ClientListRow[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [freeTierAllowedKeys, setFreeTierAllowedKeys] = useState<Set<string> | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [detail, setDetail] = useState<{ id: string; name: string; timezone: string; clientId: string; clientName: string; icps: { id: string; name: string }[]; goLiveDate: string | null; defaultOutcomeId: string | null; roomLoudnessSamplingEnabled: boolean; tier: 'free' | 'core' | 'pro' | 'enterprise' | 'mvp_pilot'; includeFreeTierPool: boolean } | null>(null)
  const [draft, setDraft] = useState<StoreUpdateBody | null>(null)
  const [creating, setCreating] = useState<StoreCreateBody | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const toast = useToast()

  const cancelDelete = () => { setDeleteArmed(false); setDeleteConfirmText('') }
  useEffect(() => { cancelDelete() }, [storeId])

  const reloadAll = async () => {
    const token = getToken(); if (!token) return
    try {
      const [, c, o, fto] = await Promise.all([
        api.stores(token),
        api.clients(token),
        api.outcomes(token),
        api.freeTierOutcomes(token).catch(() => null),
      ])
      setClients(c); setOutcomes(o)
      if (fto) setFreeTierAllowedKeys(new Set(fto.filter((x) => x.availableOnFree).map((x) => x.outcomeKey)))
      onStoresChanged?.()
    } catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { void reloadAll() }, [])

  useEffect(() => {
    if (!storeId) { setDetail(null); setDraft(null); return }
    const token = getToken(); if (!token) return
    setDetail(null); setDraft(null); setErr(null)
    api.storeDetail(storeId, token).then(async (d) => {
      setDetail({
        id: d.store.id, name: d.store.name, timezone: d.store.timezone,
        clientId: d.store.clientId, clientName: d.store.clientName,
        icps: d.icps.map((i) => ({ id: i.id, name: i.name })),
        goLiveDate: d.store.goLiveDate,
        defaultOutcomeId: d.store.defaultOutcomeId,
        roomLoudnessSamplingEnabled: d.store.roomLoudnessSamplingEnabled,
        tier: d.store.tier,
        includeFreeTierPool: d.store.includeFreeTierPool,
      })
      setDraft({})
    }).catch((e) => setErr(e.message))
  }, [storeId])

  const dirty = draft && detail && Object.entries(draft).some(([k, v]) => (detail as any)[k] !== v)

  const save = async () => {
    if (!detail || !draft || !dirty) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const updated = await api.updateStore(detail.id, draft, token)
      setDetail((cur) => cur ? { ...cur, ...updated, icps: (updated as any).icps ?? cur.icps } : cur)
      setDraft({})
      reloadAll()
      toast.success(`location "${detail.name}" saved`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save location') }
    finally { setBusy(false) }
  }

  const deleteStore = async () => {
    if (!detail) return
    if (deleteConfirmText.trim() !== detail.name) return
    const token = getToken(); if (!token) return
    setDeleteBusy(true); setErr(null)
    try {
      const result = await api.deleteStore(detail.id, token)
      const c = result.deleted
      const summary = [
        `${c.playbackEvents} playback event${c.playbackEvents === 1 ? '' : 's'}`,
        `${c.posEvents} POS event${c.posEvents === 1 ? '' : 's'}`,
        `${c.posPullRuns} POS run${c.posPullRuns === 1 ? '' : 's'}`,
        `${c.retailNextSnapshots} RetailNext snapshot${c.retailNextSnapshots === 1 ? '' : 's'}`,
      ].join(', ')
      toast.success(`deleted "${c.store}" — ${summary}`)
      setStoreId(null)
      reloadAll()
    } catch (e: any) {
      setErr(e.message); toast.error(e.message ?? 'failed to delete location')
    } finally {
      setDeleteBusy(false); setDeleteArmed(false); setDeleteConfirmText('')
    }
  }

  const submitCreate = async () => {
    if (!creating) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const created = await api.createStore(creating, token)
      setCreating(null); setStoreId(created.id); reloadAll()
      toast.success(`location "${created.name}" created`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to create location') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          onClick={() => {
            setStoreId(null)
            setCreating({ clientId: detail?.clientId ?? clients?.[0]?.id ?? '', name: '', timezone: 'America/Denver' })
          }}
        >+ new location</Button>
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {creating && (
        <CreateForm
          draft={creating}
          clients={clients ?? []}
          outcomes={outcomes ?? []}
          onChange={setCreating}
          onSubmit={submitCreate}
          onCancel={() => setCreating(null)}
          busy={busy}
        />
      )}

      {storeId && !detail && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {detail && draft && (
        <>
          <Section title="Location" columns={2}>
            <Field label="name">
              <Input
                value={draft.name ?? detail.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>

            <Field label="timezone">
              <Input
                list="tz-list"
                value={draft.timezone ?? detail.timezone}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              />
              <datalist id="tz-list">{COMMON_TZ.map((tz) => <option key={tz} value={tz} />)}</datalist>
            </Field>

            <Field label="default outcome">
              <Select
                value={draft.defaultOutcomeId ?? detail.defaultOutcomeId ?? ''}
                onChange={(e) => setDraft({ ...draft, defaultOutcomeId: e.target.value || null })}
              >
                <option value="">— none —</option>
                {(outcomes ?? [])
                  .filter((o) => {
                    // Free-tier stores can only pick from the FreeTierOutcome allowlist.
                    // Other tiers see every active outcome.
                    if (detail.tier !== 'free') return true
                    if (!freeTierAllowedKeys) return true
                    return freeTierAllowedKeys.has(o.outcomeKey)
                  })
                  .map((o) => <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>)}
              </Select>
              {detail.tier === 'free' && (
                <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, marginTop: 4 }}>
                  Free-tier locations can only use outcomes from the free-tier allowlist.
                </div>
              )}
            </Field>

            <Field label="go-live date">
              <Input
                type="date"
                value={draft.goLiveDate ?? detail.goLiveDate ?? ''}
                onChange={(e) => setDraft({ ...draft, goLiveDate: e.target.value || null })}
              />
            </Field>

            <Field label="room loudness sampling">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.sans, fontSize: S.small, color: T.textMuted }}>
                <input
                  type="checkbox"
                  checked={draft.roomLoudnessSamplingEnabled ?? detail.roomLoudnessSamplingEnabled}
                  onChange={(e) => setDraft({ ...draft, roomLoudnessSamplingEnabled: e.target.checked })}
                />
                player requests mic, emits ~1/min A-weighted dBFS
              </label>
            </Field>

            {detail.tier !== 'free' && (
              <Field label="include Entuned free pool">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.sans, fontSize: S.small, color: T.textMuted }}>
                  <input
                    type="checkbox"
                    checked={draft.includeFreeTierPool ?? detail.includeFreeTierPool}
                    onChange={(e) => setDraft({ ...draft, includeFreeTierPool: e.target.checked })}
                  />
                  draw from the Entuned-curated free pool in addition to this location&rsquo;s own ICP
                </label>
                <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, marginTop: 4 }}>
                  default OFF for paid locations. Turn on if the client explicitly wants extra music breadth from the curated free pool.
                </div>
              </Field>
            )}
          </Section>

          <Section title="Read-only">
            <KV k="Client" v={detail.clientName} />
            <KV
              k={`ICPs (${detail.icps.length})`}
              v={detail.icps.length === 0
                ? '(none yet — add in ICP Editor)'
                : detail.icps.map((i) => i.name).join(', ')}
            />
          </Section>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button onClick={save} disabled={!dirty} busy={busy}>
              {busy ? 'saving…' : (dirty ? 'save changes' : 'no changes')}
            </Button>
            {dirty && <Button variant="tiny" onClick={() => setDraft({})}>discard</Button>}
          </div>

          <TierPanel storeId={detail.id} storeName={detail.name} />

          <div style={{
            marginTop: S.xl, padding: S.lg,
            border: `1px solid ${T.danger}`, borderRadius: S.r4,
            display: 'flex', flexDirection: 'column', gap: S.sm,
          }}>
            <div style={{ fontSize: S.small, fontFamily: T.sans, color: T.danger, fontWeight: 600 }}>
              Danger zone
            </div>
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted, lineHeight: 1.5 }}>
              Hard-deletes this location and every record that hangs off it: playback events, POS ingest history, RetailNext snapshots, campaigns, schedule slots, ICP links, assignments, subscriptions, tier history. Songs and ICPs stay (shared / parented to the client). Irreversible.
            </div>

            {!deleteArmed ? (
              <div>
                <Button variant="danger" onClick={() => setDeleteArmed(true)}>Delete location</Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
                <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.text }}>
                  Type <strong>{detail.name}</strong> to confirm:
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Input
                    autoFocus
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && deleteConfirmText.trim() === detail.name) void deleteStore()
                      if (e.key === 'Escape') cancelDelete()
                    }}
                    placeholder={detail.name}
                  />
                  <button
                    onClick={() => void deleteStore()}
                    disabled={deleteBusy || deleteConfirmText.trim() !== detail.name}
                    style={{
                      background: T.danger, color: '#fff', border: 'none',
                      padding: '6px 12px', borderRadius: S.r3,
                      fontFamily: T.sans, fontSize: S.small, fontWeight: 600,
                      cursor: (deleteBusy || deleteConfirmText.trim() !== detail.name) ? 'default' : 'pointer',
                      opacity: (deleteBusy || deleteConfirmText.trim() !== detail.name) ? 0.5 : 1,
                    }}
                  >{deleteBusy ? 'deleting…' : 'Confirm delete'}</button>
                  <Button variant="ghost" onClick={cancelDelete} disabled={deleteBusy}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function CreateForm({ draft, clients, outcomes, onChange, onSubmit, onCancel, busy }: {
  draft: StoreCreateBody
  clients: ClientListRow[]
  outcomes: OutcomeRowFull[]
  onChange: (d: StoreCreateBody) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}) {
  const set = <K extends keyof StoreCreateBody>(k: K, v: StoreCreateBody[K]) => onChange({ ...draft, [k]: v })
  const valid = draft.clientId && draft.name && draft.timezone

  return (
    <Section title="New location" columns={2}>
      <Field label="client">
        <Select value={draft.clientId} onChange={(e) => set('clientId', e.target.value)}>
          <option value="" disabled>— pick —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
        </Select>
      </Field>
      <Field label="name">
        <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="timezone">
        <Input
          list="tz-list-create"
          value={draft.timezone}
          onChange={(e) => set('timezone', e.target.value)}
        />
        <datalist id="tz-list-create">{COMMON_TZ.map((tz) => <option key={tz} value={tz} />)}</datalist>
      </Field>
      <Field label="default outcome">
        <Select
          value={draft.defaultOutcomeId ?? ''}
          onChange={(e) => set('defaultOutcomeId', e.target.value || null)}
        >
          <option value="">— none —</option>
          {outcomes.map((o) => <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>)}
        </Select>
      </Field>
      <Field label="go-live date">
        <Input
          type="date"
          value={draft.goLiveDate ?? ''}
          onChange={(e) => set('goLiveDate', e.target.value || null)}
        />
      </Field>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <Button onClick={onSubmit} disabled={!valid} busy={busy}>
          {busy ? 'creating…' : 'create location'}
        </Button>
        <Button variant="tiny" onClick={onCancel}>cancel</Button>
      </div>
    </Section>
  )
}
