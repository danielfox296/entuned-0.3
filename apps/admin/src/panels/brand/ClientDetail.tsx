import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, ClientFull, ClientPlan, ClientUpdate } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Select, Textarea, Section, Field, S, useToast } from '../../ui/index.js'

const PLANS: ClientPlan[] = ['mvp_pilot', 'trial', 'paid_pilot', 'production', 'paused', 'inactive']

export function ClientDetail() {
  const [list, setList] = useState<ClientListRow[] | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [client, setClient] = useState<ClientFull | null>(null)
  const [draft, setDraft] = useState<ClientUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const toast = useToast()

  const reloadList = async () => {
    const token = getToken(); if (!token) return
    try { setList(await api.clients(token)) } catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { void reloadList() }, [])

  useEffect(() => {
    if (!clientId) { setClient(null); setDraft(null); return }
    const token = getToken(); if (!token) return
    setClient(null); setDraft(null); setErr(null)
    api.clientDetail(clientId, token)
      .then((c) => { setClient(c); setDraft({}) })
      .catch((e) => setErr(e.message))
  }, [clientId])

  const create = async () => {
    if (!newName.trim()) return
    const token = getToken(); if (!token) return
    setCreateBusy(true); setErr(null)
    try {
      const created = await api.createClient({ companyName: newName.trim() }, token)
      await reloadList()
      setClientId(created.id)
      setCreating(false)
      setNewName('')
      toast.success(`client "${created.companyName}" created`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to create client') }
    finally { setCreateBusy(false) }
  }

  const dirty = !!(draft && client && Object.entries(draft).some(([k, v]) => (client as any)[k] !== v))

  const save = async () => {
    if (!client || !draft || !dirty) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const updated = await api.updateClient(client.id, draft, token)
      setClient((cur) => cur ? { ...cur, ...updated } : cur)
      setDraft({})
      reloadList()
      toast.success(`client "${updated.companyName ?? client.companyName}" saved`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save client') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: 420 }}>
          <ClientCombobox
            list={list}
            clientId={clientId}
            onPick={(id) => { setClientId(id); setCreating(false) }}
          />
        </div>
        <span style={{ flex: 1 }} />
        {creating ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Input
              autoFocus
              placeholder="company name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            />
            <Button onClick={() => void create()} disabled={!newName.trim()} busy={createBusy}>
              {createBusy ? 'creating…' : 'create'}
            </Button>
            <Button variant="tiny" onClick={() => { setCreating(false); setNewName('') }}>cancel</Button>
          </div>
        ) : (
          <Button onClick={() => setCreating(true)}>+ new client</Button>
        )}
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}
      {!clientId && <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>pick a client to begin</div>}
      {clientId && !client && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {client && draft && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <Section title="Company" columns={2}>
                <Field label="company name">
                  <Input
                    value={draft.companyName ?? client.companyName ?? ''}
                    onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                  />
                </Field>
                <Field label="plan">
                  <Select
                    value={draft.plan ?? client.plan}
                    onChange={(e) => setDraft({ ...draft, plan: e.target.value as ClientPlan })}
                  >
                    {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Field>
                <Field label="POS provider">
                  <Input
                    value={draft.posProvider ?? client.posProvider ?? ''}
                    onChange={(e) => setDraft({ ...draft, posProvider: e.target.value || null })}
                  />
                </Field>
              </Section>

              <Section title="Contact" columns={2}>
                <Field label="contact name">
                  <Input
                    value={draft.contactName ?? client.contactName ?? ''}
                    onChange={(e) => setDraft({ ...draft, contactName: e.target.value || null })}
                  />
                </Field>
                <Field label="email">
                  <Input
                    type="email"
                    value={draft.contactEmail ?? client.contactEmail ?? ''}
                    onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value || null })}
                  />
                </Field>
                <Field label="phone">
                  <Input
                    value={draft.contactPhone ?? client.contactPhone ?? ''}
                    onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value || null })}
                  />
                </Field>
              </Section>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <Section title={`Locations (${client.stores.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {client.stores.map((s) => (
                    <div key={s.id} style={listRow}>
                      <span style={{ color: T.text, fontWeight: 500 }}>{s.name}</span>
                      <span style={{ color: T.textMuted }}>{s.timezone}</span>
                      <span style={{ color: s.icps.length > 0 ? T.textMuted : T.textDim }}>
                        {s.icps.length === 0
                          ? '(no ICPs)'
                          : s.icps.length === 1
                            ? s.icps[0]!.name
                            : `${s.icps.length} ICPs`}
                      </span>
                      <span style={{ color: s.defaultOutcome ? T.text : T.textDim }}>
                        {s.defaultOutcome ? `default: ${s.defaultOutcome.displayTitle ?? s.defaultOutcome.title}` : 'no default'}
                      </span>
                      <span style={{ color: T.textDim }}>{s.goLiveDate ? `live ${s.goLiveDate}` : '—'}</span>
                    </div>
                  ))}
                  {client.stores.length === 0 && (
                    <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>No locations yet — create one in Location</div>
                  )}
                </div>
              </Section>

              <Section title="Brand voice" columns={2}>
                <Field label="brand lyric guidelines" full>
                  <Textarea
                    value={draft.brandLyricGuidelines ?? client.brandLyricGuidelines ?? ''}
                    onChange={(e) => setDraft({ ...draft, brandLyricGuidelines: e.target.value || null })}
                    rows={6}
                  />
                </Field>
              </Section>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button onClick={save} disabled={!dirty} busy={busy}>
              {busy ? 'saving…' : (dirty ? 'save changes' : 'no changes')}
            </Button>
            {dirty && <Button variant="tiny" onClick={() => setDraft({})}>discard</Button>}
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>
              updated {new Date(client.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function ClientCombobox({ list, clientId, onPick }: {
  list: ClientListRow[] | null
  clientId: string | null
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const selected = clientId && list ? list.find((c) => c.id === clientId) ?? null : null

  const filtered = useMemo(() => {
    if (!list) return []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) => c.companyName.toLowerCase().includes(q))
  }, [list, query])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => { setHighlight(0) }, [query, open])

  if (!list) {
    return <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>
  }

  const displayValue = open ? query : (selected?.companyName ?? '')

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        value={displayValue}
        placeholder="search clients…"
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(filtered.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)) }
          else if (e.key === 'Enter') {
            const pick = filtered[highlight]
            if (pick) { onPick(pick.id); setOpen(false); setQuery(''); inputRef.current?.blur() }
          } else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
        }}
        style={{
          width: '100%',
          background: T.surface,
          border: `1px solid ${T.border}`,
          color: T.text, padding: '8px 12px', borderRadius: S.r4,
          fontFamily: T.sans, fontSize: S.small, outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          maxHeight: 360, overflowY: 'auto', zIndex: 50,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: S.r4,
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: 12, color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
              no matches
            </div>
          )}
          {filtered.map((c, i) => {
            const on = i === highlight
            const sel = c.id === clientId
            return (
              <button
                key={c.id}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); onPick(c.id); setOpen(false); setQuery(''); inputRef.current?.blur() }}
                style={{
                  width: '100%', textAlign: 'left',
                  background: on ? T.accentGlow : 'transparent',
                  border: 'none', borderLeft: sel ? `2px solid ${T.accent}` : '2px solid transparent',
                  color: T.text,
                  padding: '8px 12px', cursor: 'pointer',
                  fontFamily: T.sans, fontSize: S.small,
                  display: 'flex', flexDirection: 'column', gap: 2,
                  borderBottom: `1px solid ${T.borderSubtle}`,
                }}
              >
                <span style={{ fontWeight: sel ? 500 : 400 }}>{c.companyName}</span>
                <span style={{ fontSize: S.label, color: T.textDim }}>
                  {c.plan} · {c.storeCount} location{c.storeCount === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const listRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.4fr 110px',
  gap: 10, padding: '8px 10px',
  background: T.surfaceRaised, border: `1px solid rgba(106, 176, 187, 0.14)`,
  borderRadius: 3, fontFamily: 'Inter, sans-serif', fontSize: 14,
  alignItems: 'center',
}
