import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { useTier } from '../lib/tier.jsx'

// /integrations — Pro+ in v2. Always LockScreen for now.
export function Integrations() {
  const { tier } = useTier()
  return (
    <Layout>
      <LockScreen
        tabName="Integrations"
        valueLine="Connect Square, Shopify, or Lightspeed. Tie what's playing to what's selling."
        requiredTier="pro"
        currentTier={tier}
        timeToValue="POS data flows in within a day of connecting. Music–sales overlay shows up that night."
        detail="On Pro you'd see hourly transactions next to your music outcomes, so you can prove the lift instead of guessing it."
        preview={<IntegrationsPreview />}
      />
    </Layout>
  )
}

function IntegrationsPreview() {
  const integrations = [
    { name: 'Square',     status: 'Connected · syncing',   color: T.accent },
    { name: 'Shopify',    status: 'Available',             color: T.textDim },
    { name: 'Lightspeed', status: 'Available',             color: T.textDim },
    { name: 'Toast',      status: 'Coming soon',           color: T.textFaint },
  ]
  return (
    <div style={{ padding: 20, display: 'grid', gap: 10 }}>
      {integrations.map((i) => (
        <div key={i.name} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px',
          background: T.surfaceRaised,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 4,
        }}>
          <div style={{
            fontSize: 14, color: T.text, fontWeight: 500, fontFamily: T.heading,
            letterSpacing: '-0.01em',
          }}>{i.name}</div>
          <div style={{ fontSize: 12, color: i.color, fontFamily: T.sans }}>
            {i.status}
          </div>
        </div>
      ))}
    </div>
  )
}
