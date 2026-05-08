import { useState } from 'react'
import { ExternalLink, Copy, Check, ArrowRight } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card } from '../ui/Card.js'
import { SetupChecklist } from '../ui/SetupChecklist.js'
import { api, PLAYER_URL, primaryStore, type Tier } from '../api.js'
import { useTier } from '../lib/tier.jsx'
import content from '../content/home.yaml'

// /  — authenticated home. Tier label + setup status + (free/core only) an
// upgrade card + a quick link to the player URL. No now-playing widget. Ever.
export function Home() {
  const { stores, tier, loading, onboardingGateTripped } = useTier()
  const headlineStore = primaryStore(stores)
  const playerUrl = headlineStore ? `${PLAYER_URL}/${headlineStore.slug}` : null
  // Pre-gate: free user hasn't crossed the usage threshold yet. Suppress the
  // upsell card and show a simple onboarding nudge instead. Paid tiers always
  // skip the gate.
  const preGate = tier === 'free' && !onboardingGateTripped

  return (
    <Layout>
      <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <SetupChecklist tier={tier} hasLocation={stores.length > 0} />

        {loading ? (
          <Card>
            <div style={{ color: T.textDim, fontSize: 14 }}>{content.loading}</div>
          </Card>
        ) : playerUrl ? (
          <PlayerHeroCard url={playerUrl} />
        ) : (
          <Card>
            <div style={{ color: T.textMuted, fontSize: 14 }}>
              {content.empty.pre}<strong>{content.empty.strong}</strong>{content.empty.post}
            </div>
          </Card>
        )}

        {preGate ? (
          <div style={{
            color: T.textMuted, fontSize: 14, fontFamily: T.sans,
            lineHeight: 1.55, padding: '4px 4px',
          }}>
            {content.preGateNote}
          </div>
        ) : (
          /* PLG card — placed BELOW player block per SSOT (Daniel decision 2026-05-04) */
          <UpgradeCard tier={tier} />
        )}
      </div>
    </Layout>
  )
}

function PlayerHeroCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div style={{
      background: T.surfaceRaised,
      border: `1px solid ${T.border}`,
      borderRadius: 12, padding: 24,
    }}>
      <div style={{
        fontFamily: T.heading, fontSize: 20, fontWeight: 600,
        color: T.text, letterSpacing: '-0.01em', marginBottom: 20,
      }}>
        {content.hero.headline}
      </div>

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: T.accent, color: T.bg,
          padding: '14px 24px', borderRadius: 10,
          fontFamily: T.sans, fontSize: 16, fontWeight: 700,
          textDecoration: 'none', width: '100%', boxSizing: 'border-box',
          letterSpacing: '-0.01em',
        }}
      >
        <ExternalLink size={17} strokeWidth={2.5} />
        {content.hero.open_player}
      </a>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap',
      }}>
        <div style={{
          flex: 1, minWidth: 180,
          background: T.inkDeep,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 8, padding: '8px 12px',
          fontFamily: T.mono, fontSize: 18,
          color: T.textFaint,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {url}
        </div>
        <button
          onClick={copy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textMuted, padding: '6px 12px', borderRadius: 8,
            fontFamily: T.sans, fontSize: 13, cursor: 'pointer', flexShrink: 0,
          }}
        >
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
          {copied ? content.hero.copied : content.hero.copy}
        </button>
      </div>
    </div>
  )
}

interface UpgradeCopy {
  stat?: string
  statLabel?: string
  headline: string
  body: string
  ctaLabel: string
  ctaTier: 'core' | 'pro'
}

function upgradeCopyFor(tier: Tier): UpgradeCopy | null {
  if (tier === 'free') {
    return {
      stat: content.upgrade.free.stat,
      statLabel: content.upgrade.free.stat_label,
      headline: content.upgrade.free.headline,
      body: content.upgrade.free.body,
      ctaLabel: content.upgrade.free.cta_label,
      ctaTier: 'core',
    }
  }
  if (tier === 'core') {
    return {
      headline: content.upgrade.core.headline,
      body: content.upgrade.core.body,
      ctaLabel: content.upgrade.core.cta_label,
      ctaTier: 'pro',
    }
  }
  // Pro / Enterprise: no upgrade prompt.
  return null
}

const ctaStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: T.accent, color: T.bg,
  padding: '10px 18px', borderRadius: 10,
  fontFamily: T.sans, fontSize: 14, fontWeight: 600,
  textDecoration: 'none',
}

function UpgradeCard({ tier }: { tier: Tier }) {
  const copy = upgradeCopyFor(tier)
  if (!copy) return null

  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, rgba(215,175,116,0.10) 0%, rgba(215,175,116,0.03) 100%)',
    border: `1px solid ${T.border}`,
    borderRadius: 12, padding: 24,
  }

  if (copy.stat) {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 28, alignItems: 'center' }}>
          {/* 1/3 — stat */}
          <div>
            <div style={{
              fontFamily: T.heading, fontSize: 52, fontWeight: 700,
              color: T.gold, letterSpacing: '-0.04em', lineHeight: 1,
              marginBottom: 8,
            }}>
              {copy.stat}
            </div>
            <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.45 }}>
              {copy.statLabel}
            </div>
          </div>
          {/* 2/3 — copy + CTA */}
          <div>
            <div style={{
              fontFamily: T.heading, fontSize: 16, fontWeight: 600,
              color: T.text, marginBottom: 8, letterSpacing: '-0.01em',
            }}>
              {copy.headline}
            </div>
            <div style={{
              color: T.textMuted, fontSize: 14, fontFamily: T.sans,
              lineHeight: 1.55, marginBottom: 16,
            }}>
              {copy.body}
            </div>
            <a href={api.checkoutUrl(copy.ctaTier)} style={ctaStyle}>
              {copy.ctaLabel} <ArrowRight size={14} strokeWidth={2} />
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <div style={{
        fontFamily: T.heading, fontSize: 18, fontWeight: 500,
        color: T.text, marginBottom: 8, letterSpacing: '-0.01em',
      }}>
        {copy.headline}
      </div>
      <div style={{
        color: T.textMuted, fontSize: 14, fontFamily: T.sans,
        lineHeight: 1.55, marginBottom: 16,
      }}>
        {copy.body}
      </div>
      <a href={api.checkoutUrl(copy.ctaTier)} style={ctaStyle}>
        {copy.ctaLabel} <ArrowRight size={14} strokeWidth={2} />
      </a>
    </div>
  )
}
