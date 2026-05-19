// Morning Command Center — top-of-sidebar panel in Dash.
//
// Single scrollable page with collapsible sections, top-to-bottom morning
// ritual flow. Aggregates outputs from 8 agentic subsystems into one view.
// Daniel opens this once per morning, spends 15-30 minutes acting on what
// it surfaces, and closes it.
//
// Spec: ../../../../../morning-command-center-spec.md

import { Radar, Send, Zap, Globe, Users } from 'lucide-react'
import { T } from '@entuned/tokens'
import { Scoreboard } from './Scoreboard.js'
import { QueueSection } from './QueueSection.js'
import { ContentBank } from './ContentBank.js'
import { ProofPoints } from './ProofPoints.js'

export function CommandCenter() {
  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
  return (
    <div style={{ padding: 28, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <h1 style={{
          fontSize: 22, fontFamily: T.heading, fontWeight: 700,
          color: T.text, margin: 0, letterSpacing: '-0.02em',
        }}>Command Center</h1>
        <span style={{ fontSize: 13, color: T.textDim, fontFamily: T.sans }}>{today}</span>
      </div>

      <Scoreboard />

      <QueueSection
        title="Signals"
        type="signal"
        icon={<Radar size={14} strokeWidth={1.75} />}
        defaultOpen
        showPayload
        emptyMessage="The signal scanner hasn't run yet, or no Reddit posts matched. Workers run every 4h."
      />

      <QueueSection
        title="Outreach Queue"
        type="outreach"
        icon={<Send size={14} strokeWidth={1.75} />}
        defaultOpen
        showPayload
        emptyMessage="No outreach targets in flight. Feed targets via POST /command-center/outreach/research."
      />

      <QueueSection
        title="Triggers"
        type="trigger"
        icon={<Zap size={14} strokeWidth={1.75} />}
        showPayload
        emptyMessage="No trigger events today. Worker runs daily at 7am MT."
      />

      <ContentBank />

      <QueueSection
        title="SEO Drafts"
        type="seo"
        icon={<Globe size={14} strokeWidth={1.75} />}
        emptyMessage="No SEO blog drafts pending. Worker runs Tuesdays."
      />

      <QueueSection
        title="Community"
        type="nurture"
        icon={<Users size={14} strokeWidth={1.75} />}
        emptyMessage="Browse today: r/smallbusiness, r/boutique. Log your activity in the nurture queue."
      />

      <ProofPoints />
    </div>
  )
}
