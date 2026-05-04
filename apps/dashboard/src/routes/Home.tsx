import { useState } from 'react'
import { ExternalLink, Copy, Check, ArrowRight } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card } from '../ui/Card.js'
import { api, PLAYER_URL, TIER_LABEL, type Tier } from '../api.js'
import { useTier } from '../lib/tier.jsx'

// /  — authenticated home. Tier label + setup status + (free/core only) an
// upgrade card + a quick link to the player URL. No now-playing widget. Ever.
export function Home() {
  const { stores, tier, loading } = useTier()
  const firstStore = stores[0] ?? null
  const playerUrl = firstStore ? `${PLAYER_URL}/${firstStore.slug}` : null

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
          color: T.accentMuted, textTransform: 'uppercase', marginBottom: 4,
        }}>
          {TIER_LABEL[tier]} plan
        </div>
        <h1 style={{
          fontFamily: T.heading, fontSize: 28, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', margin: 0,
        }}>Home</h1>
      </div>

      <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        {/* Setup status */}
        <Card>
          {loading ? (
            <div style={{ color: T.textDim, fontSize: 14 }}>Loading…</div>
          ) : firstStore && playerUrl ? (
            <div>
              <div style={{ color: T.textMuted, fontSize: 14, marginBottom: 10 }}>
                Your player is ready.
              </div>
              <PlayerLinkRow url={playerUrl} />
            </div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: 14 }}>
              Add your first location from the <strong>Locations</strong> tab to get started.
            </div>
          )}
        </Card>

        {/* PLG card — placed BELOW setup line per SSOT (Daniel decision 2026-05-04) */}
        <UpgradeCard tier={tier} />
      </div>
    </Layout>
  )
}

function PlayerLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{
        flex: 1, minWidth: 240,
        background: T.inkDeep,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 4, padding: '8px 12px',
        fontFamily: T.mono, fontSize: 13,
        color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {url}
      </div>
      <button
        onClick={copy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: `1px solid ${T.border}`,
          color: T.textMuted, padding: '7px 12px', borderRadius: 3,
          fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
        }}
      >
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: T.accent, color: T.bg,
          padding: '8px 12px', borderRadius: 3,
          fontFamily: T.sans, fontSize: 13, fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        <ExternalLink size={13} strokeWidth={2} /> Open
      </a>
    </div>
  )
}

interface UpgradeCopy {
  headline: string
  body: string
  ctaLabel: string
  ctaTier: 'core' | 'pro'
}

function upgradeCopyFor(tier: Tier): UpgradeCopy | null {
  if (tier === 'free') {
    return {
      headline: 'Music tailored to your specific customer.',
      body: 'On Core, your library is built around your audience — not the average shopper. $99 per location, per month.',
      ctaLabel: 'Upgrade to Core',
      ctaTier: 'core',
    }
  }
  if (tier === 'core') {
    return {
      headline: 'Tie what you play to what you sell.',
      body: 'On Pro, schedule outcome rotation through the day and connect Square, Shopify, or Lightspeed. $399 per location, per month.',
      ctaLabel: 'Upgrade to Pro',
      ctaTier: 'pro',
    }
  }
  // Pro / Enterprise: no upgrade prompt.
  return null
}

function UpgradeCard({ tier }: { tier: Tier }) {
  const copy = upgradeCopyFor(tier)
  if (!copy) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(215,175,116,0.10) 0%, rgba(215,175,116,0.03) 100%)',
      border: `1px solid ${T.border}`,
      borderRadius: 6, padding: 24,
    }}>
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
      <a
        href={api.checkoutUrl(copy.ctaTier)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: T.accent, color: T.bg,
          padding: '10px 18px', borderRadius: 4,
          fontFamily: T.sans, fontSize: 14, fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {copy.ctaLabel} <ArrowRight size={14} strokeWidth={2} />
      </a>
    </div>
  )
}
