import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, ClientFull, ClientPlan, ClientUpdate } from '../../api.js'
import { T } from '../../tokens.js'

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
    } catch (e: any) { setErr(e.message) }
    finally { setCreateBusy(false) }
  }

  const dirty = draft && client && Object.entries(draft).some(([k, v]) => (client as any)[k] !== v)

  const save = async () => {
    if (!client || !draft || !dirty) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const updated = await api.updateClient(client.id, draft, token)
      setClient((cur) => cur ? { ...cur, ...updated } : cur)
      setDraft({})
      reloadList()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Client Detail</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Edit company info, plan tier, POS provider, and brand lyric guidelines (Bernie's voice anchor). Create new locations in Location Editor.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ClientList list={list} clientId={clientId} onPick={(id) => { setClientId(id); setCreating(false) }} />
          {creating ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                autoFocus
                placeholder="company name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
                style={{ ...input, fontSize: 11 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void create()} disabled={!newName.trim() || createBusy} style={primaryBtn(!!newName.trim(), createBusy)}>
                  {createBusy ? 'creating…' : 'create'}
                </button>
                <button onClick={() => { setCreating(false); setNewName('') }} style={tinyBtn}>cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={tinyBtn}>+ new client</button>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}
          {!clientId && <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>← pick a client</div>}
          {clientId && !client && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

          {client && draft && (
            <>
              <Section title="company">
                <Field label="company name">
                  <input
                    value={draft.companyName ?? client.companyName ?? ''}
                    onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                    style={input}
                  />
                </Field>
                <Field label="plan">
                  <select
                    value={draft.plan ?? client.plan}
                    onChange={(e) => setDraft({ ...draft, plan: e.target.value as ClientPlan })}
                    style={input}
                  >
                    {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="POS provider">
                  <input
                    value={draft.posProvider ?? client.posProvider ?? ''}
                    onChange={(e) => setDraft({ ...draft, posProvider: e.target.value || null })}
                    style={input}
                  />
                </Field>
              </Section>

              <Section title="contact">
                <Field label="contact name">
                  <input
                    value={draft.contactName ?? client.contactName ?? ''}
                    onChange={(e) => setDraft({ ...draft, contactName: e.target.value || null })}
                    style={input}
                  />
                </Field>
                <Field label="email">
                  <input
                    type="email"
                    value={draft.contactEmail ?? client.contactEmail ?? ''}
                    onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value || null })}
                    style={input}
                  />
                </Field>
                <Field label="phone">
                  <input
                    value={draft.contactPhone ?? client.contactPhone ?? ''}
                    onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value || null })}
                    style={input}
                  />
                </Field>
              </Section>

              <Section title="brand voice (Bernie input)">
                <Field label="brand lyric guidelines" full>
                  <textarea
                    value={draft.brandLyricGuidelines ?? client.brandLyricGuidelines ?? ''}
                    onChange={(e) => setDraft({ ...draft, brandLyricGuidelines: e.target.value || null })}
                    rows={6}
                    style={{ ...input, fontFamily: T.sans, lineHeight: 1.5, resize: 'vertical' }}
                  />
                </Field>
              </Section>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={save} disabled={!dirty || busy} style={primaryBtn(!!dirty, busy)}>
                  {busy ? 'saving…' : (dirty ? 'save changes' : 'no changes')}
                </button>
                {dirty && <button onClick={() => setDraft({})} style={tinyBtn}>discard</button>}
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
                  updated {new Date(client.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </div>

              <Section title={`locations (${client.stores.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
                  {client.stores.map((s) => (
                    <div key={s.id} style={listRow}>
                      <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500 }}>{s.name}</span>
                      <span style={{ color: T.textMuted }}>{s.timezone}</span>
                      <span style={{ color: s.icp ? T.textMuted : T.textDim }}>{s.icp ? s.icp.name : '(no ICP)'}</span>
                      <span style={{ color: s.defaultOutcome ? T.text : T.textDim }}>
                        {s.defaultOutcome ? `default: ${s.defaultOutcome.title}` : 'no default'}
                      </span>
                      <span style={{ color: T.textDim }}>{s.goLiveDate ? `live ${s.goLiveDate}` : '—'}</span>
                    </div>
                  ))}
                  {client.stores.length === 0 && (
                    <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 11 }}>no locations yet — create one in Location Editor</div>
                  )}
                </div>
              </Section>

              <Section title={`ICPs (${client.icps.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
                  {client.icps.map((i) => (
                    <div key={i.id} style={listRow}>
                      <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500 }}>{i.name}</span>
                      <span style={{ color: T.textMuted }}>{i.storeCount === 1 ? '1 location' : 'no location'}</span>
                      <span style={{ color: T.textMuted }}>{i.hookCount} hook{i.hookCount === 1 ? '' : 's'}</span>
                      <span style={{ color: T.textMuted }}>{i.referenceTrackCount} ref track{i.referenceTrackCount === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                  {client.icps.length === 0 && (
                    <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 11 }}>no ICPs yet</div>
                  )}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ClientList({ list, clientId, onPick }: { list: ClientListRow[] | null; clientId: string | null; onPick: (id: string) => void }) {
  if (!list) return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>
  return (
    <div style={{
      width: 240, flexShrink: 0,
      border: `1px solid ${T.border}`, borderRadius: 4,
      background: T.surface, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {list.map((c) => {
        const on = c.id === clientId
        return (
          <button key={c.id} onClick={() => onPick(c.id)} style={{
            background: on ? T.accentGlow : 'transparent',
            border: 'none', borderLeft: on ? `2px solid ${T.accent}` : '2px solid transparent',
            color: on ? T.text : T.textMuted,
            padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
            fontFamily: T.sans, fontSize: 12, fontWeight: on ? 500 : 400,
            borderBottom: `1px solid ${T.borderSubtle}`,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <span>{c.companyName}</span>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>
              {c.plan} · {c.storeCount}s · {c.icpCount}i
            </span>
          </button>
        )
      })}
      {list.length === 0 && <div style={{ padding: 16, color: T.textDim, fontFamily: T.mono, fontSize: 11 }}>no clients</div>}
    </div>
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

const listRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.4fr 110px',
  gap: 10, padding: '8px 10px',
  background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
  borderRadius: 3, fontFamily: T.mono, fontSize: 11,
  alignItems: 'center',
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
