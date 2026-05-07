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

// Preview shows the two metrics with PUBLISHED, ATTRIBUTED ranges from
// peer-reviewed retail-audio research — the same numbers that already live
// on entuned.co/for-cfos.html and how-it-works.html. We deliberately do NOT
// show fabricated single-store percentages here: this surface is what a
// CFO might screenshot, and the brand voice rule is "we don't oversell."
function ReportsPreview() {
  const metrics = [
    {
      label: 'Dwell time',
      value: '+15–25%',
      source: 'Peer-reviewed retail-audio studies (Milliman 1982 et al.)',
    },
    {
      label: 'Willingness to pay',
      value: '+8–12%',
      source: 'Areni & Kim 1993; North et al. 1999',
    },
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
            borderRadius: 10, padding: '16px 18px',
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
            <div style={{
              fontSize: 11, color: T.textDim, marginTop: 8,
              fontFamily: T.sans, lineHeight: 1.4, fontStyle: 'italic',
            }}>
              {m.source}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 14,
        fontSize: 12, color: T.textFaint, fontFamily: T.sans, lineHeight: 1.5,
      }}>
        Ranges from published research, not single-store guarantees. Your
        Reports tab will compare each fortnight against a matched-control
        period from your own data.
      </div>
    </div>
  )
}
