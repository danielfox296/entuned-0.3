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
        emptyMessage="Reddit buying-signal scanner. Scans 10 subreddits 4×/day for posts matching retail-music keywords, drafts a reply in your voice, and queues it here for you to copy + send. Empty = next run hasn't fired yet, or no matching posts."
      />

      <QueueSection
        title="Outreach Queue"
        type="outreach"
        icon={<Send size={14} strokeWidth={1.75} />}
        defaultOpen
        showPayload
        emptyMessage="On-demand pitch drafter. POST a target (podcast / blogger / consultant) to /command-center/outreach/research and the worker drafts a personalized pitch using one of three angles. No targets fed yet."
      />

      <QueueSection
        title="Triggers"
        type="trigger"
        icon={<Zap size={14} strokeWidth={1.75} />}
        showPayload
        emptyMessage="Daily web-search for warm moments — new store openings, podcast episodes about retail audio, competitor complaints. Drafts a context-appropriate note. Needs SERPAPI_KEY set on Railway to run."
      />

      <ContentBank />

      <QueueSection
        title="SEO Drafts"
        type="seo"
        icon={<Globe size={14} strokeWidth={1.75} />}
        emptyMessage="Weekly blog-post drafter. Picks uncovered keywords from 4 SEO clusters (competitor-alternative, licensing, outcome-optimization, sensory-retail) and drafts a 1000-1400 word post each. Next run: Tuesday 7am MT."
      />

      <QueueSection
        title="Community"
        type="nurture"
        icon={<Users size={14} strokeWidth={1.75} />}
        emptyMessage="Manual activity log. Use POST /command-center/queue with type='nurture' to track community engagement (replied to a r/smallbusiness thread, etc). No automation yet."
      />

      <ProofPoints />
    </div>
  )
}
