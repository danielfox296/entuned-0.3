import { useEffect, useState, useCallback } from 'react'
import { api, getToken, setToken, clearToken } from './api.js'
import type { MeResponse } from './api.js'
import { T } from './tokens.js'
import { DecomposerRules } from './panels/engine/DecomposerRules.js'
import { FailureRules } from './panels/engine/FailureRules.js'
import { StyleTemplate } from './panels/engine/StyleTemplate.js'
import { LyricPrompts } from './panels/engine/LyricPrompts.js'
import { IcpEditor } from './panels/brand/IcpEditor.js'
import { HookQueue } from './panels/brand/HookQueue.js'
import { LiveStoreView } from './panels/playback/LiveStoreView.js'
import { OutcomeSchedule } from './panels/schedule/OutcomeSchedule.js'
import { OutcomeLibrary } from './panels/schedule/OutcomeLibrary.js'
import { IntentQueue } from './panels/seeding/IntentQueue.js'

// ── Surface groups (from admin-ui.md, priority order) ──────────
interface SurfaceGroup {
  key: string; label: string; short: string; icon: string
  cards: string[]; description: string; deferred?: boolean
}

const GROUPS: SurfaceGroup[] = [
  { key: 'seeding', label: 'Operator Seeding', short: 'Seeding', icon: '⏺',
    cards: ['Intent Queue', 'Intent Detail', 'Abandoned Log'],
    description: 'Claim intents, paste to Suno, seed or abandon takes' },
  { key: 'playback', label: 'Playback & Overrides', short: 'Playback', icon: '▶',
    cards: ['Live Store View', 'Mode Override', 'Interrupt Controls'],
    description: "What's playing now, override outcomes, skip/pause" },
  { key: 'brand', label: 'Client & Brand', short: 'Brand', icon: '◆',
    cards: ['Client Detail', 'ICP Editor', 'Hook Queue', 'Store Editor'],
    description: 'ICP profiles, hooks, reference tracks, store config' },
  { key: 'schedule', label: 'Scheduling & Goals', short: 'Schedule', icon: '▦',
    cards: ['Outcome Schedule', 'Goal Editor', 'Outcome Library', 'Dry Run'],
    description: 'Weekly outcome grids, goals, schedule preview' },
  { key: 'engine', label: 'Engine', short: 'Engine', icon: '⚙',
    cards: ['Decomposer Rules', 'Failure Rules', 'Style Template', 'Lyric Prompts'],
    description: 'System-level prompts that drive decomposer, Mars, and Bernie' },
  { key: 'catalogue', label: 'Song Catalogue', short: 'Catalogue', icon: '♫',
    cards: ['Song Browser', 'Flagged Review', 'Retired Songs', 'Pool Depth'],
    description: 'Browse songs, review flags, monitor pool depth' },
  { key: 'experiments', label: 'Experiments', short: 'Experiments', icon: '⬡',
    cards: ['Experiment Editor', 'Experiment Detail', 'Results'],
    description: 'A/B tests, arm pools, conclusions', deferred: true },
  { key: 'hypothesis', label: 'Hypothesis Review', short: 'Hypotheses', icon: '△',
    cards: ['Hypothesis Queue', 'Hypothesis Detail', 'Promotion History'],
    description: 'Kraftwerk output review, promote or reject', deferred: true },
  { key: 'monitoring', label: 'Monitoring & Alerts', short: 'Monitoring', icon: '◉',
    cards: ['Alert Feed', 'Metric Source Registry'],
    description: 'Pool alerts, experiment gates, system health', deferred: true },
]

// ── StatusBar ──────────────────────────────────────────────────
function StatusBar({ apiOk }: { apiOk: boolean }) {
  return (
    <div style={{
      height: 36, background: T.surface, borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 20,
      flexShrink: 0, fontFamily: T.sans, fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: apiOk ? T.success : T.danger,
          boxShadow: apiOk ? `0 0 6px ${T.success}` : 'none',
        }} />
        <span style={{ color: T.textMuted }}>API</span>
        <span style={{ color: T.text }}>{apiOk ? 'live' : 'down'}</span>
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ color: T.textDim }}>entuned v0.3 admin</span>
    </div>
  )
}

// ── Sidebar ────────────────────────────────────────────────────
function Sidebar({ active, onSelect, collapsed, onToggle, email }: {
  active: string; onSelect: (k: string) => void
  collapsed: boolean; onToggle: () => void; email: string
}) {
  return (
    <div style={{
      width: collapsed ? 48 : 200, background: T.surface,
      borderRight: `1px solid ${T.border}`, display: 'flex',
      flexDirection: 'column', flexShrink: 0,
      transition: 'width 0.2s ease', overflow: 'hidden',
    }}>
      <div onClick={onToggle} style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: collapsed ? '0 14px' : '0 16px', gap: 10,
        borderBottom: `1px solid ${T.borderSubtle}`, cursor: 'pointer', flexShrink: 0,
      }}>
        {collapsed
          ? <span style={{ fontSize: 16, color: T.accent, fontFamily: T.heading, fontWeight: 700 }}>e</span>
          : <img src="/entuned-logo-ice.svg" alt="Entuned" style={{ height: 18, width: 'auto', display: 'block' }} />
        }
      </div>

      <div style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {GROUPS.map((g) => {
          const on = active === g.key
          return (
            <div key={g.key} onClick={() => onSelect(g.key)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: collapsed ? '10px 14px' : '10px 16px', cursor: 'pointer',
              background: on ? T.accentGlow : 'transparent',
              borderLeft: on ? `2px solid ${T.accent}` : '2px solid transparent',
              transition: 'all 0.15s ease', opacity: g.deferred ? 0.4 : 1,
            }}>
              <span style={{
                fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0,
                color: on ? T.accent : T.textMuted,
              }}>{g.icon}</span>
              {!collapsed && <span style={{
                fontSize: 13, fontFamily: T.sans, fontWeight: on ? 500 : 400,
                color: on ? T.text : T.textMuted, whiteSpace: 'nowrap',
              }}>{g.short}</span>}
            </div>
          )
        })}
      </div>

      {!collapsed && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.borderSubtle}` }}>
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.sans }}>{email}</div>
        </div>
      )}
    </div>
  )
}

// ── Panel shell ────────────────────────────────────────────────
function PanelShell({ group }: { group: SurfaceGroup }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '20px 28px 16px', borderBottom: `1px solid ${T.borderSubtle}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 13, color: T.accent }}>{group.icon}</span>
          <h1 style={{
            fontSize: 18, fontFamily: T.heading, fontWeight: 700,
            color: T.text, margin: 0, letterSpacing: '-0.02em',
          }}>{group.label}</h1>
          {group.deferred && <span style={{
            fontSize: 10, fontFamily: T.sans, color: T.textDim,
            background: T.surfaceRaised, padding: '2px 8px', borderRadius: 3,
            border: `1px solid ${T.borderSubtle}`,
          }}>deferred</span>}
        </div>
        <p style={{ fontSize: 12, color: T.textMuted, fontFamily: T.sans, margin: '6px 0 0' }}>
          {group.description}
        </p>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
        {group.key === 'engine' ? <EngineRouter cards={group.cards} /> :
         group.key === 'brand' ? <BrandRouter cards={group.cards} /> :
         group.key === 'playback' ? <PlaybackRouter cards={group.cards} /> :
         group.key === 'schedule' ? <ScheduleRouter cards={group.cards} /> :
         group.key === 'seeding' ? <SeedingRouter cards={group.cards} /> : (
        <>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12,
        }}>
          {group.cards.map((card) => (
            <div key={card} style={{
              background: T.surfaceRaised, border: `1px solid ${T.border}`,
              borderRadius: 6, padding: '20px 20px 16px',
              cursor: group.deferred ? 'default' : 'pointer',
            }}>
              <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text, marginBottom: 8 }}>
                {card}
              </div>
              <div style={{ fontSize: 11, fontFamily: T.sans, color: group.deferred ? T.textDim : T.accent }}>
                {group.deferred ? 'post-mvp' : 'ready for build →'}
              </div>
            </div>
          ))}
        </div>

        {!group.deferred && (
          <div style={{
            marginTop: 32, padding: 24, background: T.accentGlow,
            border: `1px dashed ${T.accentMuted}`, borderRadius: 6,
          }}>
            <div style={{ fontSize: 13, fontFamily: T.sans, color: T.textMuted, lineHeight: 1.6 }}>
              Panel ready for build. Each card above becomes a workflow component
              that slots into this space.
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}

// ── Engine router ──────────────────────────────────────────────
function EngineRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useState<string>(cards[0]!)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}`, paddingBottom: 0 }}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button
              key={c}
              onClick={() => setActive(c)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : T.textMuted,
                padding: '8px 14px', cursor: 'pointer',
                fontFamily: T.sans, fontSize: 12, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}</button>
          )
        })}
      </div>
      {active === 'Decomposer Rules' && <DecomposerRules />}
      {active === 'Failure Rules' && <FailureRules />}
      {active === 'Style Template' && <StyleTemplate />}
      {active === 'Lyric Prompts' && <LyricPrompts />}
    </div>
  )
}

// ── Brand router ───────────────────────────────────────────────
function BrandRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useState<string>('ICP Editor')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          const ready = c === 'ICP Editor' || c === 'Hook Queue'
          return (
            <button
              key={c}
              onClick={() => ready && setActive(c)}
              disabled={!ready}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : (ready ? T.textMuted : T.textDim),
                padding: '8px 14px', cursor: ready ? 'pointer' : 'default',
                fontFamily: T.sans, fontSize: 12, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}{ready ? '' : ' (soon)'}</button>
          )
        })}
      </div>
      {active === 'ICP Editor' && <IcpEditor />}
      {active === 'Hook Queue' && <HookQueue />}
    </div>
  )
}

// ── Playback router ────────────────────────────────────────────
function PlaybackRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useState<string>('Live Store View')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          const ready = c === 'Live Store View' || c === 'Mode Override'
          return (
            <button
              key={c}
              onClick={() => ready && setActive(c === 'Mode Override' ? 'Live Store View' : c)}
              disabled={!ready}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : (ready ? T.textMuted : T.textDim),
                padding: '8px 14px', cursor: ready ? 'pointer' : 'default',
                fontFamily: T.sans, fontSize: 12, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}{ready ? '' : ' (soon)'}</button>
          )
        })}
      </div>
      {active === 'Live Store View' && <LiveStoreView />}
    </div>
  )
}

// ── Schedule router ────────────────────────────────────────────
function ScheduleRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useState<string>('Outcome Schedule')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          const ready = c === 'Outcome Schedule' || c === 'Outcome Library'
          return (
            <button
              key={c}
              onClick={() => ready && setActive(c)}
              disabled={!ready}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : (ready ? T.textMuted : T.textDim),
                padding: '8px 14px', cursor: ready ? 'pointer' : 'default',
                fontFamily: T.sans, fontSize: 12, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}{ready ? '' : ' (soon)'}</button>
          )
        })}
      </div>
      {active === 'Outcome Schedule' && <OutcomeSchedule />}
      {active === 'Outcome Library' && <OutcomeLibrary />}
    </div>
  )
}

// ── Seeding router ─────────────────────────────────────────────
function SeedingRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useState<string>('Intent Queue')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          // Intent Detail is reached by clicking a row in Intent Queue, not as a top-level tab.
          const ready = c === 'Intent Queue'
          return (
            <button
              key={c}
              onClick={() => ready && setActive(c)}
              disabled={!ready}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : (ready ? T.textMuted : T.textDim),
                padding: '8px 14px', cursor: ready ? 'pointer' : 'default',
                fontFamily: T.sans, fontSize: 12, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}{ready ? '' : ' (drill-in)'}</button>
          )
        })}
      </div>
      {active === 'Intent Queue' && <IntentQueue />}
    </div>
  )
}

// ── Login ──────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('daniel@entuned.co')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.login(email, password)
      onLogin(r.token)
    } catch (e: any) {
      setError(e.message ?? 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      width: '100%', height: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.sans,
    }}>
      <div style={{ width: 320 }}>
        <div style={{ marginBottom: 32 }}>
          <img src="/entuned-logo-ice.svg" alt="Entuned" style={{ height: 22, width: 'auto', display: 'block' }} />
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            style={{
              background: T.surfaceRaised, border: `1px solid ${T.border}`,
              borderRadius: 4, padding: '10px 12px', color: T.text,
              fontFamily: T.sans, fontSize: 13, outline: 'none',
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={{
              background: T.surfaceRaised, border: `1px solid ${T.border}`,
              borderRadius: 4, padding: '10px 12px', color: T.text,
              fontFamily: T.sans, fontSize: 13, outline: 'none',
            }}
          />
          <button
            onClick={submit}
            disabled={busy}
            style={{
              background: T.accent, color: T.bg, border: 'none',
              borderRadius: 4, padding: '10px 12px', fontFamily: T.sans,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >{busy ? 'signing in…' : 'sign in'}</button>
          {error && <div style={{ fontSize: 12, color: T.danger, fontFamily: T.sans }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Main app ───────────────────────────────────────────────────
export function App() {
  const [token, setTokenState] = useState<string | null>(getToken)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [active, setActive] = useState('seeding')
  const [collapsed, setCollapsed] = useState(false)
  const [apiOk, setApiOk] = useState(false)

  // Verify token
  useEffect(() => {
    if (!token) return
    api.me(token).then(setMe).catch(() => {
      clearToken()
      setTokenState(null)
    })
  }, [token])

  // Health poll
  const checkHealth = useCallback(() => {
    api.health().then(() => setApiOk(true)).catch(() => setApiOk(false))
  }, [])

  useEffect(() => {
    checkHealth()
    const id = setInterval(checkHealth, 30000)
    return () => clearInterval(id)
  }, [checkHealth])

  const handleLogin = (t: string) => {
    setToken(t)
    setTokenState(t)
  }

  if (!token || !me) {
    return <Login onLogin={handleLogin} />
  }

  const activeGroup = GROUPS.find((g) => g.key === active)!

  return (
    <div style={{
      width: '100%', height: '100vh', display: 'flex',
      flexDirection: 'column', background: T.bg,
      color: T.text, fontFamily: T.sans, overflow: 'hidden',
    }}>
      <StatusBar apiOk={apiOk} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar
          active={active}
          onSelect={setActive}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          email={me.operator.email}
        />
        <PanelShell group={activeGroup} />
      </div>
    </div>
  )
}
