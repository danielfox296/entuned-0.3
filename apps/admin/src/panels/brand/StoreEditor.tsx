import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, StoreSummary, OutcomeRowFull, StoreCreateBody, StoreUpdateBody } from '../../api.js'
import { T } from '../../tokens.js'
import {
  Button, Input, Select, Section, Field, KV,
  PanelHeader, StorePicker, S, useToast, useStoreSelection,
} from '../../ui/index.js'

const COMMON_TZ = [
  'America/Denver', 'America/Chicago', 'America/New_York', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'America/Honolulu',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'UTC',
]

export function StoreEditor() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [clients, setClients] = useState<ClientListRow[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [detail, setDetail] = useState<{ id: string; name: string; timezone: string; clientId: string; clientName: string; icps: { id: string; name: string }[]; goLiveDate: string | null; defaultOutcomeId: string | null } | null>(null)
  const [draft, setDraft] = useState<StoreUpdateBody | null>(null)
  const [creating, setCreating] = useState<StoreCreateBody | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()

  const reloadAll = async () => {
    const token = getToken(); if (!token) return
    try {
      const [s, c, o] = await Promise.all([
        api.stores(token),
        api.clients(token),
        api.outcomeLibrary(token),
      ])
      setStores(s); setClients(c); setOutcomes(o)
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
      <PanelHeader title="Location" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StorePicker stores={stores} storeId={storeId} onPick={(id) => { setStoreId(id); setCreating(null) }} />
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
                {(outcomes ?? []).map((o) => <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>)}
              </Select>
            </Field>

            <Field label="go-live date">
              <Input
                type="date"
                value={draft.goLiveDate ?? detail.goLiveDate ?? ''}
                onChange={(e) => setDraft({ ...draft, goLiveDate: e.target.value || null })}
              />
            </Field>
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
