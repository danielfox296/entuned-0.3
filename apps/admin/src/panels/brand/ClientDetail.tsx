import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { ClientListRow, ClientFull, ClientPlan, ClientUpdate } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Select, Textarea, Section, Field, S, useToast, useClientSelection } from '../../ui/index.js'
import { useClientLogo, setClientLogo, fileToThumbnailDataUrl } from '../../ui/clientLogo.js'

const PLANS: ClientPlan[] = ['mvp_pilot', 'trial', 'paid_pilot', 'production', 'paused', 'inactive']

export function ClientDetail({ onClientsChanged, selectedClient: _summary }: {
  onClientsChanged?: () => void
  selectedClient?: ClientListRow | null
} = {}) {
  const [clientId, setClientId] = useClientSelection()
  const [client, setClient] = useState<ClientFull | null>(null)
  const [draft, setDraft] = useState<ClientUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const toast = useToast()

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
      setClientId(created.id)
      onClientsChanged?.()
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
      onClientsChanged?.()
      toast.success(`client "${updated.companyName ?? client.companyName}" saved`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save client') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: T.sans, fontSize: S.small }}>
            {client.isPlg && (
              <span style={{
                background: T.accent, color: T.bg, padding: '2px 8px',
                borderRadius: 3, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
              }}>PLG</span>
            )}
            {!client.isPlg && (
              <span style={{
                background: T.surfaceRaised, color: T.textDim, padding: '2px 8px',
                border: `1px solid ${T.borderSubtle}`,
                borderRadius: 3, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
              }}>OPERATOR-MANAGED</span>
            )}
            {client.ownerEmail && (
              <span style={{ color: T.textMuted }}>owner: {client.ownerEmail}</span>
            )}
          </div>
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

              <Section title="Logo">
                <ClientLogoField clientId={client.id} />
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

function ClientLogoField({ clientId }: { clientId: string }) {
  const logo = useClientLogo(clientId)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const dataUrl = await fileToThumbnailDataUrl(file, 256)
      setClientLogo(clientId, dataUrl)
      toast.success('logo updated')
    } catch (e: any) {
      const msg = e?.message ?? 'failed to read image'
      setErr(msg); toast.error(msg)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 80, height: 80, borderRadius: 4,
        background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        {logo
          ? <img src={logo} alt="client logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim }}>no logo</span>
        }
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => onPick(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={() => inputRef.current?.click()} busy={busy}>
            {busy ? 'processing…' : (logo ? 'replace' : 'upload')}
          </Button>
          {logo && (
            <Button variant="tiny" onClick={() => setClientLogo(clientId, null)}>remove</Button>
          )}
        </div>
        <span style={{ fontFamily: T.sans, fontSize: 12, color: T.textDim }}>
          PNG/JPG/SVG. Auto-resized to 256px square.
        </span>
        {err && <span style={{ fontFamily: T.sans, fontSize: 12, color: T.danger }}>{err}</span>}
      </div>
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
