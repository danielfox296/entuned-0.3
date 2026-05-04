import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'
import { Button } from '../ui/index.js'
import { useAuth } from '../lib/auth.jsx'

// /account — billing portal link, indemnification cert download, locations summary.
// All actions stubbed; wire to server endpoints in a follow-up phase.
export function Account() {
  const { user, account, role } = useAuth()

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: T.heading, fontSize: 24, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em',
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
            <span style={{ color: T.text }}>{account?.plan ?? '—'}</span>
            <span style={{ color: T.textDim }}>Role</span>
            <span style={{ color: T.text }}>{role ?? '—'}</span>
          </div>
        </Card>

        <Card title="Billing">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ color: T.textMuted, fontSize: 14 }}>
              Manage subscription, payment method, and invoices in Stripe.
            </div>
            <Button variant="ghost">Open billing portal</Button>
          </div>
        </Card>

        <Card title="Indemnification certificate">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ color: T.textMuted, fontSize: 14 }}>
              Proof of music-licence indemnification, ready to forward to your landlord or franchisor.
            </div>
            <Button variant="ghost">Download PDF</Button>
          </div>
        </Card>

        <Card title="Locations">
          <EmptyState>
            You have no locations yet. Add one from the <strong>Locations</strong> tab.
          </EmptyState>
        </Card>
      </div>
    </Layout>
  )
}
