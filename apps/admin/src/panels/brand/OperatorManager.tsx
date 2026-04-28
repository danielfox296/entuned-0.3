import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { OperatorRow, StoreSummary } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Section, Field, PanelHeader, S, useToast } from '../../ui/index.js'

export function OperatorManager() {
  const [operators, setOperators] = useState<OperatorRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [selected, setSelected] = useState<OperatorRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const [ops, sts] = await Promise.all([api.operators(token), api.stores(token)])
      setOperators(ops); setStores(sts)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to load') }
  }

  useEffect(() => { void load() }, [])

  const save = async (body: Parameters<typeof api.updateOperator>[1]) => {
    if (!selected) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const updated = await api.updateOperator(selected.id, body, token)
      setSelected(updated)
      await load()
      toast.success(`${updated.email} saved`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'save failed') }
    finally { setBusy(false) }
  }

  const create = async (body: Parameters<typeof api.createOperator>[0]) => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const created = await api.createOperator(body, token)
      setCreating(false)
      await load()
      toast.success(`${created.email} created`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'create failed') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader title="Location Associates" />

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => { setSelected(null); setCreating(true) }}>+ new associate</Button>
      </div>

      {creating && stores && (
        <CreateForm stores={stores} onSubmit={create} onCancel={() => setCreating(false)} busy={busy} err={err} />
      )}

      {selected && stores && (
        <EditForm op={selected} stores={stores} onSave={save} onClose={() => setSelected(null)} busy={busy} />
      )}

      {operators && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.2fr 2fr 90px auto', gap: 16,
            background: T.surfaceRaised, padding: '6px 12px',
            fontSize: S.label, fontFamily: T.sans, color: T.textDim,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            <span>Email</span><span>Location</span><span>Status</span><span />
          </div>
          {operators.map((op) => (
            <div key={op.id} style={{
              display: 'grid', gridTemplateColumns: '1.2fr 2fr 90px auto', gap: 16,
              padding: '10px 12px', borderTop: `1px solid ${T.border}`, alignItems: 'center',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: S.small, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.email}</div>
                {op.displayName && <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted }}>{op.displayName}</div>}
                {op.isAdmin && <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.accent }}>admin</div>}
              </div>
              <div style={{ fontSize: S.small, fontFamily: T.sans, color: T.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={op.stores.map((s) => (s.clientName ? `${s.clientName} — ${s.name}` : s.name)).join(', ')}>
                {op.stores.length === 0
                  ? '—'
                  : op.stores.map((s) => (s.clientName ? `${s.clientName} — ${s.name}` : s.name)).join(', ')}
              </div>
              <div style={{ fontSize: S.label, fontFamily: T.sans, color: op.disabledAt ? T.danger : T.success, whiteSpace: 'nowrap' }}>
                {op.disabledAt ? 'disabled' : 'active'}
              </div>
              <Button variant="ghost" onClick={() => { setCreating(false); setSelected(op) }}>edit</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateForm({ stores, onSubmit, onCancel, busy, err }: {
  stores: StoreSummary[]
  onSubmit: (body: { email: string; password: string; displayName?: string | null; storeIds: string[] }) => void
  onCancel: () => void
  busy: boolean
  err: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [storeIds, setStoreIds] = useState<string[]>([])

  const valid = email.includes('@') && password.length > 0

  return (
    <Section title="New associate" columns={2}>
      {err && <div style={{ gridColumn: '1/-1', fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}
      <Field label="email"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="associate@location.com" /></Field>
      <Field label="password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="set initial password" /></Field>
      <Field label="display name (optional)"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Park Meadows" /></Field>
      <Field label="location" full>
        <LocationPicker stores={stores} selected={storeIds[0] ?? null} onChange={(id) => setStoreIds(id ? [id] : [])} />
      </Field>
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
        <Button onClick={() => onSubmit({ email, password, displayName: displayName || null, storeIds })} disabled={!valid || storeIds.length !== 1} busy={busy}>
          {busy ? 'creating…' : 'create associate'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>cancel</Button>
      </div>
    </Section>
  )
}

function EditForm({ op, stores, onSave, onClose, busy }: {
  op: OperatorRow
  stores: StoreSummary[]
  onSave: (body: { email?: string; password?: string; displayName?: string | null; storeIds?: string[]; disabled?: boolean }) => void
  onClose: () => void
  busy: boolean
}) {
  const [email, setEmail] = useState(op.email)
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(op.displayName ?? '')
  const [storeIds, setStoreIds] = useState<string[]>(op.stores.map((s) => s.id))

  const emailChanged = email !== op.email
  const storesChanged = JSON.stringify([...storeIds].sort()) !== JSON.stringify([...op.stores.map((s) => s.id)].sort())
  const displayNameChanged = (displayName || null) !== op.displayName
  const dirty = emailChanged || password.length > 0 || storesChanged || displayNameChanged

  const submit = () => {
    const body: Parameters<typeof onSave>[0] = {}
    if (emailChanged) body.email = email
    if (password) body.password = password
    if (displayNameChanged) body.displayName = displayName || null
    if (storesChanged) body.storeIds = storeIds
    onSave(body)
  }

  return (
    <Section title={`Editing — ${op.email}`} columns={2}>
      <Field label="email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="new password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="leave blank to keep current" /></Field>
      <Field label="display name"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optional" /></Field>
      <Field label="location" full>
        {op.isAdmin ? (
          <StoreCheckboxes stores={stores} selected={storeIds} onChange={setStoreIds} />
        ) : (
          <LocationPicker stores={stores} selected={storeIds[0] ?? null} onChange={(id) => setStoreIds(id ? [id] : [])} />
        )}
      </Field>
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button onClick={submit} disabled={!dirty || (!op.isAdmin && storeIds.length !== 1)} busy={busy}>
          {busy ? 'saving…' : dirty ? 'save changes' : 'no changes'}
        </Button>
        <Button variant="ghost" onClick={onClose}>cancel</Button>
        {!op.isAdmin && (
          <Button
            variant={op.disabledAt ? 'ghost' : 'danger'}
            onClick={() => onSave({ disabled: !op.disabledAt })}
            disabled={busy}
          >
            {op.disabledAt ? 'enable' : 'disable'}
          </Button>
        )}
      </div>
    </Section>
  )
}

function LocationPicker({ stores, selected, onChange }: {
  stores: StoreSummary[]; selected: string | null; onChange: (id: string | null) => void
}) {
  return (
    <select
      value={selected ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={{
        background: T.surface, border: `1px solid ${T.border}`, color: T.text,
        padding: '7px 10px', fontFamily: T.sans, fontSize: S.small, borderRadius: S.r4,
        minWidth: 280, outline: 'none',
      }}
    >
      <option value="">— pick a location —</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>{s.clientName} — {s.name}</option>
      ))}
    </select>
  )
}

function StoreCheckboxes({ stores, selected, onChange }: {
  stores: StoreSummary[]; selected: string[]; onChange: (ids: string[]) => void
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
      {stores.map((s) => (
        <label key={s.id} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: S.small, fontFamily: T.sans, color: T.text, cursor: 'pointer',
        }}>
          <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
          {s.clientName} — {s.name}
        </label>
      ))}
    </div>
  )
}
