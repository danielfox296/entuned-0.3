import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { useTier } from '../lib/tier.jsx'

// /schedule — Pro+ in v2. Always renders LockScreen until v2 lands; the route
// exists in v1 so the sidebar tab is real and bookmarkable.
export function Schedule() {
  const { tier } = useTier()
  return (
    <Layout>
      <LockScreen
        tabName="Schedule"
        valueLine="Time-of-day outcome rotation. Music shifts as your customer mix changes through the day."
        requiredTier="pro"
        currentTier={tier}
        detail="On Pro you'd schedule Increase Dwell for the morning lull and Infuse Energy for Saturday afternoon — automatically, with one rule."
      />
    </Layout>
  )
}
