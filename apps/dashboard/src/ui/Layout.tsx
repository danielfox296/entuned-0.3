import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Home as HomeIcon, MapPin, UserCircle2, LogOut } from 'lucide-react'
import { T } from '../tokens.js'
import { api } from '../api.js'
import { useAuth } from '../lib/auth.jsx'

const NAV: { to: string; label: string; icon: typeof HomeIcon }[] = [
  { to: '/',          label: 'Home',      icon: HomeIcon },
  { to: '/locations', label: 'Locations', icon: MapPin   },
  { to: '/account',   label: 'Account',   icon: UserCircle2 },
]

// App shell with a sidebar nav. Every authenticated route renders inside.
export function Layout({ children }: { children: ReactNode }) {
  const { user, account } = useAuth()
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
        width: 220, background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{
          height: 56, padding: '0 20px', display: 'flex', alignItems: 'center',
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}>
          <span style={{
            fontFamily: T.heading, fontSize: 18, fontWeight: 700,
            color: T.text, letterSpacing: '-0.02em',
          }}>entuned</span>
        </div>

        <div style={{ flex: 1, padding: '12px 0' }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 20px',
                color: isActive ? T.text : T.textMuted,
                background: isActive ? T.accentGlow : 'transparent',
                borderLeft: isActive ? `2px solid ${T.accent}` : '2px solid transparent',
                fontSize: 14, fontWeight: isActive ? 500 : 400,
              })}
            >
              <item.icon size={16} strokeWidth={1.75} />
              {item.label}
            </NavLink>
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
