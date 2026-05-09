import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { UserRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Section, Field, S, useToast, useClientSelection } from '../../ui/index.js'
import { OperatorManager } from './OperatorManager.js'

// Combined "Logins" surface for the selected Client. Two sections:
//   1. Brand-owner / manager accounts — log into app.entuned.co (magic-link / Google OAuth).
//      Recovery primitives: send magic link, change email/name, revoke sessions, disable.
//   2. Location associates — log into music.entuned.co (per-store, password-based).
//      Delegated to the existing OperatorManager component.
//
// Replaces the old top-level "Customers" tab. Both sections are auto-scoped to
// the Client picked in the page header.

export function LoginsPanel() {
  const [clientId] = useClientSelection()

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <Section title="Brand owner login (app.entuned.co)">
        <OwnerLogins clientId={clientId} />
      </Section>

      <Section title="Location associates (music.entuned.co)">
        <OperatorManager />
      </Section>
    </div>
  )
}

function OwnerLogins({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = async () => {
    const tk = getToken(); if (!tk) return
    try {
      const data = await api.users(tk, undefined, clientId)
      setRows(data)
      if (selected) {
        const match = data.find((u) => u.id === selected.id)
        setSelected(match ?? null)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'failed to load owner accounts')
    }
  }

  useEffect(() => {
    setSelected(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      {rows && rows.length === 0 && (
        <div style={{ padding: '12px 14px', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          No customer-account login for this client yet. (Operator-managed clients
          like Untuckit don't have one — they were never created via Stripe Checkout.)
        </div>
      )}
      {rows && rows.length > 0 && (
        <OwnerTable rows={rows} onSelect={setSelected} selectedId={selected?.id ?? null} />
      )}
      {selected && (
        <OwnerDetail
          user={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onAction={async (action) => {
            const tk = getToken(); if (!tk) return
            setBusy(true)
            try {
              await action(tk)
              await load()
            } catch (e: any) {
              toast.error(e.message ?? 'action failed')
            } finally {
              setBusy(false)
            }
          }}
          toast={toast}
        />
      )}
    </div>
  )
}

function OwnerTable({ rows, onSelect, selectedId }: {
  rows: UserRow[]; onSelect: (u: UserRow) => void; selectedId: string | null
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.4fr 110px 110px',
        gap: 16, background: T.surfaceRaised, padding: '6px 12px',
        fontSize: S.label, fontFamily: T.sans, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        <span>Email</span><span>Role</span><span>Last login</span>
        <span>Auth</span><span>Status</span>
      </div>
      {rows.map((u) => {
        const on = u.id === selectedId
        const role = u.clients[0]?.role ?? '—'
        return (
          <div
            key={u.id}
            onClick={() => onSelect(u)}
            style={{
              display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.4fr 110px 110px',
              gap: 16, padding: '10px 12px', borderTop: `1px solid ${T.border}`,
              alignItems: 'center', cursor: 'pointer',
              background: on ? T.accentGlow : 'transparent',
            }}
          >
            <div style={{ minWidth: 0, fontSize: S.small, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.email}>
              {u.email}
              {u.name && <span style={{ color: T.textDim }}> · {u.name}</span>}
            </div>
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted }}>{role}</div>
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted }}>
              {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
            </div>
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted }}>
              {u.googleSubLinked ? 'magic + google' : 'magic link'}
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

function OwnerDetail({ user, busy, onClose, onAction, toast }: {
  user: UserRow
  busy: boolean
  onClose: () => void
  onAction: (fn: (token: string) => Promise<unknown>) => Promise<void>
  toast: ReturnType<typeof useToast>
}) {
  const [email, setEmail] = useState(user.email)
  const [name, setName] = useState(user.name ?? '')
  const dirty = email !== user.email || (name || null) !== user.name

  useEffect(() => { setEmail(user.email); setName(user.name ?? '') }, [user.id, user.email, user.name])

  const sendMagicLink = () =>
    onAction(async (tk) => {
      const r = await api.sendUserMagicLink(user.id, tk)
      if (r.error) toast.error(`send failed: ${r.error}`)
      else if (r.dryRun) toast.success(`dry-run: link logged for ${r.sentTo} (no email key set)`)
      else toast.success(`magic link sent to ${r.sentTo}`)
    })

  const revoke = () =>
    onAction(async (tk) => {
      await api.revokeUserSessions(user.id, tk)
      toast.success(`sessions revoked for ${user.email}`)
    })

  const setDisabled = (d: boolean) =>
    onAction(async (tk) => {
      await api.setUserDisabled(user.id, d, tk)
      toast.success(d ? `${user.email} disabled` : `${user.email} re-enabled`)
    })

  const save = () =>
    onAction(async (tk) => {
      const body: { email?: string; name?: string | null } = {}
      if (email !== user.email) body.email = email
      if ((name || null) !== user.name) body.name = name || null
      const r = await api.patchUser(user.id, body, tk)
      toast.success(r.emailChanged ? `email changed (sessions revoked)` : `saved`)
    })

  return (
    <Section title={`Editing — ${user.email}`} columns={2}>
      <Field label="email">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" />
      </Field>

      <Field label="status" full>
        <div style={{ fontSize: S.small, fontFamily: T.sans, color: T.textMuted, lineHeight: 1.6 }}>
          Created {new Date(user.createdAt).toLocaleString()} · Last login {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'never'} ·
          Auth: {user.googleSubLinked ? 'magic-link + Google OAuth' : 'magic-link only'} ·
          Token version: {user.tokenVersion} ·
          Lifecycle email: {user.lifecycleEmailsOptOut ? 'opted out' : 'subscribed'}
        </div>
      </Field>

      <div style={{ gridColumn: '1/-1', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button onClick={save} disabled={!dirty} busy={busy}>
          {busy ? 'saving…' : dirty ? 'save changes' : 'no changes'}
        </Button>
        <Button variant="ghost" onClick={onClose}>close</Button>

        <span style={{ flex: 1 }} />

        <Button variant="ghost" onClick={sendMagicLink} disabled={busy || !!user.disabledAt}>
          send magic link
        </Button>
        <Button variant="ghost" onClick={revoke} disabled={busy}>
          revoke sessions
        </Button>
        <Button
          variant={user.disabledAt ? 'ghost' : 'danger'}
          onClick={() => setDisabled(!user.disabledAt)}
          disabled={busy}
        >
          {user.disabledAt ? 'enable' : 'disable'}
        </Button>
      </div>
    </Section>
  )
}
