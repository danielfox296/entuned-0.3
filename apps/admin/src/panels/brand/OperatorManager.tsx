import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { OperatorRow, StoreSummary } from '../../api.js'
import { T } from '../../tokens.js'

export function OperatorManager() {
  const [operators, setOperators] = useState<OperatorRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [selected, setSelected] = useState<OperatorRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const [ops, sts] = await Promise.all([api.operators(token), api.stores(token)])
      setOperators(ops); setStores(sts)
    } catch (e: any) { setErr(e.message) }
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
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const create = async (body: Parameters<typeof api.createOperator>[0]) => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      await api.createOperator(body, token)
      setCreating(false)
      await load()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Operator Manager</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Create store-level operators and manage their credentials and store access.
        </div>
      </div>

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setSelected(null); setCreating(true) }} style={primaryBtn(true, false)}>+ new operator</button>
      </div>

      {creating && stores && (
        <CreateForm
          stores={stores}
          onSubmit={create}
          onCancel={() => setCreating(false)}
          busy={busy}
          err={err}
        />
      )}

      {selected && stores && (
        <EditForm
          op={selected}
          stores={stores}
          onSave={save}
          onClose={() => setSelected(null)}
          busy={busy}
        />
      )}

      {operators && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', background: T.surfaceRaised, padding: '6px 12px', fontSize: 9, fontFamily: T.mono, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span>Email</span><span>Stores</span><span>Status</span><span />
          </div>
          {operators.map((op) => (
            <div key={op.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', padding: '10px 12px', borderTop: `1px solid ${T.border}`, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.text }}>{op.email}</div>
                {op.displayName && <div style={{ fontSize: 10, fontFamily: T.sans, color: T.textMuted }}>{op.displayName}</div>}
                {op.isAdmin && <div style={{ fontSize: 9, fontFamily: T.mono, color: T.accent }}>admin</div>}
              </div>
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textMuted }}>
                {op.stores.length === 0 ? '—' : op.stores.map((s) => s.name).join(', ')}
              </div>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: op.disabledAt ? T.danger : T.success }}>
                {op.disabledAt ? 'disabled' : 'active'}
              </div>
              <button onClick={() => { setCreating(false); setSelected(op) }} style={ghostBtn}>edit</button>
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
    <Section title="new operator">
      {err && <div style={{ gridColumn: '1/-1', fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      <Field label="email"><input value={email} onChange={(e) => setEmail(e.target.value)} style={input} placeholder="operator@store.com" /></Field>
      <Field label="password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} placeholder="set initial password" /></Field>
      <Field label="display name (optional)"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={input} placeholder="e.g. Park Meadows" /></Field>
      <Field label="store access" full>
        <StoreCheckboxes stores={stores} selected={storeIds} onChange={setStoreIds} />
      </Field>
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
        <button onClick={() => onSubmit({ email, password, displayName: displayName || null, storeIds })} disabled={!valid || busy} style={primaryBtn(valid, busy)}>
          {busy ? 'creating…' : 'create operator'}
        </button>
        <button onClick={onCancel} style={ghostBtn}>cancel</button>
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
    <Section title={`editing — ${op.email}`}>
      <Field label="email"><input value={email} onChange={(e) => setEmail(e.target.value)} style={input} /></Field>
      <Field label="new password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} placeholder="leave blank to keep current" /></Field>
      <Field label="display name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={input} placeholder="optional" /></Field>
      <Field label="store access" full>
        <StoreCheckboxes stores={stores} selected={storeIds} onChange={setStoreIds} />
      </Field>
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={submit} disabled={!dirty || busy} style={primaryBtn(dirty, busy)}>
          {busy ? 'saving…' : dirty ? 'save changes' : 'no changes'}
        </button>
        <button onClick={onClose} style={ghostBtn}>cancel</button>
        {!op.isAdmin && (
          <button
            onClick={() => onSave({ disabled: !op.disabledAt })}
            disabled={busy}
            style={{ ...ghostBtn, borderColor: op.disabledAt ? T.success : T.danger, color: op.disabledAt ? T.success : T.danger }}
          >
            {op.disabledAt ? 'enable' : 'disable'}
          </button>
        )}
      </div>
    </Section>
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
        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: T.mono, color: T.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
          {s.clientName} — {s.name}
        </label>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      <div style={{ gridColumn: '1/-1', fontFamily: T.mono, fontSize: 10, color: T.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: any }) {
  return (
    <div style={{ gridColumn: full ? '1/-1' : 'auto' }}>
      <label style={{ display: 'block', fontSize: 9, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const input: CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 3,
  outline: 'none', width: '100%', boxSizing: 'border-box',
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

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '6px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
}
