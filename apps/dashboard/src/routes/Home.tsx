import { useState, useEffect } from 'react'
import { ExternalLink, Copy, Check, ArrowRight } from 'lucide-react'
import { trackUpgradeCtaClick } from '../lib/ga4.js'
import { T } from '@entuned/tokens'
import { Layout } from '../ui/Layout.js'
import { Card } from '../ui/Card.js'
import { SetupChecklist } from '../ui/SetupChecklist.js'
import { api, PLAYER_URL, primaryStore, type Tier, type BoostTrialStatus } from '../api.js'
import { useTier } from '../lib/tier.jsx'
import content from '../content/home.yaml'

// /  — authenticated home. Tier label + setup status + (free/core only) an
// upgrade card + a quick link to the player URL. No now-playing widget. Ever.
export function Home() {
  const { stores, tier, loading } = useTier()
  const headlineStore = primaryStore(stores)
  const playerUrl = headlineStore ? `${PLAYER_URL}/${headlineStore.slug}` : null

  const [trialStatus, setTrialStatus] = useState<BoostTrialStatus | null>(null)
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (loading) return
    // Poll trial status for free-tier users (active Boost Trials are comp'd to 'core').
    api.boostTrialStatus().then((r) => {
      setTrialStatus(r.trialStatus)
      setTrialDaysRemaining(r.daysRemaining)
    }).catch(() => { /* non-critical */ })
  }, [loading])

  return (
    <Layout>
      <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <SetupChecklist tier={tier} hasLocation={stores.length > 0} />

        {trialStatus === 'generating' && <TrialGeneratingBanner />}
        {trialStatus === 'active' && trialDaysRemaining !== null && (
          <TrialActiveBanner
            daysRemaining={trialDaysRemaining}
            storeId={headlineStore?.id}
          />
        )}

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

        <UpgradeCard tier={tier} trialStatus={trialStatus} storeId={headlineStore?.id} />
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
          fontFamily: T.mono, fontSize: 13,
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
  headline: string
  body: string
  ctaLabel: string
  ctaTier: 'core' | 'pro'
}

function upgradeCopyFor(tier: Tier): UpgradeCopy | null {
  if (tier === 'free') {
    return {
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

function TrialGeneratingBanner() {
  return (
    <div style={{
      background: 'rgba(80, 146, 156, 0.08)',
      border: `1px solid ${T.borderActive}`,
      borderRadius: 10, padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: T.accent, flexShrink: 0,
        animation: 'pulse 1.4s ease-in-out infinite',
      }} />
      <div style={{ color: T.textMuted, fontSize: 14, fontFamily: T.sans, lineHeight: 1.5 }}>
        <strong style={{ color: T.text }}>Your Boost library is generating.</strong>
        {' '}You'll get an email when your first tracks are ready to play.
      </div>
    </div>
  )
}

function TrialActiveBanner({ daysRemaining, storeId }: { daysRemaining: number; storeId?: string }) {
  const urgent = daysRemaining <= 7
  return (
    <div style={{
      background: urgent ? 'rgba(215, 175, 116, 0.08)' : 'rgba(80, 146, 156, 0.06)',
      border: `1px solid ${urgent ? T.warn : T.borderActive}`,
      borderRadius: 10, padding: '14px 18px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ color: T.textMuted, fontSize: 14, fontFamily: T.sans }}>
        <strong style={{ color: urgent ? T.warn : T.text }}>
          Boost trial · {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left
        </strong>
      </div>
      {storeId && (
        <a
          href={api.upgradeFromCompUrl(storeId)}
          onClick={() => trackUpgradeCtaClick('trial_banner', 'core')}
          style={{
            ...ctaStyle,
            padding: '8px 14px', fontSize: 13, flexShrink: 0,
          }}
        >
          Keep Boost <ArrowRight size={13} strokeWidth={2} />
        </a>
      )}
    </div>
  )
}

function UpgradeCard({
  tier, trialStatus, storeId,
}: {
  tier: Tier
  trialStatus: BoostTrialStatus | null
  storeId?: string
}) {
  // Active trial: show upgrade-from-comp CTA instead of checkout.
  if (trialStatus === 'active' && storeId) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, rgba(80,146,156,0.10) 0%, rgba(80,146,156,0.03) 100%)',
        border: `1px solid ${T.border}`,
        borderRadius: 12, padding: 24,
      }}>
        <div style={{
          fontFamily: T.heading, fontSize: 18, fontWeight: 500,
          color: T.text, marginBottom: 6, letterSpacing: '-0.01em',
        }}>
          Keep this library after your trial.
        </div>
        <div style={{
          color: T.textMuted, fontSize: 14, fontFamily: T.sans,
          lineHeight: 1.55, marginBottom: 16,
        }}>
          $99 per location, per month. No contracts, cancel any time.
        </div>
        <a
          href={api.upgradeFromCompUrl(storeId)}
          onClick={() => trackUpgradeCtaClick('home_card', 'core')}
          style={ctaStyle}
        >
          Keep Boost — $99/mo <ArrowRight size={14} strokeWidth={2} />
        </a>
      </div>
    )
  }

  const copy = upgradeCopyFor(tier)
  if (!copy) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(215,175,116,0.10) 0%, rgba(215,175,116,0.03) 100%)',
      border: `1px solid ${T.border}`,
      borderRadius: 12, padding: 24,
    }}>
      <div style={{
        fontFamily: T.heading, fontSize: 18, fontWeight: 500,
        color: T.text, marginBottom: 6, letterSpacing: '-0.01em',
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
        onClick={() => trackUpgradeCtaClick('home_card', copy.ctaTier)}
        style={ctaStyle}
      >
        {copy.ctaLabel} <ArrowRight size={14} strokeWidth={2} />
      </a>
    </div>
  )
}
