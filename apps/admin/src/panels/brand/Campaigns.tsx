import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { CampaignRow, AdAssetRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Section, Field, S, useToast, useStoreSelection, ConfirmDelete } from '../../ui/index.js'

function campaignStatus(c: CampaignRow): 'active' | 'upcoming' | 'ended' {
  const now = Date.now()
  const start = new Date(c.startsAt).getTime()
  const end = new Date(c.endsAt).getTime()
  if (now >= start && now < end) return 'active'
  if (now < start) return 'upcoming'
  return 'ended'
}

const STATUS_COLOR: Record<string, string> = {
  active: T.success,
  upcoming: T.warn,
  ended: T.textDim,
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 11, fontFamily: T.sans, fontWeight: 600,
      color: STATUS_COLOR[status] ?? T.textDim,
      background: `${STATUS_COLOR[status] ?? T.textDim}22`,
      padding: '2px 8px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{status}</span>
  )
}

function fmtDatetimeLocal(iso: string): string {
  return iso.slice(0, 16) // YYYY-MM-DDTHH:MM
}

function toIso(local: string): string {
  return local ? new Date(local).toISOString() : ''
}

export function Campaigns() {
  const [storeId] = useStoreSelection()
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const reload = async () => {
    if (!storeId) { setCampaigns([]); return }
    const token = getToken(); if (!token) return
    try {
      const cs = await api.campaigns(storeId, token)
      setCampaigns(cs)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { void reload() }, [storeId])

  if (!storeId) {
    return <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>Select a location to manage campaigns.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => setCreating(true)} disabled={creating}>+ new campaign</Button>
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {creating && (
        <CreateCampaignForm
          storeId={storeId}
          onCreated={(c) => { setCampaigns((prev) => [...(prev ?? []), c]); setCreating(false); setExpanded(c.id) }}
          onCancel={() => setCreating(false)}
        />
      )}

      {campaigns === null && (
        <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>
      )}

      {campaigns && campaigns.length === 0 && !creating && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>No campaigns yet for this location.</div>
      )}

      {campaigns && campaigns.map((c) => (
        <CampaignCard
          key={c.id}
          campaign={c}
          expanded={expanded === c.id}
          onToggle={() => setExpanded((prev) => prev === c.id ? null : c.id)}
          onUpdated={(updated) => setCampaigns((prev) => prev ? prev.map((x) => x.id === updated.id ? updated : x) : prev)}
          onDeleted={() => { setCampaigns((prev) => prev ? prev.filter((x) => x.id !== c.id) : prev); if (expanded === c.id) setExpanded(null) }}
          busy={busy}
          setBusy={setBusy}
        />
      ))}
    </div>
  )
}

function CreateCampaignForm({ storeId, onCreated, onCancel }: {
  storeId: string
  onCreated: (c: CampaignRow) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [songsPerAd, setSongsPerAd] = useState(3)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()

  const valid = name.trim() && startsAt && endsAt && songsPerAd >= 1

  const submit = async () => {
    if (!valid) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const c = await api.createCampaign(storeId, {
        name: name.trim(),
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        songsPerAd,
      }, token)
      toast.success(`Campaign "${c.name}" created`)
      onCreated(c)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed') }
    finally { setBusy(false) }
  }

  return (
    <Section title="New campaign" columns={2}>
      <Field label="name" full>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring Sale 2026" />
      </Field>
      <Field label="start">
        <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </Field>
      <Field label="end">
        <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </Field>
      <Field label="songs before each ad">
        <Input
          type="number" min={1} value={String(songsPerAd)}
          onChange={(e) => setSongsPerAd(Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
      </Field>
      {err && <div style={{ gridColumn: '1 / -1', fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <Button onClick={submit} disabled={!valid} busy={busy}>{busy ? 'creating…' : 'create campaign'}</Button>
        <Button variant="tiny" onClick={onCancel}>cancel</Button>
      </div>
    </Section>
  )
}

function CampaignCard({ campaign, expanded, onToggle, onUpdated, onDeleted, busy, setBusy }: {
  campaign: CampaignRow
  expanded: boolean
  onToggle: () => void
  onUpdated: (c: CampaignRow) => void
  onDeleted: () => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const status = campaignStatus(campaign)
  const toast = useToast()

  const handleDelete = async () => {
    const token = getToken(); if (!token) return
    setBusy(true)
    try {
      await api.deleteCampaign(campaign.id, token)
      toast.success(`Campaign "${campaign.name}" deleted`)
      onDeleted()
    } catch (e: any) { toast.error(e.message ?? 'delete failed') }
    finally { setBusy(false) }
  }

  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.border}`,
      borderRadius: 6, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${T.borderSubtle}` : 'none',
        }}
      >
        <span style={{ fontSize: 15, fontFamily: T.sans, fontWeight: 500, color: T.text, flex: 1 }}>
          {campaign.name}
        </span>
        <StatusPill status={status} />
        <span style={{ fontSize: 12, fontFamily: T.sans, color: T.textDim }}>
          {campaign.adAssets.length} asset{campaign.adAssets.length !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 12, fontFamily: T.sans, color: T.textDim }}>
          every {campaign.songsPerAd} song{campaign.songsPerAd !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 16, color: T.textDim, userSelect: 'none' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: S.xl }}>
          <CampaignEditFields campaign={campaign} onUpdated={onUpdated} />
          <AdAssetList campaign={campaign} onUpdated={onUpdated} />
          <div style={{ borderTop: `1px solid ${T.borderSubtle}`, paddingTop: S.md }}>
            <ConfirmDelete
              label="delete campaign"
              entity={campaign.name}
              busy={busy}
              onConfirm={handleDelete}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function CampaignEditFields({ campaign, onUpdated }: { campaign: CampaignRow; onUpdated: (c: CampaignRow) => void }) {
  const [name, setName] = useState(campaign.name)
  const [startsAt, setStartsAt] = useState(fmtDatetimeLocal(campaign.startsAt))
  const [endsAt, setEndsAt] = useState(fmtDatetimeLocal(campaign.endsAt))
  const [songsPerAd, setSongsPerAd] = useState(campaign.songsPerAd)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const dirty = name !== campaign.name
    || toIso(startsAt) !== campaign.startsAt.slice(0, 16) + ':00.000Z'
    || toIso(endsAt) !== campaign.endsAt.slice(0, 16) + ':00.000Z'
    || songsPerAd !== campaign.songsPerAd

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true)
    try {
      const updated = await api.updateCampaign(campaign.id, {
        name: name.trim(),
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        songsPerAd,
      }, token)
      toast.success('Campaign saved')
      onUpdated(updated)
    } catch (e: any) { toast.error(e.message ?? 'save failed') }
    finally { setBusy(false) }
  }

  return (
    <Section title="Settings" columns={2}>
      <Field label="name" full>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="start">
        <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </Field>
      <Field label="end">
        <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </Field>
      <Field label="songs before each ad">
        <Input
          type="number" min={1} value={String(songsPerAd)}
          onChange={(e) => setSongsPerAd(Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
      </Field>
      <div style={{ gridColumn: '1 / -1' }}>
        <Button onClick={save} disabled={!dirty} busy={busy}>
          {busy ? 'saving…' : dirty ? 'save changes' : 'no changes'}
        </Button>
      </div>
    </Section>
  )
}

function AdAssetList({ campaign, onUpdated }: { campaign: CampaignRow; onUpdated: (c: CampaignRow) => void }) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const toast = useToast()

  const addAsset = async () => {
    if (!sourceUrl.trim()) return
    const token = getToken(); if (!token) return
    setAdding(true)
    try {
      await api.addAdAsset(campaign.id, { sourceUrl: sourceUrl.trim(), label: label.trim() || undefined }, token)
      toast.success('Asset added')
      setSourceUrl(''); setLabel('')
      const token2 = getToken()!
      const updated = await api.campaigns(campaign.storeId, token2)
      const fresh = updated.find((c) => c.id === campaign.id)
      if (fresh) onUpdated(fresh)
    } catch (e: any) { toast.error(e.message ?? 'upload failed') }
    finally { setAdding(false) }
  }

  const deleteAsset = async (asset: AdAssetRow) => {
    const token = getToken(); if (!token) return
    setBusyId(asset.id)
    try {
      await api.deleteAdAsset(asset.id, token)
      toast.success('Asset removed')
      const token2 = getToken()!
      const updated = await api.campaigns(campaign.storeId, token2)
      const fresh = updated.find((c) => c.id === campaign.id)
      if (fresh) onUpdated(fresh)
    } catch (e: any) { toast.error(e.message ?? 'delete failed') }
    finally { setBusyId(null) }
  }

  const move = async (asset: AdAssetRow, direction: 'up' | 'down') => {
    const token = getToken(); if (!token) return
    setBusyId(asset.id)
    try {
      await api.moveAdAsset(asset.id, direction, token)
      const token2 = getToken()!
      const updated = await api.campaigns(campaign.storeId, token2)
      const fresh = updated.find((c) => c.id === campaign.id)
      if (fresh) onUpdated(fresh)
    } catch (e: any) { toast.error(e.message ?? 'move failed') }
    finally { setBusyId(null) }
  }

  const assets = [...campaign.adAssets].sort((a, b) => a.position - b.position)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
      <div style={{ fontSize: 13, fontFamily: T.sans, fontWeight: 500, color: T.textMuted, marginBottom: 4 }}>
        Ad Assets — round-robin order ({assets.length} / 8 recommended)
      </div>

      {assets.length === 0 && (
        <div style={{ fontSize: S.small, color: T.textDim, fontFamily: T.sans }}>No assets yet. Add one below.</div>
      )}

      {assets.map((asset, idx) => (
        <div key={asset.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: T.surface, borderRadius: 4, padding: '10px 12px',
          border: `1px solid ${T.borderSubtle}`,
        }}>
          <span style={{ fontSize: 13, fontFamily: T.sans, color: T.textDim, width: 20, textAlign: 'right', flexShrink: 0 }}>
            {idx + 1}
          </span>
          <span style={{ flex: 1, fontSize: 13, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.label || `Asset ${idx + 1}`}
          </span>
          {asset.byteSize && (
            <span style={{ fontSize: 11, fontFamily: T.sans, color: T.textDim }}>
              {(asset.byteSize / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
          <button
            onClick={() => move(asset, 'up')}
            disabled={idx === 0 || busyId === asset.id}
            title="Move up"
            style={iconBtnStyle(idx === 0)}
          >↑</button>
          <button
            onClick={() => move(asset, 'down')}
            disabled={idx === assets.length - 1 || busyId === asset.id}
            title="Move down"
            style={iconBtnStyle(idx === assets.length - 1)}
          >↓</button>
          <button
            onClick={() => deleteAsset(asset)}
            disabled={busyId === asset.id}
            title="Remove"
            style={{ ...iconBtnStyle(false), color: T.danger }}
          >✕</button>
        </div>
      ))}

      {/* Add asset form */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        background: T.surface, borderRadius: 4, padding: '12px 14px',
        border: `1px dashed ${T.borderSubtle}`,
        marginTop: 4,
      }}>
        <div style={{ fontSize: 12, fontFamily: T.sans, color: T.textDim, marginBottom: 2 }}>Add asset via URL</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://cdn1.suno.ai/… or direct .mp3 URL"
            style={{ flex: 2, minWidth: 200 }}
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (optional)"
            style={{ flex: 1, minWidth: 120 }}
          />
          <Button onClick={addAsset} disabled={!sourceUrl.trim()} busy={adding}>
            {adding ? 'uploading…' : 'add'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function iconBtnStyle(disabled: boolean): CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    color: disabled ? T.textDim : T.textMuted,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 14,
    padding: '2px 6px',
    opacity: disabled ? 0.3 : 1,
    lineHeight: 1,
  }
}
