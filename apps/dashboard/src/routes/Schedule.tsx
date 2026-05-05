import { T } from '../tokens.js'
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
        timeToValue="Schedule rules apply on the next playback rotation — usually within an hour."
        detail="On Pro you'd schedule Increase Dwell for the morning lull and Infuse Energy for Saturday afternoon — automatically, with one rule."
        preview={<SchedulePreview />}
      />
    </Layout>
  )
}

// Faked operator view — what Schedule looks like once unlocked. Static rows;
// no backing data. Rendered inside LockScreen's preview slot, dimmed.
function SchedulePreview() {
  const rows = [
    { label: 'Weekday mornings', when: 'Mon–Fri · 9:00–11:00 AM', outcome: 'Increase Dwell', color: T.accent },
    { label: 'Lunch rush',       when: 'Mon–Fri · 12:00–2:00 PM', outcome: 'Infuse Energy',  color: T.slate },
    { label: 'Saturday floor',   when: 'Sat · 11:00 AM–4:00 PM',  outcome: 'Infuse Energy',  color: T.slate },
    { label: 'Sunday wind-down', when: 'Sun · 3:00–6:00 PM',      outcome: 'Increase Dwell', color: T.accent },
  ]
  return (
    <div style={{ padding: 20 }}>
      {rows.map((r) => (
        <div key={r.label} style={{
          display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr',
          alignItems: 'center', gap: 16,
          padding: '14px 16px',
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}>
          <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{r.label}</div>
          <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.sans }}>{r.when}</div>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
            color: r.color, textTransform: 'uppercase',
            border: `1px solid ${r.color}`, padding: '3px 8px', borderRadius: 3,
            justifySelf: 'start',
          }}>
            {r.outcome}
          </div>
        </div>
      ))}
    </div>
  )
}
