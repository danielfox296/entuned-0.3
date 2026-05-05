import { T } from '../tokens.js'
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
        preview={<ReportsPreview />}
      />
    </Layout>
  )
}

function ReportsPreview() {
  const metrics = [
    { label: 'Avg. dwell time',    value: '+18%', sub: 'vs. matched-control week' },
    { label: 'Avg. basket',        value: '+9%',  sub: 'vs. matched-control week' },
    { label: 'Browse → buy',       value: '+6%',  sub: 'four-week rolling' },
    { label: '4-week return rate', value: '+13%', sub: 'first-time visitors' },
  ]
  return (
    <div style={{ padding: 20 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
      }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            background: T.surfaceRaised,
            border: `1px solid ${T.borderSubtle}`,
            borderRadius: 4, padding: '16px 18px',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 500, letterSpacing: '0.12em',
              color: T.textFaint, textTransform: 'uppercase', marginBottom: 8,
            }}>
              {m.label}
            </div>
            <div style={{
              fontFamily: T.heading, fontSize: 28, fontWeight: 700,
              color: T.accent, letterSpacing: '-0.02em', lineHeight: 1,
            }}>
              {m.value}
            </div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 6 }}>
              {m.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
