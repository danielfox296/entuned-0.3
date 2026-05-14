import { useState, useEffect, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Home as HomeIcon, MapPin, UserCircle2,
  Sparkles, CalendarClock, Plug, BarChart3, Lock, Menu, X,
} from 'lucide-react'
import { T } from '../tokens.js'
import { TIER_LABEL, TIER_PRICE, TIER_RANK, type Tier } from '../api.js'
import { useAuth } from '../lib/auth.jsx'
import { useTier } from '../lib/tier.jsx'
import { trackLockedNavClick } from '../lib/ga4.js'
import { Logo } from './Logo.js'

type Icon = typeof HomeIcon

interface NavSpec {
  to: string
  label: string
  icon: Icon
  // 'free' = always unlocked. 'core'/'pro' = unlocked if user is at or above
  // that tier. 'roadmap' = locked for everyone in v1.
  requires: 'free' | 'core' | 'pro' | 'roadmap'
  features: string[]
}

const NAV: NavSpec[] = [
  { to: '/',             label: 'Home',             icon: HomeIcon,      requires: 'free',    features: [] },
  { to: '/locations',    label: 'Locations',        icon: MapPin,        requires: 'free',    features: [] },
  { to: '/intake',       label: 'Customer Profile', icon: Sparkles,      requires: 'core',    features: ['Music tuned to your specific customer', 'A library built around who walks in'] },
  { to: '/schedule',     label: 'Schedule',         icon: CalendarClock, requires: 'pro',     features: ['Time-of-day outcome rotation', 'Outcome scheduling rules'] },
  { to: '/integrations', label: 'Integrations',     icon: Plug,          requires: 'pro',     features: ['Square, Shopify, Lightspeed', 'Tie music to sales'] },
  { to: '/reports',      label: 'Reports',          icon: BarChart3,     requires: 'roadmap', features: ['Lift Reports', 'Rolling out with v2'] },
]

function tierUnlocks(currentTier: Tier, requires: NavSpec['requires']): boolean {
  if (requires === 'free') return true
  if (requires === 'roadmap') return false
  return TIER_RANK[currentTier] >= TIER_RANK[requires]
}

function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return mobile
}

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { tier, onboardingGateTripped } = useTier()
  const location = useLocation()
  const mobile = useMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])
  // Close drawer when resizing back to desktop
  useEffect(() => { if (!mobile) setDrawerOpen(false) }, [mobile])

  // Pre-gate free users see only what they can touch — Home + Locations.
  // Locked items (Customer Profile, Schedule, Integrations, Reports) reappear
  // once the onboarding gate trips. Paid tiers always see everything.
  const visibleNav = (tier === 'free' && !onboardingGateTripped)
    ? NAV.filter((item) => item.requires === 'free')
    : NAV

  const navItems = visibleNav.map((item) => (
    <NavRow key={item.to} item={item} unlocked={tierUnlocks(tier, item.requires)} showTooltip={!mobile} />
  ))

  const accountFooter = (
    <div style={{ borderTop: `1px solid ${T.borderSubtle}`, paddingBottom: 16 }}>
      <NavLink
        to="/account"
        style={({ isActive }) => ({
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          color: isActive ? T.text : T.textMuted,
          background: isActive ? T.accentGlow : 'transparent',
          borderLeft: isActive ? `2px solid ${T.accent}` : '2px solid transparent',
          textDecoration: 'none',
        })}
      >
        <UserCircle2 size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
        <span style={{
          fontSize: 13, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {user?.email ?? '—'}
        </span>
      </NavLink>
    </div>
  )

  if (mobile) {
    return (
      <div style={{ width: '100%', minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans, overflowX: 'hidden' }}>
        {/* Sticky top bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 30,
          height: 52, padding: '0 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: T.surface, borderBottom: `1px solid ${T.border}`,
        }}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{
              background: 'transparent', border: 'none', padding: 4,
              color: T.text, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
          <Logo height={22} />
          {/* spacer matches hamburger width for visual centering */}
          <div style={{ width: 28 }} />
        </div>

        {/* Backdrop */}
        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 40,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(2px)',
            }}
          />
        )}

        {/* Slide-in drawer */}
        <div style={{
          position: 'fixed', top: 0, left: 0, zIndex: 50,
          width: 280, height: '100vh',
          background: T.surface, borderRight: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}>
          <div style={{
            height: 52, padding: '0 12px 0 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.borderSubtle}`, flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Logo height={40} />
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                color: T.accent, textTransform: 'uppercase',
                border: `1px solid ${T.borderActive}`,
                borderRadius: 8, padding: '2px 6px',
              }}>{TIER_LABEL[tier].replace('Entuned ', '')}</span>
            </div>
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              style={{
                background: 'transparent', border: 'none', padding: 4,
                color: T.textDim, cursor: 'pointer',
                display: 'flex', alignItems: 'center',
              }}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
            {navItems}
          </div>
          {accountFooter}
        </div>

        {/* Page content */}
        <div style={{ padding: '24px 16px' }}>
          {children}
        </div>
      </div>
    )
  }

  // Desktop: fixed sidebar
  return (
    <div style={{
      width: '100%', height: '100vh', display: 'flex',
      background: T.bg, color: T.text, fontFamily: T.sans,
      overflow: 'hidden',
    }}>
      <div style={{
        width: 168, background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{
          padding: '14px 14px 12px',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}>
          <Logo height={32} />
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
            color: T.accent, textTransform: 'uppercase',
            border: `1px solid ${T.borderActive}`,
            borderRadius: 8, padding: '2px 6px',
          }}>{TIER_LABEL[tier].replace('Entuned ', '')}</span>
        </div>

        <div style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
          {navItems}
        </div>
        {accountFooter}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px' }}>
        {children}
      </div>
    </div>
  )
}

function NavRow({ item, unlocked, showTooltip }: { item: NavSpec; unlocked: boolean; showTooltip: boolean }) {
  const [hover, setHover] = useState(false)
  const isRoadmap = item.requires === 'roadmap'
  const showBadge = !unlocked
  const badgeLabel = isRoadmap ? 'Soon' : (item.requires === 'core' ? 'Core' : 'Pro')

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <NavLink
        to={item.to}
        end={item.to === '/'}
        onClick={!unlocked ? () => trackLockedNavClick(item.label, item.requires) : undefined}
        style={({ isActive }) => ({
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          color: isActive ? T.text : (unlocked ? T.textMuted : T.textDim),
          background: isActive ? T.accentGlow : 'transparent',
          borderLeft: isActive ? `2px solid ${T.accent}` : '2px solid transparent',
          fontSize: 14, fontWeight: isActive ? 500 : 400,
          textDecoration: 'none',
        })}
      >
        <item.icon size={16} strokeWidth={1.75} style={{ opacity: unlocked ? 1 : 0.55 }} />
        <span style={{ flex: 1, opacity: unlocked ? 1 : 0.7 }}>{item.label}</span>
        {showBadge && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            color: isRoadmap ? T.textFaint : T.accentMuted,
            border: `1px solid ${isRoadmap ? T.borderSubtle : T.border}`,
            borderRadius: 8, padding: '1px 5px',
            textTransform: 'uppercase',
          }}>
            <Lock size={9} strokeWidth={2} /> {badgeLabel}
          </span>
        )}
      </NavLink>

      {hover && showBadge && showTooltip && <Tooltip item={item} />}
    </div>
  )
}

function Tooltip({ item }: { item: NavSpec }) {
  const isRoadmap = item.requires === 'roadmap'
  const tierKey = isRoadmap ? null : (item.requires as 'core' | 'pro')

  return (
    <div style={{
      position: 'absolute', left: 'calc(100% + 8px)', top: 4, zIndex: 10,
      width: 240, background: T.inkDeep,
      border: `1px solid ${T.border}`,
      borderRadius: 12, padding: '12px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
        color: T.accent, textTransform: 'uppercase', marginBottom: 6,
      }}>
        {isRoadmap ? 'Roadmap' : `Available on ${TIER_LABEL[tierKey!]}`}
      </div>
      {tierKey && (
        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 10 }}>
          {TIER_PRICE[tierKey]}
        </div>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 5 }}>
        {item.features.map((f) => (
          <li key={f} style={{ fontSize: 12, color: T.textMuted, fontFamily: T.sans, lineHeight: 1.4 }}>
            · {f}
          </li>
        ))}
      </ul>
    </div>
  )
}
