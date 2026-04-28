import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Disc3, Play, Sparkles, CalendarDays, Settings, Music2,
  FlaskConical, Lightbulb, Activity, ListChecks,
} from 'lucide-react'
import { api, getToken, setToken, clearToken } from './api.js'
import type { MeResponse } from './api.js'
import { T } from './tokens.js'
import { ToastProvider } from './ui/index.js'
import { DecomposerRules } from './panels/engine/DecomposerRules.js'
import { FailureRules } from './panels/engine/FailureRules.js'
import { StyleTemplate } from './panels/engine/StyleTemplate.js'
import { LyricPrompts } from './panels/engine/LyricPrompts.js'
import { OutcomeFactorPrompt } from './panels/engine/OutcomeFactorPrompt.js'
import { ReferenceTrackPrompt } from './panels/engine/ReferenceTrackPrompt.js'
import { HookDrafterPrompt } from './panels/engine/HookDrafterPrompt.js'
import { IcpEditor } from './panels/brand/IcpEditor.js'
import { HookQueue } from './panels/brand/HookQueue.js'
import { ClientDetail } from './panels/brand/ClientDetail.js'
import { StoreEditor } from './panels/brand/StoreEditor.js'
import { OperatorManager } from './panels/brand/OperatorManager.js'
import { ClosedSongSeeds } from './panels/seeding/ClosedSongSeeds.js'
import { LiveStoreView } from './panels/playback/LiveStoreView.js'
import { OutcomeSchedule } from './panels/schedule/OutcomeSchedule.js'
import { OutcomeLibrary } from './panels/schedule/OutcomeLibrary.js'
import { DryRun } from './panels/schedule/DryRun.js'
import { PoolDepth } from './panels/catalogue/PoolDepth.js'
import { SongBrowser } from './panels/catalogue/SongBrowser.js'
import { FlaggedReview } from './panels/catalogue/FlaggedReview.js'
import { RetiredSongs } from './panels/catalogue/RetiredSongs.js'
import { SongSeedQueue } from './panels/seeding/SongSeedQueue.js'
import { SongSeed } from './panels/seeding/SongSeed.js'
import { WorkflowRouter } from './panels/workflow/WorkflowRouter.js'
import { useNavGroup, useNavSub } from './nav.js'

// ── Surface groups (from admin-ui.md, priority order) ──────────
interface SurfaceGroup {
  key: string; label: string; short: string; icon: LucideIcon
  cards: string[]; description: string; deferred?: boolean
}

const GROUPS: SurfaceGroup[] = [
  { key: 'workflows', label: 'Workflows', short: 'Workflows', icon: ListChecks,
    cards: ['Pre-Launch Checklist', 'Hook Refresh', 'Reference Track Refresh', 'Hook → Prompt'],
    description: 'Multi-step actions for the selected client, store, and ICP' },
  { key: 'seeding', label: 'Song Creation', short: 'Creation', icon: Disc3,
    cards: ['Song Seed Queue', 'Song Seed', 'Closed Song Seeds'],
    description: 'Claim song seeds, paste to Suno, accept or close takes' },
  { key: 'playback', label: 'Playback & Overrides', short: 'Playback', icon: Play,
    cards: ['Live Store View', 'Mode Override', 'Interrupt Controls'],
    description: "What's playing now, override outcomes, skip/pause" },
  { key: 'brand', label: 'Client & Brand', short: 'Brand', icon: Sparkles,
    cards: ['Client Detail', 'ICP Editor', 'Hook Queue', 'Store Editor', 'Operator Manager'],
    description: 'ICP profiles, hooks, reference tracks, store config' },
  { key: 'schedule', label: 'Scheduling', short: 'Schedule', icon: CalendarDays,
    cards: ['Outcome Schedule', 'Outcome Library', 'Dry Run'],
    description: 'Weekly outcome grids, schedule preview' },
  { key: 'engine', label: 'Engine', short: 'Engine', icon: Settings,
    cards: ['Hook Drafter', 'Track Analyzer Rules', 'Style Exclusion Rules', 'Style Template', 'Lyric Prompts', 'Outcome Factor Prompt', 'Reference Track Suggester'],
    description: 'System-level prompts that drive decomposer, Mars, and Bernie' },
  { key: 'catalogue', label: 'Song Catalogue', short: 'Catalogue', icon: Music2,
    cards: ['Song Browser', 'Flagged Review', 'Retired Songs', 'Pool Depth'],
    description: 'Browse songs, review flags, monitor pool depth' },
  { key: 'experiments', label: 'Experiments', short: 'Experiments', icon: FlaskConical,
    cards: ['Experiment Editor', 'Experiment Detail', 'Results'],
    description: 'A/B tests, arm pools, conclusions', deferred: true },
  { key: 'hypothesis', label: 'Hypothesis Review', short: 'Hypotheses', icon: Lightbulb,
    cards: ['Hypothesis Queue', 'Hypothesis Detail', 'Promotion History'],
    description: 'Kraftwerk output review, promote or reject', deferred: true },
  { key: 'monitoring', label: 'Monitoring & Alerts', short: 'Monitoring', icon: Activity,
    cards: ['Alert Feed', 'Metric Source Registry'],
    description: 'Pool alerts, experiment gates, system health', deferred: true },
]

// ── Sidebar ────────────────────────────────────────────────────
function Sidebar({ active, onSelect, collapsed, onToggle, email, onLogout }: {
  active: string; onSelect: (k: string) => void
  collapsed: boolean; onToggle: () => void; email: string; onLogout: () => void
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
                width: 18, display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0,
                color: on ? T.accent : T.textMuted,
              }}>
                <g.icon size={16} strokeWidth={1.75} />
              </span>
              {!collapsed && <span style={{
                fontSize: 15, fontFamily: T.sans, fontWeight: on ? 500 : 400,
                color: on ? T.text : T.textMuted, whiteSpace: 'nowrap',
              }}>{g.short}</span>}
            </div>
          )
        })}
      </div>

      {!collapsed && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.borderSubtle}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
          <button
            onClick={onLogout}
            title="Sign out"
            style={{
              background: 'transparent', border: `1px solid ${T.border}`,
              color: T.textMuted, padding: '3px 8px', borderRadius: 2,
              fontFamily: T.mono, fontSize: 12, cursor: 'pointer', flexShrink: 0,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}
          >sign out</button>
        </div>
      )}
    </div>
  )
}

// ── Panel shell ────────────────────────────────────────────────
function PanelShell({ group }: { group: SurfaceGroup }) {
  // Workflows owns its own header so it can render the persistent
  // client/store/ICP selector inline with the title.
  const ownsHeader = group.key === 'workflows'
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {!ownsHeader && (
        <div style={{ padding: '20px 28px 16px', borderBottom: `1px solid ${T.borderSubtle}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ display: 'inline-flex', color: T.accent }}>
              <group.icon size={18} strokeWidth={1.75} />
            </span>
            <h1 style={{
              fontSize: 21, fontFamily: T.heading, fontWeight: 700,
              color: T.text, margin: 0, letterSpacing: '-0.02em',
            }}>{group.label}</h1>
            {group.deferred && <span style={{
              fontSize: 13, fontFamily: T.sans, color: T.textDim,
              background: T.surfaceRaised, padding: '2px 8px', borderRadius: 3,
              border: `1px solid ${T.borderSubtle}`,
            }}>deferred</span>}
          </div>
          <p style={{ fontSize: 14, color: T.textMuted, fontFamily: T.sans, margin: '6px 0 0' }}>
            {group.description}
          </p>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: ownsHeader ? 0 : 28 }}>
        {group.key === 'workflows' ? <WorkflowRouter /> :
         group.key === 'engine' ? <EngineRouter cards={group.cards} /> :
         group.key === 'brand' ? <BrandRouter cards={group.cards} /> :
         group.key === 'playback' ? <PlaybackRouter cards={group.cards} /> :
         group.key === 'schedule' ? <ScheduleRouter cards={group.cards} /> :
         group.key === 'seeding' ? <SeedingRouter cards={group.cards} /> :
         group.key === 'catalogue' ? <CatalogueRouter cards={group.cards} /> : (
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
              <div style={{ fontSize: 16, fontFamily: T.sans, fontWeight: 500, color: T.text, marginBottom: 8 }}>
                {card}
              </div>
              <div style={{ fontSize: 14, fontFamily: T.sans, color: group.deferred ? T.textDim : T.accent }}>
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
            <div style={{ fontSize: 15, fontFamily: T.sans, color: T.textMuted, lineHeight: 1.6 }}>
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
  const [active, setActive] = useNavSub<string>(cards[0]!)
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
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}</button>
          )
        })}
      </div>
      {active === 'Hook Drafter' && <HookDrafterPrompt />}
      {active === 'Track Analyzer Rules' && <DecomposerRules />}
      {active === 'Style Exclusion Rules' && <FailureRules />}
      {active === 'Style Template' && <StyleTemplate />}
      {active === 'Lyric Prompts' && <LyricPrompts />}
      {active === 'Outcome Factor Prompt' && <OutcomeFactorPrompt />}
      {active === 'Reference Track Suggester' && <ReferenceTrackPrompt />}
    </div>
  )
}

// ── Brand router ───────────────────────────────────────────────
function BrandRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Client Detail')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
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
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}</button>
          )
        })}
      </div>
      {active === 'Client Detail' && <ClientDetail />}
      {active === 'ICP Editor' && <IcpEditor />}
      {active === 'Hook Queue' && <HookQueue />}
      {active === 'Store Editor' && <StoreEditor />}
      {active === 'Operator Manager' && <OperatorManager />}
    </div>
  )
}

// ── Playback router ────────────────────────────────────────────
function PlaybackRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Live Store View')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          const ready = c === 'Live Store View'
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
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
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
  const [active, setActive] = useNavSub<string>('Outcome Schedule')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          const ready = c === 'Outcome Schedule' || c === 'Outcome Library' || c === 'Dry Run'
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
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}{ready ? '' : ' (soon)'}</button>
          )
        })}
      </div>
      {active === 'Outcome Schedule' && <OutcomeSchedule />}
      {active === 'Outcome Library' && <OutcomeLibrary />}
      {active === 'Dry Run' && <DryRun />}
    </div>
  )
}

// ── Catalogue router ───────────────────────────────────────────
function CatalogueRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Song Browser')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button
              key={c}
              onClick={() => setActive(c)}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : T.textMuted,
                padding: '8px 14px', cursor: 'pointer',
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}</button>
          )
        })}
      </div>
      {active === 'Pool Depth' && <PoolDepth />}
      {active === 'Song Browser' && <SongBrowser />}
      {active === 'Flagged Review' && <FlaggedReview />}
      {active === 'Retired Songs' && <RetiredSongs />}
    </div>
  )
}

// ── Seeding router ─────────────────────────────────────────────
function SeedingRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Song Seed Queue')
  const [detailId, setDetailId] = useState<string>('')
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button
              key={c}
              onClick={() => { setActive(c); if (c !== 'Song Seed') setOpenId(null) }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                color: on ? T.text : T.textMuted,
                padding: '8px 14px', cursor: 'pointer',
                fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                marginBottom: -1,
              }}
            >{c}</button>
          )
        })}
      </div>
      {active === 'Song Seed Queue' && <SongSeedQueue />}
      {active === 'Closed Song Seeds' && <ClosedSongSeeds />}
      {active === 'Song Seed' && (
        openId ? (
          <SongSeed songSeedId={openId} onClose={() => setOpenId(null)} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
            <div style={{ fontFamily: T.sans, fontSize: 14, color: T.textMuted }}>
              Per-song-seed drill-in. Normally reached by clicking a row in Song Seed Queue. Paste a song seed ID to open it directly.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={detailId}
                onChange={(e) => setDetailId(e.target.value)}
                placeholder="song seed id"
                style={{
                  flex: 1, background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
                  color: T.text, padding: '8px 10px', fontFamily: T.mono, fontSize: 14,
                }}
              />
              <button
                onClick={() => { if (detailId.trim()) setOpenId(detailId.trim()) }}
                disabled={!detailId.trim()}
                style={{
                  background: T.accent, border: 'none', color: T.bg,
                  padding: '8px 14px', fontFamily: T.sans, fontSize: 14, fontWeight: 500,
                  cursor: detailId.trim() ? 'pointer' : 'default',
                  opacity: detailId.trim() ? 1 : 0.4,
                }}
              >Open</button>
            </div>
          </div>
        )
      )}
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
              fontFamily: T.sans, fontSize: 15, outline: 'none',
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
              fontFamily: T.sans, fontSize: 15, outline: 'none',
            }}
          />
          <button
            onClick={submit}
            disabled={busy}
            style={{
              background: T.accent, color: T.bg, border: 'none',
              borderRadius: 4, padding: '10px 12px', fontFamily: T.sans,
              fontSize: 15, fontWeight: 600, cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >{busy ? 'signing in…' : 'sign in'}</button>
          {error && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.sans }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Main app ───────────────────────────────────────────────────
export function App() {
  const [token, setTokenState] = useState<string | null>(getToken)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [active, setActive] = useNavGroup('seeding')
  const [collapsed, setCollapsed] = useState(false)

  // Verify token
  useEffect(() => {
    if (!token) return
    api.me(token).then(setMe).catch(() => {
      clearToken()
      setTokenState(null)
    })
  }, [token])

  const handleLogin = (t: string) => {
    setToken(t)
    setTokenState(t)
  }

  const handleLogout = () => {
    clearToken()
    setTokenState(null)
    setMe(null)
  }

  if (!token || !me) {
    return (
      <ToastProvider>
        <Login onLogin={handleLogin} />
      </ToastProvider>
    )
  }

  const activeGroup = GROUPS.find((g) => g.key === active)!

  return (
    <ToastProvider>
      <div style={{
        width: '100%', height: '100vh', display: 'flex',
        flexDirection: 'column', background: T.bg,
        color: T.text, fontFamily: T.sans, overflow: 'hidden',
      }}>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <Sidebar
            active={active}
            onSelect={setActive}
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
            email={me.operator.email}
            onLogout={handleLogout}
          />
          <PanelShell group={activeGroup} />
        </div>
      </div>
    </ToastProvider>
  )
}
