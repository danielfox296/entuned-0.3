// Comp tier panel — sits inside StoreEditor under the read-only block.
// Shows paid tier vs effective tier, lets the operator grant or revoke a
// comp, and renders the Store's tier_change_logs history.
//
// All mutations route through `applyTierChange` server-side, so each
// admin click here writes one row to tier_change_logs.

import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreCompState, TierHistoryRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Section, S, useToast } from '../../ui/index.js'

interface Props {
  storeId: string
  storeName: string
}

const TIER_LABEL: Record<string, string> = {
  free: 'Essentials (Free)',
  mvp_pilot: 'MVP Pilot',
  core: 'Core',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const SOURCE_LABEL: Record<TierHistoryRow['source'], string> = {
  admin_comp: 'comp granted',
  admin_revoke: 'comp revoked',
  stripe_webhook: 'Stripe webhook',
  pause: 'paused',
  resume: 'resumed',
  comp_expired: 'comp expired',
  auto_cleared: 'auto-cleared (paid upgrade)',
}

export function TierPanel({ storeId, storeName }: Props) {
  const [data, setData] = useState<{ store: StoreCompState; history: TierHistoryRow[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showGrant, setShowGrant] = useState(false)
  const [grantTier, setGrantTier] = useState<'core' | 'pro' | 'enterprise'>('pro')
  const [grantReason, setGrantReason] = useState('')
  const [grantExpires, setGrantExpires] = useState('')
  const [showRevoke, setShowRevoke] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const toast = useToast()

  const load = async () => {
    const token = getToken(); if (!token) return
    setErr(null)
    try {
      const r = await api.storeTierHistory(storeId, token)
      setData(r)
    } catch (e: any) {
      setErr(e.message ?? 'failed to load tier history')
    }
  }
  useEffect(() => { void load() }, [storeId])

  const grant = async () => {
    const token = getToken(); if (!token) return
    if (grantReason.trim().length < 5) { toast.error('reason must be at least 5 characters'); return }
    setBusy(true)
    try {
      await api.storeCompGrant(
        storeId,
        {
          tier: grantTier,
          reason: grantReason.trim(),
          ...(grantExpires ? { expiresAt: new Date(grantExpires).toISOString() } : {}),
        },
        token,
      )
      toast.success(`${TIER_LABEL[grantTier]} comp granted to ${storeName}`)
      setShowGrant(false); setGrantReason(''); setGrantExpires('')
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'comp grant failed')
    } finally { setBusy(false) }
  }

  const revoke = async () => {
    const token = getToken(); if (!token) return
    if (revokeReason.trim().length < 5) { toast.error('reason must be at least 5 characters'); return }
    setBusy(true)
    try {
      await api.storeCompRevoke(storeId, { reason: revokeReason.trim() }, token)
      toast.success(`comp revoked on ${storeName}`)
      setShowRevoke(false); setRevokeReason('')
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'comp revoke failed')
    } finally { setBusy(false) }
  }

  if (err) return <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>
  if (!data) return <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading tier…</div>

  const { store, history } = data
  const compActive = !!store.compTier
  const compExpired = compActive && store.compExpiresAt && new Date(store.compExpiresAt) <= new Date()

  return (
    <>
      <Section title="Tier" columns={2}>
        <div>
          <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 2 }}>Effective</div>
          <div style={{ fontSize: S.body, color: T.text, fontFamily: T.sans, fontWeight: 600 }}>
            {TIER_LABEL[store.effectiveTier] ?? store.effectiveTier}
          </div>
        </div>
        <div>
          <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 2 }}>Paid (Stripe)</div>
          <div style={{ fontSize: S.body, color: T.text, fontFamily: T.sans }}>
            {TIER_LABEL[store.paidTier] ?? store.paidTier}
          </div>
        </div>
        <div>
          <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 2 }}>Comp</div>
          <div style={{ fontSize: S.body, color: compExpired ? T.textMuted : T.text, fontFamily: T.sans }}>
            {compActive
              ? <>
                  {TIER_LABEL[store.compTier!] ?? store.compTier}
                  {compExpired
                    ? <span style={{ color: T.danger, marginLeft: 6 }}>(expired)</span>
                    : store.compExpiresAt
                      ? <span style={{ color: T.textMuted, marginLeft: 6 }}>through {fmtDate(store.compExpiresAt)}</span>
                      : <span style={{ color: T.textMuted, marginLeft: 6 }}>(open-ended)</span>}
                </>
              : <span style={{ color: T.textMuted }}>—</span>}
          </div>
        </div>
        {compActive && (store.compReason || store.compGrantedByEmail) && (
          <div style={{ gridColumn: '1 / -1', fontSize: S.label, color: T.textMuted, fontFamily: T.sans }}>
            {store.compGrantedByEmail && <>granted by <strong style={{ color: T.text }}>{store.compGrantedByEmail}</strong>{store.compGrantedAt ? ` on ${fmtDate(store.compGrantedAt)}` : ''}</>}
            {store.compReason && <> — “{store.compReason}”</>}
          </div>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 8 }}>
        {!showGrant && !showRevoke && (
          <>
            <Button onClick={() => setShowGrant(true)}>{compActive ? 'change comp' : 'grant comp'}</Button>
            {compActive && <Button variant="tiny" onClick={() => setShowRevoke(true)}>revoke comp</Button>}
          </>
        )}
      </div>

      {showGrant && (
        <Section title={compActive ? 'Change comp' : 'Grant comp'} columns={2}>
          <div>
            <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 4 }}>Tier</div>
            <select
              value={grantTier}
              onChange={(e) => setGrantTier(e.target.value as 'core' | 'pro' | 'enterprise')}
              style={{ background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}`, padding: '6px 8px', fontFamily: T.sans, fontSize: S.small, width: '100%' }}
            >
              <option value="core">Core</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 4 }}>Expires (optional)</div>
            <input
              type="date"
              value={grantExpires}
              onChange={(e) => setGrantExpires(e.target.value)}
              style={{ background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}`, padding: '6px 8px', fontFamily: T.sans, fontSize: S.small, width: '100%' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 4 }}>Reason (required, ≥5 chars)</div>
            <textarea
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              rows={2}
              placeholder="e.g. trial Pro for 60 days as part of seed-catalogue pilot"
              style={{ background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}`, padding: '6px 8px', fontFamily: T.sans, fontSize: S.small, width: '100%' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <Button onClick={grant} busy={busy} disabled={busy || grantReason.trim().length < 5}>grant</Button>
            <Button variant="tiny" onClick={() => { setShowGrant(false); setGrantReason(''); setGrantExpires('') }}>cancel</Button>
          </div>
        </Section>
      )}

      {showRevoke && (
        <Section title="Revoke comp" columns={1}>
          <div>
            <div style={{ fontSize: S.label, color: T.textMuted, fontFamily: T.sans, marginBottom: 4 }}>Reason (required, ≥5 chars)</div>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              rows={2}
              placeholder="e.g. customer churned / pilot ended / accidental grant"
              style={{ background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}`, padding: '6px 8px', fontFamily: T.sans, fontSize: S.small, width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={revoke} busy={busy} disabled={busy || revokeReason.trim().length < 5}>revoke</Button>
            <Button variant="tiny" onClick={() => { setShowRevoke(false); setRevokeReason('') }}>cancel</Button>
          </div>
        </Section>
      )}

      <Section title={`Tier history (${history.length})`}>
        {history.length === 0
          ? <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>no transitions yet</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {history.map((row) => (
                <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '120px 180px 1fr', gap: 12, fontFamily: T.sans, fontSize: S.label, padding: '4px 0', borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ color: T.textMuted }}>{fmtDateTime(row.createdAt)}</div>
                  <div style={{ color: T.text }}>
                    <span style={{ color: T.textMuted }}>{TIER_LABEL[row.fromTier] ?? row.fromTier}</span>
                    <span style={{ color: T.textMuted, margin: '0 4px' }}>→</span>
                    <strong>{TIER_LABEL[row.toTier] ?? row.toTier}</strong>
                  </div>
                  <div style={{ color: T.textMuted }}>
                    <span>{SOURCE_LABEL[row.source] ?? row.source}</span>
                    {row.actorEmail && <span> · {row.actorEmail}</span>}
                    {row.expiresAt && <span> · expires {fmtDate(row.expiresAt)}</span>}
                    {row.reason && <span> · "{row.reason}"</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
      </Section>
    </>
  )
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(s: string): string {
  const d = new Date(s)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
