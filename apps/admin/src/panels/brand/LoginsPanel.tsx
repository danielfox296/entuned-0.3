import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientLoginRow, LoginRole, StoreSummary } from '../../api.js'
import { T } from '@entuned/tokens'
import {
  Button, Input, Section, Field, S, useToast, useClientSelection,
} from '../../ui/index.js'

// One list of every Account associated with the selected Client — owners,
// managers, store associates. Role tag distinguishes them; one editor handles
// email/name/password/stores/disable + magic-link recovery for passwordless
// customer accounts. Cross-client admins (Entuned staff) are excluded — they
// aren't members of any Client and have no business appearing in this surface.

const ROLE_COLOR: Record<LoginRole, string> = {
  owner: T.success,
  manager: T.success,
  associate: T.textMuted,
}

export function LoginsPanel() {
  const [clientId] = useClientSelection()
  const [rows, setRows] = useState<ClientLoginRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [selected, setSelected] = useState<ClientLoginRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = async () => {
    if (!clientId) { setRows(null); return }
    const tk = getToken(); if (!tk) return
    try {
      const [logins, allStores] = await Promise.all([
        api.clientLogins(clientId, tk),
        api.stores(tk),
      ])
      setRows(logins)
      setStores(allStores)
      if (selected) setSelected(logins.find((u) => u.id === selected.id) ?? null)
    } catch (e: any) {
      toast.error(e.message ?? 'failed to load logins')
    }
  }

  useEffect(() => {
    setSelected(null); setCreating(false)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  if (!clientId) {
    return (
      <div style={{
        padding: '12px 14px', color: T.textDim,
        fontFamily: T.sans, fontSize: S.small,
      }}>
        Pick a client above to manage logins.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => { setSelected(null); setCreating(true) }}>+ new login</Button>
      </div>

      {creating && stores && (
        <CreateForm
          clientStores={stores.filter((s) => s.clientId === clientId)}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={async (body) => {
            const tk = getToken(); if (!tk) return
            setBusy(true)
            try {
              await api.createOperator(body, tk)
              setCreating(false)
              await load()
              toast.success(`login "${body.email}" created`)
            } catch (e: any) {
              toast.error(e.message ?? 'failed to create login')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {rows && (
        <LoginTable rows={rows} clientId={clientId} onSelect={setSelected} selectedId={selected?.id ?? null} />
      )}

      {selected && stores && (
        <LoginDetail
          row={selected}
          clientStores={stores.filter((s) => s.clientId === clientId)}
          busy={busy}
          onClose={() => setSelected(null)}
          onAction={async (action) => {
            const tk = getToken(); if (!tk) return
            setBusy(true)
            try { await action(tk); await load() }
            catch (e: any) { toast.error(e.message ?? 'action failed') }
            finally { setBusy(false) }
          }}
          toast={toast}
        />
      )}
    </div>
  )
}

function RoleBadge({ role }: { role: LoginRole }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: S.label, fontFamily: T.sans, color: ROLE_COLOR[role],
      border: `1px solid ${ROLE_COLOR[role]}`, textTransform: 'uppercase',
      letterSpacing: 0.5, lineHeight: 1.4, whiteSpace: 'nowrap',
    }}>{role}</span>
  )
}

function LoginTable({ rows, clientId, onSelect, selectedId }: {
  rows: ClientLoginRow[]; clientId: string
  onSelect: (u: ClientLoginRow) => void; selectedId: string | null
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 100px 1.6fr 1.4fr 90px',
        gap: 16, background: T.surfaceRaised, padding: '6px 12px',
        fontSize: S.label, fontFamily: T.sans, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        <span>Email</span><span>Role</span><span>Locations</span>
        <span>Last login</span><span>Status</span>
      </div>
      {rows.length === 0 && (
        <div style={{ padding: '12px 14px', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          No logins yet.
        </div>
      )}
      {rows.map((u) => {
        const on = u.id === selectedId
        const clientStores = u.stores.filter((s) => s.clientId === clientId)
        const locText = clientStores.length === 0
          ? '—'
          : clientStores.map((s) => s.name).join(', ')
        return (
          <div
            key={u.id}
            onClick={() => onSelect(u)}
            style={{
              display: 'grid', gridTemplateColumns: '2fr 100px 1.6fr 1.4fr 90px',
              gap: 16, padding: '10px 12px', borderTop: `1px solid ${T.border}`,
              alignItems: 'center', cursor: 'pointer',
              background: on ? T.accentGlow : 'transparent',
            }}
          >
            <div style={{ minWidth: 0, fontSize: S.small, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.email}>
              {u.email}
              {u.name && <span style={{ color: T.textDim }}> · {u.name}</span>}
            </div>
            <div><RoleBadge role={u.role} /></div>
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={locText}>
              {locText}
            </div>
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted }}>
              {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
            </div>
            <div style={{
              fontSize: S.label, fontFamily: T.sans,
              color: u.disabledAt ? T.danger : T.success, whiteSpace: 'nowrap',
            }}>
              {u.disabledAt ? 'disabled' : 'active'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LoginDetail({ row, clientStores, busy, onClose, onAction, toast }: {
  row: ClientLoginRow
  clientStores: StoreSummary[]
  busy: boolean
  onClose: () => void
  onAction: (fn: (token: string) => Promise<unknown>) => Promise<void>
  toast: ReturnType<typeof useToast>
}) {
  const [email, setEmail] = useState(row.email)
  const [name, setName] = useState(row.name ?? '')
  const [password, setPassword] = useState('')
  const initialStoreIds = useMemo(
    () => row.stores.filter((s) => clientStores.some((c) => c.id === s.id)).map((s) => s.id),
    [row.id, row.stores, clientStores],
  )
  const [storeIds, setStoreIds] = useState<string[]>(initialStoreIds)

  useEffect(() => {
    setEmail(row.email)
    setName(row.name ?? '')
    setPassword('')
    setStoreIds(initialStoreIds)
  }, [row.id, row.email, row.name, initialStoreIds])

  const emailChanged = email !== row.email
  const nameChanged = (name || null) !== row.name
  const storesChanged = JSON.stringify([...storeIds].sort()) !== JSON.stringify([...initialStoreIds].sort())
  const dirty = emailChanged || nameChanged || password.length > 0 || storesChanged

  const save = () =>
    onAction(async (tk) => {
      const body: any = {}
      if (emailChanged) body.email = email
      if (nameChanged) body.name = name || null
      if (password) body.password = password
      if (storesChanged) {
        const otherStoreIds = row.stores.filter((s) => !clientStores.some((c) => c.id === s.id)).map((s) => s.id)
        body.storeIds = [...otherStoreIds, ...storeIds]
      }
      await api.updateOperator(row.id, body, tk)
      toast.success('saved')
    })

  const sendMagicLink = () =>
    onAction(async (tk) => {
      const r = await api.sendUserMagicLink(row.id, tk)
      if (r.error) toast.error(`send failed: ${r.error}`)
      else if (r.dryRun) toast.success(`dry-run: link logged for ${r.sentTo} (no email key set)`)
      else toast.success(`magic link sent to ${r.sentTo}`)
    })

  const revoke = () =>
    onAction(async (tk) => {
      await api.revokeUserSessions(row.id, tk)
      toast.success(`sessions revoked for ${row.email}`)
    })

  const setDisabled = (d: boolean) =>
    onAction(async (tk) => {
      await api.updateOperator(row.id, { disabled: d }, tk)
      toast.success(d ? `${row.email} disabled` : `${row.email} re-enabled`)
    })

  const authLabel = row.googleSubLinked
    ? (row.hasPassword ? 'password + Google OAuth' : 'magic-link + Google OAuth')
    : (row.hasPassword ? 'password' : 'magic-link')

  return (
    <Section title={`Editing — ${row.email}`} columns={2}>
      <Field label="email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" /></Field>

      <Field label={row.hasPassword ? 'new password (leave blank to keep)' : 'set password (optional)'}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={row.hasPassword ? '••••••••' : 'leave blank for magic-link only'} />
      </Field>

      <Field label="role" >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RoleBadge role={row.role} />
          <span style={{ fontSize: S.label, fontFamily: T.sans, color: T.textDim }}>auth: {authLabel}</span>
        </div>
      </Field>

      <Field label="locations on this client" full>
          {clientStores.length === 0 ? (
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textDim }}>
              No stores configured for this client yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
              {clientStores.map((s) => (
                <label key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: S.small, fontFamily: T.sans, color: T.text, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={storeIds.includes(s.id)}
                    onChange={() =>
                      setStoreIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])
                    }
                  />
                  {s.name}
                </label>
              ))}
            </div>
          )}
      </Field>

      <Field label="status" full>
        <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted, lineHeight: 1.6 }}>
          Created {new Date(row.createdAt).toLocaleString()} · Last login {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'never'} ·
          Token version: {row.tokenVersion} ·
          Lifecycle email: {row.lifecycleEmailsOptOut ? 'opted out' : 'subscribed'}
        </div>
      </Field>

      <div style={{ gridColumn: '1/-1', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button onClick={save} disabled={!dirty} busy={busy}>
          {busy ? 'saving…' : dirty ? 'save changes' : 'no changes'}
        </Button>
        <Button variant="ghost" onClick={onClose}>close</Button>

        <span style={{ flex: 1 }} />

        <Button variant="ghost" onClick={sendMagicLink} disabled={busy || !!row.disabledAt}>send magic link</Button>
        <Button variant="ghost" onClick={revoke} disabled={busy}>revoke sessions</Button>
        <Button
          variant={row.disabledAt ? 'ghost' : 'danger'}
          onClick={() => setDisabled(!row.disabledAt)}
          disabled={busy}
        >
          {row.disabledAt ? 'enable' : 'disable'}
        </Button>
      </div>
    </Section>
  )
}

function CreateForm({ clientStores, onSubmit, onCancel, busy }: {
  clientStores: StoreSummary[]
  onSubmit: (body: { email: string; password: string; name?: string | null; storeIds: string[] }) => void
  onCancel: () => void
  busy: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [storeIds, setStoreIds] = useState<string[]>([])

  const valid = email.includes('@') && password.length > 0

  return (
    <Section title="New login" columns={2}>
      <Field label="email"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="login@email.com" /></Field>
      <Field label="password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="initial password" /></Field>
      <Field label="name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" /></Field>
      <Field label="locations" full>
        {clientStores.length === 0 ? (
          <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textDim }}>
            No stores configured for this client yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
            {clientStores.map((s) => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: S.small, fontFamily: T.sans, color: T.text, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={storeIds.includes(s.id)}
                  onChange={() =>
                    setStoreIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </Field>
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
        <Button
          onClick={() => onSubmit({ email, password, name: name || null, storeIds })}
          disabled={!valid}
          busy={busy}
        >{busy ? 'creating…' : 'create login'}</Button>
        <Button variant="ghost" onClick={onCancel}>cancel</Button>
      </div>
    </Section>
  )
}
