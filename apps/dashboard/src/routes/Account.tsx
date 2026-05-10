import { useState } from 'react'
import { Download, ExternalLink, Lock, LogOut, Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'
import { Button, Input } from '../ui/index.js'
import { api, TIER_LABEL, TIER_RANK, PLAYER_URL, type MeAccount, type Tier } from '../api.js'
import { useAuth } from '../lib/auth.jsx'
import { useTier } from '../lib/tier.jsx'
import content from '../content/account.yaml'

// /account — profile, billing portal, indemnification cert, sign-out.
// Profile fields are read-only in v1; rename ships in v1.5.
//
// Note on PRO indemnification: PRO = Performance Rights Organization
// (ASCAP/BMI/SESAC) — the music-licensing umbrella. NOT the Pro tier.
// Every Entuned plan, including Entuned Free, ships indemnified from
// day one — the cert card is shown to every signed-in user.
export function Account() {
  const { user, account, refresh: refreshAuth } = useAuth()
  const { stores, tier } = useTier()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try { await api.logout() } catch { /* ignore — clearing client state is enough */ }
    navigate('/start', { replace: true })
  }
  const isPaid = TIER_RANK[tier] >= TIER_RANK.core
  const hasStripeSubscription = stores.some((s) => s.subscription !== null)

  // A comp is active on this account if any Store carries one — typically
  // surfaced as "we comped you up to Pro through <date>" copy. This is not
  // promotional; it's transparency about why their effective tier outranks
  // their paid plan.
  const compedStores = stores.filter((s) => s.compTier !== null)
  const hasComp = compedStores.length > 0

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: T.heading, fontSize: 28, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', margin: 0,
        }}>{content.heading}</h1>
      </div>

      <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <ProfileCard
          email={user?.email ?? null}
          account={account}
          tier={tier}
          tierExtra={hasComp ? (() => {
            const earliest = compedStores
              .map((s) => s.compExpiresAt)
              .filter((d): d is string => !!d)
              .sort()[0]
            if (earliest) return `${content.profile.comped_through_prefix}${fmtDate(earliest)}${content.profile.comped_through_suffix}`
            return content.profile.comped_open_ended
          })() : null}
          onSaved={refreshAuth}
        />

        <Card title={content.billing.title}>
          {isPaid && hasStripeSubscription ? (
            <BillingPortalRow />
          ) : isPaid && hasComp ? (
            <div style={{ color: T.textMuted, fontSize: 14 }}>
              {content.billing.comped_body}
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 16,
            }}>
              <div style={{ color: T.textMuted, fontSize: 14 }}>
                {content.billing.free_body}
              </div>
              <a href="/upgrade" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: T.accent, color: T.bg,
                padding: '8px 14px', borderRadius: 8,
                fontFamily: T.sans, fontSize: 14, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}>{content.billing.free_cta}</a>
            </div>
          )}
        </Card>

        <Card title={content.cert.title}>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 16,
          }}>
            <div style={{ color: T.textMuted, fontSize: 14, lineHeight: 1.5 }}>
              {content.cert.body}
            </div>
            <a
              href="/pro-indemnification-certificate.pdf"
              download
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent',
                border: `1px solid ${T.border}`,
                color: T.textMuted,
                padding: '8px 14px',
                borderRadius: 8,
                fontFamily: T.sans, fontSize: 14,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              <Download size={13} strokeWidth={2} /> {content.cert.cta}
            </a>
          </div>
        </Card>

        <Card title={content.session.title}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ fontSize: 14, color: T.textMuted }}>
              {content.session.signed_in_as}<span style={{ color: T.text }}>{user?.email}</span>
            </div>
            <button
              onClick={handleLogout}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'transparent',
                border: `1px solid ${T.border}`,
                borderRadius: 8, padding: '7px 14px',
                color: T.textMuted, fontFamily: T.sans, fontSize: 13,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <LogOut size={13} strokeWidth={1.75} /> {content.session.sign_out}
            </button>
          </div>
        </Card>

        <Card title={content.locations.title}>
          {stores.length === 0 ? (
            <EmptyState>
              {content.locations.empty_pre}<strong>{content.locations.empty_strong}</strong>{content.locations.empty_post}
            </EmptyState>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {stores.map((s) => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12,
                  padding: '8px 0',
                  borderBottom: `1px solid ${T.borderSubtle}`,
                }}>
                  <div>
                    <div style={{ color: T.text, fontSize: 14 }}>{s.name}</div>
                    <div style={{ color: T.textFaint, fontSize: 12, fontFamily: T.mono }}>
                      {PLAYER_URL}/{s.slug}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                      color: T.accentMuted, textTransform: 'uppercase',
                      border: `1px solid ${T.border}`, borderRadius: 8, padding: '1px 6px',
                    }}>{TIER_LABEL[s.tier] ?? s.tier}</span>
                    {s.compTier && (
                      <span style={{ color: T.textFaint, fontSize: 10 }}>
                        {content.locations.comped_from_prefix}{TIER_LABEL[s.paidTier] ?? s.paidTier}
                        {s.compExpiresAt ? `${content.locations.comped_until_prefix}${fmtDate(s.compExpiresAt)}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Layout>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Editable Profile card. Read-mode: labelled rows + Edit button. Edit-mode:
// the same rows become Inputs with Save / Cancel. Email is locked — it's
// the auth identity and changing it requires re-verification (separate flow).
function ProfileCard({ email, account, tier, tierExtra, onSaved }: {
  email: string | null
  account: MeAccount | null
  tier: Tier
  tierExtra: string | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    companyName: account?.companyName ?? '',
    contactName: account?.contactName ?? '',
    contactEmail: account?.contactEmail ?? '',
    contactPhone: account?.contactPhone ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enterEdit = () => {
    setDraft({
      companyName: account?.companyName ?? '',
      contactName: account?.contactName ?? '',
      contactEmail: account?.contactEmail ?? '',
      contactPhone: account?.contactPhone ?? '',
    })
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    if (busy) return
    const companyName = draft.companyName.trim()
    if (!companyName) { setError(content.profile.company_required); return }
    const contactEmail = draft.contactEmail.trim()
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setError(content.profile.contact_email_invalid); return
    }
    setBusy(true); setError(null)
    try {
      await api.updateProfile({
        companyName,
        contactName: draft.contactName.trim() || null,
        contactEmail: contactEmail || null,
        contactPhone: draft.contactPhone.trim() || null,
      })
      onSaved()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : content.profile.save_failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={content.profile.title}>
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, fontSize: 14, alignItems: 'center' }}>
        {/* Email — always read-only with a lock hint */}
        <span style={{ color: T.textDim }}>{content.profile.email_label}</span>
        <span style={{ color: T.text, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {email ?? content.profile.empty_value}
          <span title={content.profile.email_lock_hint} style={{ color: T.textFaint, display: 'inline-flex' }}>
            <Lock size={11} strokeWidth={2} />
          </span>
        </span>

        <span style={{ color: T.textDim }}>{content.profile.company_label}</span>
        {editing ? (
          <Input value={draft.companyName} onChange={(e) => setDraft((d) => ({ ...d, companyName: e.target.value }))} disabled={busy} />
        ) : (
          <span style={{ color: T.text }}>{account?.companyName || content.profile.empty_value}</span>
        )}

        <span style={{ color: T.textDim }}>{content.profile.contact_name_label}</span>
        {editing ? (
          <Input value={draft.contactName} onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value }))} disabled={busy} />
        ) : (
          <span style={{ color: T.text }}>{account?.contactName || content.profile.empty_value}</span>
        )}

        <span style={{ color: T.textDim }}>{content.profile.contact_email_label}</span>
        {editing ? (
          <Input type="email" value={draft.contactEmail} onChange={(e) => setDraft((d) => ({ ...d, contactEmail: e.target.value }))} disabled={busy} />
        ) : (
          <span style={{ color: T.text }}>{account?.contactEmail || content.profile.empty_value}</span>
        )}

        <span style={{ color: T.textDim }}>{content.profile.contact_phone_label}</span>
        {editing ? (
          <Input value={draft.contactPhone} onChange={(e) => setDraft((d) => ({ ...d, contactPhone: e.target.value }))} disabled={busy} />
        ) : (
          <span style={{ color: T.text }}>{account?.contactPhone || content.profile.empty_value}</span>
        )}

        <span style={{ color: T.textDim }}>{content.profile.plan_label}</span>
        <span style={{ color: T.text }}>
          {TIER_LABEL[tier]}
          {tierExtra && <span style={{ color: T.accentMuted, marginLeft: 8, fontSize: 12 }}>{tierExtra}</span>}
        </span>
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 13, color: T.danger }}>{error}</div>
      )}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {editing ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              {content.profile.cancel}
            </Button>
            <Button onClick={save} busy={busy}>
              {busy ? content.profile.saving : content.profile.save}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={enterEdit}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Pencil size={12} strokeWidth={2} /> {content.profile.edit}
            </span>
          </Button>
        )}
      </div>
    </Card>
  )
}

function BillingPortalRow() {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { url } = await api.billingPortal()
      window.location.href = url
    } catch (e: any) {
      alert(`${content.billing.portal_error_prefix}${e?.message ?? content.billing.portal_error_unknown}`)
      setBusy(false)
    }
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 16,
    }}>
      <div style={{ color: T.textMuted, fontSize: 14 }}>
        {content.billing.portal_body}
      </div>
      <Button variant="ghost" onClick={open} busy={busy}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ExternalLink size={13} strokeWidth={2} /> {content.billing.portal_cta}
        </span>
      </Button>
    </div>
  )
}
