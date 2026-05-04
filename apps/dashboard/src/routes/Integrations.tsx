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
        detail="On Pro you'd see hourly transactions next to your music outcomes, so you can prove the lift instead of guessing it."
      />
    </Layout>
  )
}
