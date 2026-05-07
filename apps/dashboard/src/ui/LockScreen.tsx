import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { T } from '../tokens.js'
import { TIER_LABEL, TIER_PRICE, api, type Tier } from '../api.js'

type Required = 'core' | 'pro' | 'roadmap'

interface LockScreenProps {
  tabName: string
  valueLine: string
  requiredTier: Required
  detail?: string
  // Caller's current tier — used so the CTA can read "Upgrade to Core"
  // even when the requirement is Pro but the user is already Core.
  currentTier?: Tier
  // How fast the user gets value after upgrading. Surfacing this turns the
  // upgrade trade from abstract ("you'd unlock...") into concrete ("music
  // refreshes within 24h"). Keep to a single short line.
  timeToValue?: string
  // Visual preview of what the unlocked surface looks like. Renders below
  // the value line. Use a faked/illustrated mock so the trade is visceral
  // rather than text-only.
  preview?: ReactNode
}

// Single-screen lock used on routes the customer's tier doesn't include.
// Renders inside <Layout>; URL stays correct so the screen can be linked or
// bookmarked. Roadmap variant has no upgrade CTA — it's a teaser.
export function LockScreen({
  tabName, valueLine, requiredTier, detail, currentTier,
  timeToValue, preview,
}: LockScreenProps) {
  const isRoadmap = requiredTier === 'roadmap'
  const ctaTier: 'core' | 'pro' = requiredTier === 'roadmap' ? 'pro' : requiredTier
  const ctaLabel = `Unlock ${TIER_LABEL[ctaTier]}`
  const tierLabel = isRoadmap ? null : TIER_LABEL[ctaTier]
  const priceLine = isRoadmap ? null : TIER_PRICE[ctaTier]

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Lock size={18} strokeWidth={1.75} color={T.accent} />
        <h1 style={{
          fontFamily: T.heading, fontSize: 24, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', margin: 0,
        }}>{tabName}</h1>
      </div>

      <div style={{
        background: T.surfaceRaised,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 28,
      }}>
        <div style={{
          color: T.text, fontSize: 18, fontFamily: T.heading,
          lineHeight: 1.4, marginBottom: 14, fontWeight: 500,
        }}>
          {valueLine}
        </div>

        {!isRoadmap && (
          <div style={{
            color: T.textDim, fontSize: 13, fontFamily: T.sans,
            marginBottom: timeToValue ? 6 : 22,
          }}>
            Available on <span style={{ color: T.accent, fontWeight: 600 }}>{tierLabel}</span>
            {' · '}{priceLine}
          </div>
        )}

        {timeToValue && !isRoadmap && (
          <div style={{
            color: T.accentMuted, fontSize: 13, fontFamily: T.sans,
            marginBottom: 22,
          }}>
            {timeToValue}
          </div>
        )}

        {detail && (
          <div style={{
            color: T.textMuted, fontSize: 14, fontFamily: T.sans,
            lineHeight: 1.6, marginBottom: 22,
            paddingTop: 16, borderTop: `1px solid ${T.borderSubtle}`,
          }}>
            {detail}
          </div>
        )}

        {!isRoadmap && (
          <a
            href={api.checkoutUrl(ctaTier)}
            style={{
              display: 'inline-block',
              background: T.accent,
              color: T.bg,
              padding: '10px 18px',
              borderRadius: 10,
              fontFamily: T.sans,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            {ctaLabel}
          </a>
        )}

        {isRoadmap && (
          <div style={{
            color: T.textFaint, fontSize: 13, fontFamily: T.sans,
            fontStyle: 'italic',
          }}>
            On the roadmap.
          </div>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: 24 }}>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.18em',
            color: T.accent, textTransform: 'uppercase', marginBottom: 12,
          }}>
            Preview · what you'd see unlocked
          </div>
          <div style={{
            position: 'relative',
            border: `1px dashed ${T.border}`,
            borderRadius: 12,
            padding: 0,
            overflow: 'hidden',
            background: T.surface,
          }}>
            <div style={{
              opacity: 0.55,
              filter: 'saturate(0.85)',
              pointerEvents: 'none',
              userSelect: 'none',
            }}>
              {preview}
            </div>
          </div>
        </div>
      )}

      {currentTier && !isRoadmap && (
        <div style={{ color: T.textFaint, fontSize: 12, marginTop: 14, fontFamily: T.sans }}>
          You're on {TIER_LABEL[currentTier]}.
        </div>
      )}
    </div>
  )
}
