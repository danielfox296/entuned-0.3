import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { useTier } from '../lib/tier.jsx'
import content from '../content/integrations.yaml'

// /integrations — Pro+ in v2. Always LockScreen for now.
export function Integrations() {
  const { tier } = useTier()
  return (
    <Layout>
      <LockScreen
        tabName={content.lock.tab_name}
        valueLine={content.lock.value_line}
        requiredTier="pro"
        currentTier={tier}
        timeToValue={content.lock.time_to_value}
        detail={content.lock.detail}
        preview={<IntegrationsPreview />}
      />
    </Layout>
  )
}

function IntegrationsPreview() {
  const integrations = [
    { name: content.preview.square_name,     status: content.preview.square_status,     color: T.accent },
    { name: content.preview.shopify_name,    status: content.preview.shopify_status,    color: T.textDim },
    { name: content.preview.lightspeed_name, status: content.preview.lightspeed_status, color: T.textDim },
    { name: content.preview.toast_name,      status: content.preview.toast_status,      color: T.textFaint },
  ]
  return (
    <div style={{ padding: 20, display: 'grid', gap: 10 }}>
      {integrations.map((i) => (
        <div key={i.name} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px',
          background: T.surfaceRaised,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 10,
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
