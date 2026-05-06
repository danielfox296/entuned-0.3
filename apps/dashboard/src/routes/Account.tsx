import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'
import { Button } from '../ui/index.js'
import { api, TIER_LABEL, TIER_RANK, PLAYER_URL } from '../api.js'
import { useAuth } from '../lib/auth.jsx'
import { useTier } from '../lib/tier.jsx'

// /account — profile, billing portal, indemnification cert, sign-out.
// Profile fields are read-only in v1; rename ships in v1.5.
//
// Note on PRO indemnification: PRO = Performance Rights Organization
// (ASCAP/BMI/SESAC) — the music-licensing umbrella. NOT the Pro tier.
// Every Entuned plan, including free Essentials, ships indemnified from
// day one — the cert card is shown to every signed-in user.
export function Account() {
  const { user, account } = useAuth()
  const { stores, tier } = useTier()
  const isPaid = TIER_RANK[tier] >= TIER_RANK.core

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: T.heading, fontSize: 28, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', margin: 0,
        }}>Account</h1>
      </div>

      <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <Card title="Profile">
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 8, fontSize: 14 }}>
            <span style={{ color: T.textDim }}>Email</span>
            <span style={{ color: T.text }}>{user?.email ?? '—'}</span>
            <span style={{ color: T.textDim }}>Company</span>
            <span style={{ color: T.text }}>{account?.companyName ?? '—'}</span>
            <span style={{ color: T.textDim }}>Plan</span>
            <span style={{ color: T.text }}>{TIER_LABEL[tier]}</span>
          </div>
        </Card>

        <Card title="Billing">
          {isPaid ? (
            <BillingPortalRow />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 16,
            }}>
              <div style={{ color: T.textMuted, fontSize: 14 }}>
                You're on the free Essentials plan. Unlock Core for music
                tuned to your specific customer, plus pause / resume and a
                billing portal.
              </div>
              <a href={api.checkoutUrl('core')} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: T.accent, color: T.bg,
                padding: '8px 14px', borderRadius: 3,
                fontFamily: T.sans, fontSize: 14, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}>Unlock Core</a>
            </div>
          )}
        </Card>

        <Card title="PRO licensing certificate">
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 16,
          }}>
            <div style={{ color: T.textMuted, fontSize: 14, lineHeight: 1.5 }}>
              Proof of music-rights licensing (ASCAP / BMI / SESAC), ready
              to forward to your landlord or franchisor. Every Entuned plan
              is covered from day one.
            </div>
            <Button variant="ghost" disabled title="We'll email it to you when ready.">
              Download PDF
            </Button>
          </div>
        </Card>

        <Card title="Locations">
          {stores.length === 0 ? (
            <EmptyState>
              You have no locations yet. Add one from the <strong>Locations</strong> tab.
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
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                    color: T.accentMuted, textTransform: 'uppercase',
                    border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 6px',
                  }}>{TIER_LABEL[s.tier] ?? s.tier}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Layout>
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
      alert(`Couldn't open billing portal: ${e?.message ?? 'unknown error'}`)
      setBusy(false)
    }
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 16,
    }}>
      <div style={{ color: T.textMuted, fontSize: 14 }}>
        Manage subscription, payment method, and invoices in Stripe.
      </div>
      <Button variant="ghost" onClick={open} busy={busy}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ExternalLink size={13} strokeWidth={2} /> Open billing portal
        </span>
      </Button>
    </div>
  )
}
