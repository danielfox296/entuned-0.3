import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'

// /reports — locked for ALL tiers in v1 per Daniel decision 2026-05-04.
// The tab functions as a roadmap teaser. No upgrade CTA. Single shared copy.
export function Reports() {
  return (
    <Layout>
      <LockScreen
        tabName="Reports"
        valueLine="Lift in your existing CFO report."
        requiredTier="roadmap"
      />
    </Layout>
  )
}
