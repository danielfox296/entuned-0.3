import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, StoreSummary, OutcomeRowFull, StoreCreateBody, StoreUpdateBody } from '../../api.js'
import { T } from '../../tokens.js'

const COMMON_TZ = [
  'America/Denver', 'America/Chicago', 'America/New_York', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'America/Honolulu',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'UTC',
]

export function StoreEditor() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [clients, setClients] = useState<ClientListRow[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [icps, setIcps] = useState<{ id: string; name: string; clientId: string }[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: string; name: string; timezone: string; clientId: string; clientName: string; icpId: string; goLiveDate: string | null; defaultOutcomeId: string | null } | null>(null)
  const [draft, setDraft] = useState<StoreUpdateBody | null>(null)
  const [creating, setCreating] = useState<StoreCreateBody | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reloadAll = async () => {
    const token = getToken(); if (!token) return
    try {
      const [s, c, o, p] = await Promise.all([
        api.stores(token),
        api.clients(token),
        api.outcomeLibrary(token),
        api.poolDepth(token),
      ])
      setStores(s); setClients(c); setOutcomes(o)
      // Backfill an ICP list — pool depth carries them with stores; map back to clientId via stores.
      const storeByIcp = new Map<string, string>()
      for (const st of s) storeByIcp.set(st.icpId, st.clientId)
      const merged = p.icps.map((i) => ({ id: i.id, name: i.name, clientId: storeByIcp.get(i.id) ?? '' }))
      setIcps(merged)
    } catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { void reloadAll() }, [])

  useEffect(() => {
    if (!storeId) { setDetail(null); setDraft(null); return }
    const token = getToken(); if (!token) return
    setDetail(null); setDraft(null); setErr(null)
    api.storeDetail(storeId, token).then(async (d) => {
      // storeDetail does not include goLive/defaultOutcomeId — refetch via the live endpoint shape.
      const live = await api.liveStore(storeId, token).catch(() => null)
      setDetail({
        id: d.store.id, name: d.store.name, timezone: d.store.timezone,
        clientId: d.store.clientId, clientName: d.store.clientName,
        icpId: d.icp.id,
        goLiveDate: null, // not exposed in storeDetail; updates still allowed
        defaultOutcomeId: live?.store.defaultOutcomeId ?? null,
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
      setDetail((cur) => cur ? { ...cur, ...updated } : cur)
      setDraft({})
      reloadAll()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const submitCreate = async () => {
    if (!creating) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const created = await api.createStore(creating, token)
      setCreating(null); setStoreId(created.id); reloadAll()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Store Editor</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Edit a store's name, timezone, ICP binding, default outcome, and go-live date. Or create a new store under an existing client + ICP.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <StorePicker stores={stores} storeId={storeId} onPick={(id) => { setStoreId(id); setCreating(null) }} />
        <button
          onClick={() => {
            setStoreId(null)
            setCreating({ clientId: clients?.[0]?.id ?? '', icpId: '', name: '', timezone: 'America/Denver' })
          }}
          style={primaryBtn(true, false)}
        >+ new store</button>
      </div>

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {creating && (
        <CreateForm
          draft={creating}
          clients={clients ?? []}
          icps={icps ?? []}
          outcomes={outcomes ?? []}
          onChange={setCreating}
          onSubmit={submitCreate}
          onCancel={() => setCreating(null)}
          busy={busy}
        />
      )}

      {storeId && !detail && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {detail && draft && (
        <>
          <Section title="store">
            <Field label="name">
              <input
                value={draft.name ?? detail.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                style={input}
              />
            </Field>
            <Field label="client">
              <input value={detail.clientName} disabled style={{ ...input, opacity: 0.6 }} />
            </Field>
            <Field label="timezone">
              <input
                list="tz-list"
                value={draft.timezone ?? detail.timezone}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                style={input}
              />
              <datalist id="tz-list">{COMMON_TZ.map((tz) => <option key={tz} value={tz} />)}</datalist>
            </Field>
            <Field label="ICP">
              <select
                value={draft.icpId ?? detail.icpId}
                onChange={(e) => setDraft({ ...draft, icpId: e.target.value })}
                style={input}
              >
                {(icps ?? []).filter((i) => !detail.clientId || !i.clientId || i.clientId === detail.clientId).map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </Field>
            <Field label="default outcome">
              <select
                value={draft.defaultOutcomeId ?? detail.defaultOutcomeId ?? ''}
                onChange={(e) => setDraft({ ...draft, defaultOutcomeId: e.target.value || null })}
                style={input}
              >
                <option value="">— none —</option>
                {(outcomes ?? []).map((o) => <option key={o.id} value={o.id}>{o.title} v{o.version}</option>)}
              </select>
            </Field>
            <Field label="go-live date">
              <input
                type="date"
                value={draft.goLiveDate ?? detail.goLiveDate ?? ''}
                onChange={(e) => setDraft({ ...draft, goLiveDate: e.target.value || null })}
                style={input}
              />
            </Field>
          </Section>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={save} disabled={!dirty || busy} style={primaryBtn(!!dirty, busy)}>
              {busy ? 'saving…' : (dirty ? 'save changes' : 'no changes')}
            </button>
            {dirty && <button onClick={() => setDraft({})} style={tinyBtn}>discard</button>}
          </div>
        </>
      )}
    </div>
  )
}

function StorePicker({ stores, storeId, onPick }: { stores: StoreSummary[] | null; storeId: string | null; onPick: (id: string) => void }) {
  if (!stores) return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>store</span>
      <select
        value={storeId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        style={{ ...input, width: 360 }}
      >
        <option value="" disabled>— pick a store —</option>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.clientName} — {s.name}</option>)}
      </select>
    </div>
  )
}

function CreateForm({ draft, clients, icps, outcomes, onChange, onSubmit, onCancel, busy }: {
  draft: StoreCreateBody; clients: ClientListRow[]
  icps: { id: string; name: string; clientId: string }[]
  outcomes: OutcomeRowFull[]
  onChange: (d: StoreCreateBody) => void
  onSubmit: () => void; onCancel: () => void; busy: boolean
}) {
  const set = <K extends keyof StoreCreateBody>(k: K, v: StoreCreateBody[K]) => onChange({ ...draft, [k]: v })
  const valid = draft.clientId && draft.icpId && draft.name && draft.timezone
  const filteredIcps = icps.filter((i) => !i.clientId || i.clientId === draft.clientId)

  return (
    <Section title="new store">
      <Field label="client">
        <select value={draft.clientId} onChange={(e) => set('clientId', e.target.value)} style={input}>
          <option value="" disabled>— pick —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
        </select>
      </Field>
      <Field label="ICP">
        <select value={draft.icpId} onChange={(e) => set('icpId', e.target.value)} style={input}>
          <option value="" disabled>— pick —</option>
          {filteredIcps.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>
      <Field label="name">
        <input value={draft.name} onChange={(e) => set('name', e.target.value)} style={input} />
      </Field>
      <Field label="timezone">
        <input
          list="tz-list-create"
          value={draft.timezone}
          onChange={(e) => set('timezone', e.target.value)}
          style={input}
        />
        <datalist id="tz-list-create">{COMMON_TZ.map((tz) => <option key={tz} value={tz} />)}</datalist>
      </Field>
      <Field label="default outcome">
        <select value={draft.defaultOutcomeId ?? ''} onChange={(e) => set('defaultOutcomeId', e.target.value || null)} style={input}>
          <option value="">— none —</option>
          {outcomes.map((o) => <option key={o.id} value={o.id}>{o.title} v{o.version}</option>)}
        </select>
      </Field>
      <Field label="go-live date">
        <input type="date" value={draft.goLiveDate ?? ''} onChange={(e) => set('goLiveDate', e.target.value || null)} style={input} />
      </Field>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <button onClick={onSubmit} disabled={!valid || busy} style={primaryBtn(!!valid, busy)}>
          {busy ? 'creating…' : 'create store'}
        </button>
        <button onClick={onCancel} style={tinyBtn}>cancel</button>
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 4,
      background: T.surface, padding: 16,
      display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
    }}>
      <div style={{ gridColumn: '1 / -1', fontFamily: T.mono, fontSize: 10, color: T.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: any }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{ display: 'block', fontSize: 9, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const input: CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 3, padding: '8px 16px',
    fontFamily: T.mono, fontSize: 11, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const tinyBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '6px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
}
