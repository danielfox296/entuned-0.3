import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home as HomeIcon, MapPin, UserCircle2, LogOut,
  Sparkles, CalendarClock, Plug, BarChart3, Lock,
} from 'lucide-react'
import { T } from '../tokens.js'
import { api, TIER_LABEL, TIER_PRICE, TIER_RANK, type Tier } from '../api.js'
import { useAuth } from '../lib/auth.jsx'
import { useTier } from '../lib/tier.jsx'

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
  { to: '/',             label: 'Home',         icon: HomeIcon,      requires: 'free',    features: [] },
  { to: '/locations',    label: 'Locations',    icon: MapPin,        requires: 'free',    features: [] },
  { to: '/intake',       label: 'Customer Profile', icon: Sparkles,      requires: 'core',    features: ['Music tuned to your specific customer', 'A library built around who walks in'] },
  { to: '/schedule',     label: 'Schedule',     icon: CalendarClock, requires: 'pro',     features: ['Time-of-day outcome rotation', 'Day-parting rules'] },
  { to: '/integrations', label: 'Integrations', icon: Plug,          requires: 'pro',     features: ['Square, Shopify, Lightspeed', 'Tie music to sales'] },
  { to: '/reports',      label: 'Reports',      icon: BarChart3,     requires: 'roadmap', features: ['Lift Reports', 'Rolling out with v2'] },
  { to: '/account',      label: 'Account',      icon: UserCircle2,   requires: 'free',    features: [] },
]

function tierUnlocks(currentTier: Tier, requires: NavSpec['requires']): boolean {
  if (requires === 'free') return true
  if (requires === 'roadmap') return false
  return TIER_RANK[currentTier] >= TIER_RANK[requires]
}

// App shell with a sidebar nav. Every authenticated route renders inside.
export function Layout({ children }: { children: ReactNode }) {
  const { user, account } = useAuth()
  const { tier } = useTier()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try { await api.logout() } catch { /* ignore — clearing client state is enough */ }
    navigate('/start', { replace: true })
  }

  return (
    <div style={{
      width: '100%', height: '100vh', display: 'flex',
      background: T.bg, color: T.text, fontFamily: T.sans,
      overflow: 'hidden',
    }}>
      {/* Sidebar */}
      <div style={{
        width: 240, background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{
          height: 56, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}>
          <span style={{
            fontFamily: T.heading, fontSize: 18, fontWeight: 700,
            color: T.text, letterSpacing: '-0.02em',
          }}>entuned</span>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
            color: T.accent, textTransform: 'uppercase',
            border: `1px solid ${T.borderActive}`,
            borderRadius: 8, padding: '2px 6px',
          }}>{TIER_LABEL[tier]}</span>
        </div>

        <div style={{ flex: 1, padding: '12px 0' }}>
          {NAV.map((item) => (
            <NavRow key={item.to} item={item} unlocked={tierUnlocks(tier, item.requires)} />
          ))}
        </div>

        <div style={{
          borderTop: `1px solid ${T.borderSubtle}`,
          padding: '12px 20px',
        }}>
          <div style={{ fontSize: 12, color: T.textDim, marginBottom: 2 }}>
            {account?.companyName ?? '—'}
          </div>
          <div style={{
            fontSize: 12, color: T.textFaint,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 10,
          }}>
            {user?.email ?? ''}
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none', padding: 0,
              color: T.textDim, fontFamily: T.sans, fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <LogOut size={12} strokeWidth={1.75} /> Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px' }}>
        {children}
      </div>
    </div>
  )
}

function NavRow({ item, unlocked }: { item: NavSpec; unlocked: boolean }) {
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
        style={({ isActive }) => ({
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 20px',
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

      {hover && showBadge && <Tooltip item={item} />}
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
