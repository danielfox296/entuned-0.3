import { useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Sparkles, Users, Music, RefreshCw, SlidersHorizontal, Shield,
  Check, Lock, ArrowRight, type LucideIcon,
} from 'lucide-react'
import { T } from '@entuned/tokens'
import { Layout } from '../ui/Layout.js'
import { Card } from '../ui/Card.js'
import { api, TIER_RANK } from '../api.js'
import { useTier } from '../lib/tier.jsx'
import content from '../content/upgrade.yaml'

// /upgrade — in-app PLG upgrade page for free-tier customers.
// Deep-link target for the player's locked-tile CTA: /upgrade#outcomes etc.
// Every CTA links to the server's /billing/upgrade endpoint, which creates
// a Stripe Checkout session and 303s onward.
//
// Already-paid users get a soft redirect message rather than a checkout flow.
export function Upgrade() {
  const [params] = useSearchParams()
  const { stores, tier } = useTier()
  const isPaid = TIER_RANK[tier] >= TIER_RANK.core

  // Pick a target store to upgrade. Priority:
  //   1. ?store=… (deep-linked from the player, which knows its store)
  //   2. The user's first free store
  //   3. undefined → the server picks
  const storeIdParam = params.get('store') ?? undefined
  const targetStore = useMemo(() => {
    if (storeIdParam) return stores.find((s) => s.id === storeIdParam)
    return stores.find((s) => s.tier === 'free')
  }, [stores, storeIdParam])

  const upgradeHref = api.upgradeUrl('core', targetStore?.id)

  const banner = bannerCopy(params, isPaid)

  return (
    <Layout>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {banner && <Banner kind={banner.kind}>{banner.body}</Banner>}

        {/* Hero — full-width photographic header with dark gradient overlay
            so headline + CTA stay legible against the imagery. Same image
            convention as the dashboard's /start screen for brand continuity. */}
        <section style={{
          position: 'relative',
          marginTop: 8, marginBottom: 36,
          padding: '64px 36px 56px',
          borderRadius: 18,
          overflow: 'hidden',
          background: `linear-gradient(160deg, rgba(20,20,18,0.72) 0%, rgba(20,20,18,0.92) 70%), url('/hero-start.jpg')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          border: `1px solid ${T.border}`,
        }}>
          <Eyebrow>{content.eyebrow}</Eyebrow>
          <h1 style={{
            fontFamily: T.heading, fontSize: 'clamp(2rem, 4vw, 2.6rem)', fontWeight: 700,
            color: T.text, letterSpacing: '-0.02em',
            margin: '10px 0 16px', lineHeight: 1.12,
            maxWidth: 18 + 'ch',
          }}>
            {content.heading}
          </h1>
          <p style={{
            fontSize: 17, color: T.textMuted, lineHeight: 1.55,
            margin: '0 0 22px', maxWidth: 580,
          }}>
            {content.subhead}
          </p>
          <p style={{
            fontSize: 13, color: T.accent, fontFamily: T.mono,
            letterSpacing: 0.4, margin: '0 0 28px', fontWeight: 500,
          }}>
            {content.price_line}
          </p>
          <PrimaryCTA href={upgradeHref} disabled={isPaid}>
            {content.cta_primary}
          </PrimaryCTA>
        </section>

        {/* Benefit sections — keep order; the player deep-links to these ids. */}
        <BenefitSection
          id="outcomes" icon={Sparkles}
          eyebrow={content.sections.outcomes.eyebrow}
          headline={content.sections.outcomes.headline}
          body={content.sections.outcomes.body}
          proof={content.sections.outcomes.proof}
        >
          <OutcomesGrid />
        </BenefitSection>

        <BenefitSection
          id="icp" icon={Users}
          eyebrow={content.sections.icp.eyebrow}
          headline={content.sections.icp.headline}
          body={content.sections.icp.body}
          proof={content.sections.icp.proof}
        />

        <BenefitSection
          id="library" icon={Music}
          eyebrow={content.sections.library.eyebrow}
          headline={content.sections.library.headline}
          body={content.sections.library.body}
          proof={content.sections.library.proof}
        >
          <LibraryBars />
        </BenefitSection>

        <BenefitSection
          id="refresh" icon={RefreshCw}
          eyebrow={content.sections.refresh.eyebrow}
          headline={content.sections.refresh.headline}
          body={content.sections.refresh.body}
          proof={content.sections.refresh.proof}
        />

        <BenefitSection
          id="control" icon={SlidersHorizontal}
          eyebrow={content.sections.control.eyebrow}
          headline={content.sections.control.headline}
          body={content.sections.control.body}
          proof={content.sections.control.proof}
        />

        <BenefitSection
          id="licensing" icon={Shield}
          eyebrow={content.sections.licensing.eyebrow}
          headline={content.sections.licensing.headline}
          body={content.sections.licensing.body}
          proof={content.sections.licensing.proof}
        />

        {/* FAQ */}
        <section style={{ marginTop: 48, marginBottom: 32 }}>
          <h2 style={sectionHeadlineStyle()}>{content.faq.heading}</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {content.faq.items.map((item: { q: string; a: string }) => (
              <Card key={item.q}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 8 }}>
                  {item.q}
                </div>
                <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.55 }}>
                  {item.a}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section style={{
          marginTop: 56, marginBottom: 48,
          padding: '40px 28px',
          background: T.surfaceRaised,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          textAlign: 'center',
        }}>
          <h2 style={{
            fontFamily: T.heading, fontSize: 28, fontWeight: 700,
            color: T.text, letterSpacing: '-0.01em',
            margin: '0 0 8px',
          }}>
            {content.final.heading}
          </h2>
          <p style={{ fontSize: 15, color: T.textDim, margin: '0 0 24px' }}>
            {content.final.subhead}
          </p>
          <PrimaryCTA href={upgradeHref} disabled={isPaid}>
            {content.cta_primary}
          </PrimaryCTA>
          <div style={{ marginTop: 22, fontSize: 13, color: T.textDim }}>
            {content.cta_secondary_lead}{' '}
            <a href={content.cta_secondary_link_url}
               target="_blank" rel="noopener noreferrer"
               style={{ color: T.accent, textDecoration: 'none', fontWeight: 500 }}>
              {content.cta_secondary_link_label} →
            </a>
          </div>
        </section>
      </div>

      {/* Sticky bottom bar (free users only) — persistent CTA as they scroll */}
      {!isPaid && <StickyUpgradeBar href={upgradeHref} />}
    </Layout>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────

function Eyebrow({ children }: { children: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.18em',
      color: T.accent, textTransform: 'uppercase',
    }}>
      {children}
    </div>
  )
}

function PrimaryCTA({ href, children, disabled }: { href: string; children: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '14px 24px', borderRadius: 999,
        background: T.surfaceRaised, color: T.textDim,
        border: `1px solid ${T.border}`,
        fontSize: 14, fontWeight: 600, letterSpacing: 0.5,
        cursor: 'default',
      }}>
        Already on Boost or higher
      </span>
    )
  }
  return (
    <a href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '14px 26px', borderRadius: 999,
      background: T.accent, color: T.bg,
      border: `1px solid ${T.accent}`,
      fontSize: 14, fontWeight: 700, letterSpacing: 1.2,
      textTransform: 'uppercase', textDecoration: 'none',
      boxShadow: '0 6px 18px rgba(80,146,156,0.22)',
    }}>
      {children}
      <ArrowRight size={16} strokeWidth={2.5} />
    </a>
  )
}

function StickyUpgradeBar({ href }: { href: string }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
      background: 'rgba(32,32,28,0.92)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderTop: `1px solid ${T.border}`,
      padding: '12px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      <span style={{ fontSize: 13, color: T.textMuted, fontWeight: 500 }}>
        {content.sticky_bar_label}
      </span>
      <a href={href} style={{
        padding: '10px 20px', borderRadius: 999,
        background: T.accent, color: T.bg,
        fontSize: 12, fontWeight: 700, letterSpacing: 1.2,
        textTransform: 'uppercase', textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}>
        {content.sticky_bar_cta}
      </a>
    </div>
  )
}

function sectionHeadlineStyle() {
  return {
    fontFamily: T.heading,
    fontSize: 24,
    fontWeight: 700,
    color: T.text,
    letterSpacing: '-0.01em',
    margin: '0 0 20px',
  } as const
}

function BenefitSection({
  id, icon: Icon, eyebrow, headline, body, proof, children,
}: {
  id: string
  icon: LucideIcon
  eyebrow: string
  headline: string
  body: string
  proof: string
  children?: ReactNode
}) {
  return (
    <section id={id} style={{
      scrollMarginTop: 24, // leaves breathing room when deep-linked from player
      marginTop: 32,
      padding: '28px 28px 24px',
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <div style={{
          flexShrink: 0,
          width: 44, height: 44, borderRadius: 12,
          background: T.accentGlow, color: T.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={22} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 style={{
            fontFamily: T.heading, fontSize: 22, fontWeight: 700,
            color: T.text, letterSpacing: '-0.01em',
            margin: '6px 0 10px', lineHeight: 1.25,
          }}>
            {headline}
          </h2>
          <p style={{ fontSize: 15, color: T.textMuted, lineHeight: 1.55, margin: 0 }}>
            {body}
          </p>
        </div>
      </div>
      {/* Proof line — teal-accented, monospaced for that "spec sheet" feel */}
      <div style={{
        marginTop: 12, paddingTop: 14,
        borderTop: `1px solid ${T.borderSubtle}`,
        fontSize: 13, color: T.accent, fontFamily: T.mono,
        letterSpacing: 0.3, lineHeight: 1.5,
      }}>
        {proof}
      </div>
      {children && <div style={{ marginTop: 20 }}>{children}</div>}
    </section>
  )
}

function OutcomesGrid() {
  // Hard-coded list mirrors the production outcome catalogue — kept in sync
  // by hand because this is marketing copy on the upgrade page, not a live
  // pool view. If the catalogue changes meaningfully, edit here.
  const all = [
    { name: 'Chill', free: true },
    { name: 'Steady', free: true },
    { name: 'Upbeat', free: true },
    { name: 'Stay & Browse', free: false },
    { name: 'Keep It Moving', free: false },
    { name: 'Trade Them Up', free: false },
    { name: 'Grab It Now', free: false },
    { name: 'Our Sound', free: false },
  ]
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 8,
    }}>
      {all.map((o) => (
        <div key={o.name} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 10,
          background: o.free ? T.accentGlow : 'rgba(212,225,229,0.04)',
          border: `1px solid ${o.free ? T.borderActive : T.borderSubtle}`,
          fontSize: 12, fontWeight: 600, letterSpacing: 0.6,
          color: o.free ? T.accent : T.textDim,
          textTransform: 'uppercase',
        }}>
          {o.free ? <Check size={12} strokeWidth={2.5} /> : <Lock size={11} strokeWidth={2.5} />}
          <span>{o.name}</span>
        </div>
      ))}
    </div>
  )
}

function LibraryBars() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <BarRow label="Free" value={100} max={420} highlight={false} />
      <BarRow label="Boost, day 1" value={300} max={420} highlight />
      <BarRow label="Boost, month 1" value={420} max={420} highlight />
    </div>
  )
}

function BarRow({ label, value, max, highlight }: {
  label: string; value: number; max: number; highlight: boolean
}) {
  const pct = (value / max) * 100
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 12, fontFamily: T.mono, marginBottom: 4,
        color: highlight ? T.accent : T.textDim,
        letterSpacing: 0.3,
      }}>
        <span>{label}</span>
        <span>{value} songs</span>
      </div>
      <div style={{
        height: 8, borderRadius: 999,
        background: T.surfaceRaised,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: highlight ? T.accent : T.accentMuted,
          borderRadius: 999,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

function Banner({ kind, children }: { kind: 'info' | 'error' | 'success'; children: string }) {
  const palette = kind === 'error'
    ? { bg: 'rgba(226,75,74,0.08)', border: 'rgba(226,75,74,0.4)', text: T.danger }
    : kind === 'success'
    ? { bg: 'rgba(82,196,122,0.08)', border: 'rgba(82,196,122,0.4)', text: T.success }
    : { bg: T.accentGlow, border: T.borderActive, text: T.accent }
  return (
    <div style={{
      marginBottom: 16, padding: '12px 16px',
      background: palette.bg, border: `1px solid ${palette.border}`,
      borderRadius: 10, color: palette.text,
      fontSize: 13, fontWeight: 500,
    }}>
      {children}
    </div>
  )
}

function bannerCopy(params: URLSearchParams, isPaid: boolean): { kind: 'info' | 'error' | 'success'; body: string } | null {
  if (isPaid) return { kind: 'info', body: content.already_subscribed_banner }
  const canceled = params.get('canceled')
  if (canceled === '1') return { kind: 'info', body: content.canceled_banner }
  const error = params.get('error')
  if (error) {
    const msg = error === 'stripe_error' ? content.error_banner_generic : `${error}.`
    return { kind: 'error', body: `${content.error_banner_prefix}${msg}` }
  }
  return null
}
