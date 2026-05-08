import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { UserRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Section, Field, S, useToast } from '../../ui/index.js'

// Customer (User) management for Dash. Distinct from operators — these are
// app.entuned.co accounts. Auth is magic-link / Google OAuth, so the
// recovery primitives are: send fresh magic link, change email, revoke
// active sessions, disable.

export function UsersPanel() {
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = async (query = q) => {
    const tk = getToken(); if (!tk) return
    try {
      const data = await api.users(tk, query.trim() || undefined)
      setRows(data)
      // Refresh selected from new list (or drop if no longer matches).
      if (selected) {
        const match = data.find((u) => u.id === selected.id)
        setSelected(match ?? null)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'failed to load users')
    }
  }

  useEffect(() => { void load('') /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
          placeholder="search by email or name…"
          style={{ minWidth: 320 }}
        />
        <Button onClick={() => void load()}>search</Button>
        {q && <Button variant="ghost" onClick={() => { setQ(''); void load('') }}>clear</Button>}
      </div>

      {rows && (
        <UserTable rows={rows} onSelect={(u) => setSelected(u)} selectedId={selected?.id ?? null} />
      )}

      {selected && (
        <UserDetail
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

function UserTable({ rows, onSelect, selectedId }: {
  rows: UserRow[]; onSelect: (u: UserRow) => void; selectedId: string | null
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1.4fr 1.4fr 110px 110px',
        gap: 16, background: T.surfaceRaised, padding: '6px 12px',
        fontSize: S.label, fontFamily: T.sans, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        <span>Email</span><span>Name / Client</span><span>Last login</span>
        <span>Auth</span><span>Status</span>
      </div>
      {rows.length === 0 && (
        <div style={{ padding: '12px 14px', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
          No users match.
        </div>
      )}
      {rows.map((u) => {
        const on = u.id === selectedId
        return (
          <div
            key={u.id}
            onClick={() => onSelect(u)}
            style={{
              display: 'grid', gridTemplateColumns: '2fr 1.4fr 1.4fr 110px 110px',
              gap: 16, padding: '10px 12px', borderTop: `1px solid ${T.border}`,
              alignItems: 'center', cursor: 'pointer',
              background: on ? T.accentGlow : 'transparent',
            }}
          >
            <div style={{ minWidth: 0, fontSize: S.small, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.email}>
              {u.email}
            </div>
            <div style={{ minWidth: 0, fontSize: S.label, fontFamily: T.sans, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={[u.name, ...u.clients.map((c) => c.companyName)].filter(Boolean).join(' · ')}>
              {u.name ?? '—'}
              {u.clients.length > 0 && (
                <span style={{ color: T.textDim }}> · {u.clients.map((c) => c.companyName).join(', ')}</span>
              )}
            </div>
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

function UserDetail({ user, busy, onClose, onAction, toast }: {
  user: UserRow
  busy: boolean
  onClose: () => void
  onAction: (fn: (token: string) => Promise<unknown>) => Promise<void>
  toast: ReturnType<typeof useToast>
}) {
  const [email, setEmail] = useState(user.email)
  const [name, setName] = useState(user.name ?? '')
  const dirty = email !== user.email || (name || null) !== user.name

  // Reset local form when the underlying user changes (selection or refetch).
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
