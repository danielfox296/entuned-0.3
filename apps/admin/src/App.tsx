import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Sparkles, CalendarDays, Settings, Music2,
  FlaskConical, Lightbulb, Activity, ListChecks, Target, ShoppingCart, Mail,
} from 'lucide-react'
import { api, getToken, setToken, clearToken } from './api.js'
import type { MeResponse, ClientListRow, StoreSummary, StoreDetail } from './api.js'
import { T } from './tokens.js'
import { ToastProvider, useClientSelection, useStoreSelection, useIcpSelection, HeaderSelect } from './ui/index.js'
import { useClientLogo } from './ui/clientLogo.js'
import { DecomposerRules } from './panels/engine/DecomposerRules.js'
import { FailureRules } from './panels/engine/FailureRules.js'
import { LyricPrompts } from './panels/engine/LyricPrompts.js'
import { OutcomeFactorPrompt } from './panels/engine/OutcomeFactorPrompt.js'
import { OutcomeLyricFactor } from './panels/engine/OutcomeLyricFactor.js'
import { ReferenceTrackPrompt } from './panels/engine/ReferenceTrackPrompt.js'
import { HookDrafterPrompt } from './panels/engine/HookDrafterPrompt.js'
import { IcpEditor } from './panels/brand/IcpEditor.js'
import { ClientDetail } from './panels/brand/ClientDetail.js'
import { StoreEditor } from './panels/brand/StoreEditor.js'
import { OperatorManager } from './panels/brand/OperatorManager.js'
import { Campaigns } from './panels/brand/Campaigns.js'
import { LiveStoreView } from './panels/playback/LiveStoreView.js'
import { OutcomeSchedule } from './panels/schedule/OutcomeSchedule.js'
import { OutcomeLibrary } from './panels/schedule/OutcomeLibrary.js'
import { DryRun } from './panels/schedule/DryRun.js'
import { PoolDepth } from './panels/catalogue/PoolDepth.js'
import { SongBrowser } from './panels/catalogue/SongBrowser.js'
import { FlaggedReview } from './panels/catalogue/FlaggedReview.js'
import { WorkflowRouter } from './panels/workflow/WorkflowRouter.js'
import { SalesDataIngest } from './panels/salesdata/SalesDataIngest.js'
import { EmailTemplates } from './panels/email/EmailTemplates.js'
import { useNavGroup, useNavSub } from './nav.js'

// ── Surface groups (from admin-ui.md, priority order) ──────────
interface SurfaceGroup {
  key: string; label: string; short: string; icon: LucideIcon
  cards: string[]; description: string; deferred?: boolean
}

const GROUPS: SurfaceGroup[] = [
  { key: 'workflows', label: 'Workflows', short: 'Workflows', icon: ListChecks,
    cards: ['Launch Checklist', 'Hook Writing', 'Reference Tracks', 'Hook → Prompt'],
    description: '' },
  { key: 'brand', label: 'Clients', short: 'Clients', icon: Sparkles,
    cards: ['Details', 'Location', 'ICP Editor', 'Account', 'Campaigns', 'Event Stream'],
    description: '' },
  { key: 'schedule', label: 'Scheduling', short: 'Schedule', icon: CalendarDays,
    cards: ['Dayparting'],
    description: '' },
  { key: 'outcomes', label: 'Outcomes', short: 'Outcomes', icon: Target,
    cards: ['Outcome Library', 'Style Rules', 'Lyric Rules', 'Dry Run'],
    description: '' },
  { key: 'engine', label: 'Prompts & Rules', short: 'Prompts & Rules', icon: Settings,
    cards: ['Hook Drafter', 'Decomposition', 'Style Exclusion Rules', 'Lyric Prompts', 'Reference Track Suggester'],
    description: '' },
  { key: 'catalogue', label: 'Library', short: 'Library', icon: Music2,
    cards: ['Song Browser', 'Flagged Review', 'Pool Depth'],
    description: '' },
  { key: 'salesdata', label: 'Sales Data', short: 'Sales Data', icon: ShoppingCart,
    cards: ['Ingest'],
    description: '' },
  { key: 'email', label: 'Email', short: 'Email', icon: Mail,
    cards: ['Templates'],
    description: '' },
  { key: 'experiments', label: 'Experiments', short: 'Experiments', icon: FlaskConical,
    cards: ['Experiment Editor', 'Experiment Detail', 'Results'],
    description: '', deferred: true },
  { key: 'hypothesis', label: 'Hypothesis Review', short: 'Hypotheses', icon: Lightbulb,
    cards: ['Hypothesis Queue', 'Hypothesis Detail', 'Promotion History'],
    description: '', deferred: true },
  { key: 'monitoring', label: 'Monitoring & Alerts', short: 'Monitoring', icon: Activity,
    cards: ['Alert Feed', 'Metric Source Registry'],
    description: '', deferred: true },
]

// ── Sidebar ────────────────────────────────────────────────────
function Sidebar({ active, onSelect, collapsed, onToggle, email, onLogout }: {
  active: string; onSelect: (k: string) => void
  collapsed: boolean; onToggle: () => void; email: string; onLogout: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

  // Index of the first deferred group — we render a divider above it so the
  // post-MVP entries are clearly fenced off from active surfaces.
  const firstDeferredIdx = GROUPS.findIndex((g) => g.deferred)

  return (
    <div style={{
      width: collapsed ? 48 : 168, background: T.surface,
      borderRight: `1px solid ${T.border}`, display: 'flex',
      flexDirection: 'column', flexShrink: 0,
      transition: 'width 0.2s ease', overflow: 'hidden',
    }}>
      <div onClick={onToggle} style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: collapsed ? '0 14px' : '0 14px', gap: 10,
        borderBottom: `1px solid ${T.borderSubtle}`, cursor: 'pointer', flexShrink: 0,
      }}>
        {collapsed
          ? <span style={{ fontSize: 16, color: T.accent, fontFamily: T.heading, fontWeight: 700 }}>e</span>
          : <img src="/entuned-logo-ice.svg" alt="Entuned" style={{ height: 18, width: 'auto', display: 'block' }} />
        }
      </div>

      <div style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {GROUPS.map((g, i) => {
          const on = active === g.key
          return (
            <div key={g.key}>
              {i === firstDeferredIdx && firstDeferredIdx > 0 && (
                <div style={{
                  height: 1, background: T.borderSubtle,
                  margin: '6px 14px',
                }} />
              )}
              <div onClick={() => onSelect(g.key)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '10px 14px' : '10px 14px', cursor: 'pointer',
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
                  fontSize: 14, fontFamily: T.sans, fontWeight: on ? 500 : 400,
                  color: on ? T.text : T.textMuted, whiteSpace: 'nowrap',
                }}>{g.short}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {!collapsed && (
        <div style={{ position: 'relative', borderTop: `1px solid ${T.borderSubtle}` }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            title="Account"
            style={{
              width: '100%', background: 'transparent', border: 'none',
              padding: '10px 14px', textAlign: 'left',
              fontSize: 12, color: T.textDim, fontFamily: T.sans,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >{email}</button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: 4,
                background: T.surfaceRaised, border: `1px solid ${T.border}`,
                borderRadius: 4, padding: 4, zIndex: 10,
              }}
            >
              <button
                onClick={() => { setMenuOpen(false); onLogout() }}
                style={{
                  width: '100%', background: 'transparent', border: 'none',
                  padding: '6px 10px', textAlign: 'left',
                  fontSize: 13, color: T.text, fontFamily: T.sans,
                  cursor: 'pointer', borderRadius: 3,
                }}
              >Sign out</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Panel shell ────────────────────────────────────────────────
function PanelShell({ group }: { group: SurfaceGroup }) {
  // Workflows + Brand own their headers so they can render persistent
  // selectors (client/store/ICP) inline with the title.
  const ownsHeader = group.key === 'workflows' || group.key === 'brand'
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
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: ownsHeader ? 0 : 28 }}>
        {group.key === 'workflows' ? <WorkflowRouter /> :
         group.key === 'engine' ? <EngineRouter cards={group.cards} /> :
         group.key === 'brand' ? <BrandRouter cards={group.cards} /> :
         group.key === 'schedule' ? <ScheduleRouter cards={group.cards} /> :
         group.key === 'outcomes' ? <OutcomesRouter cards={group.cards} /> :
         group.key === 'catalogue' ? <CatalogueRouter cards={group.cards} /> :
         group.key === 'salesdata' ? <SalesDataIngest /> :
         group.key === 'email' ? <EmailTemplates /> : (
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
      <div style={subTabRowStyle}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button key={c} onClick={() => setActive(c)} style={subTabBtnStyle(on)}>{c}</button>
          )
        })}
      </div>
      {active === 'Hook Drafter' && <HookDrafterPrompt />}
      {active === 'Decomposition' && <DecomposerRules />}
      {active === 'Style Exclusion Rules' && <FailureRules />}
      {active === 'Lyric Prompts' && <LyricPrompts />}
      {active === 'Reference Track Suggester' && <ReferenceTrackPrompt />}
    </div>
  )
}

// ── Brand router ───────────────────────────────────────────────
function BrandRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Details')
  const [clientId, setClientId] = useClientSelection()
  const [storeId, setStoreId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()
  const [clients, setClients] = useState<ClientListRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeDetail, setStoreDetail] = useState<StoreDetail | null>(null)
  const [, setTick] = useState(0)
  const reload = () => setTick((n) => n + 1)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.clients(token).then(setClients).catch(() => {})
    api.stores(token).then(setStores).catch(() => {})
  }, [])

  // Reconcile store when client changes — if the persisted store doesn't
  // belong to the selected client, snap to the first matching store.
  useEffect(() => {
    if (!clientId || !stores) return
    const match = stores.filter((s) => s.clientId === clientId)
    if (match.length === 0) { if (storeId) setStoreId(null); return }
    if (!storeId || !match.some((s) => s.id === storeId)) {
      setStoreId(match[0]!.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, stores])

  // Load store detail (for ICP list) when store changes; reconcile ICP.
  useEffect(() => {
    if (!storeId) { setStoreDetail(null); return }
    const token = getToken(); if (!token) return
    setStoreDetail(null)
    api.storeDetail(storeId, token).then((d) => {
      setStoreDetail(d)
      const valid = d.icps.find((i) => i.id === icpId)
      if (!valid) setIcpId(d.icps[0]?.id ?? null)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  const clientStores = stores && clientId
    ? stores.filter((s) => s.clientId === clientId)
    : []
  const selectedClient = clients?.find((c) => c.id === clientId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header: title on the left, persistent client + location selectors on the right. */}
      <div style={{
        padding: '14px 28px', borderBottom: `1px solid ${T.borderSubtle}`,
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <span style={{ display: 'inline-flex', color: T.accent }}>
          <Sparkles size={18} strokeWidth={1.75} />
        </span>
        <h1 style={{
          fontSize: 21, fontFamily: T.heading, fontWeight: 700,
          color: T.text, margin: 0, letterSpacing: '-0.02em',
        }}>Clients</h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ClientLogoThumb clientId={clientId} />
          <HeaderSelect
            label="client"
            value={clientId ?? ''}
            onChange={(v) => setClientId(v || null)}
            placeholder={clients ? '— pick a client —' : 'loading…'}
            options={(clients ?? []).map((c) => ({ value: c.id, label: c.companyName }))}
          />
          <HeaderSelect
            label="location"
            value={storeId ?? ''}
            onChange={(v) => setStoreId(v || null)}
            placeholder={!clientId ? '— pick a client first —' : (clientStores.length === 0 ? 'no locations' : '— pick a location —')}
            options={clientStores.map((s) => ({ value: s.id, label: s.name }))}
            disabled={!clientId || clientStores.length === 0}
          />
          <HeaderSelect
            label="icp"
            value={icpId ?? ''}
            onChange={(v) => setIcpId(v || null)}
            placeholder={!storeDetail ? '— pick a location —' : (storeDetail.icps.length === 0 ? 'no ICPs' : '— pick an ICP —')}
            options={(storeDetail?.icps ?? []).map((i) => ({ value: i.id, label: i.name }))}
            disabled={!storeDetail || storeDetail.icps.length === 0}
          />
        </div>
      </div>

      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={subTabRowStyle}>
          {cards.map((c) => {
            const on = active === c
            return (
              <button key={c} onClick={() => setActive(c)} style={subTabBtnStyle(on)}>{c}</button>
            )
          })}
        </div>
        {active === 'Details' && <ClientDetail onClientsChanged={() => { const tk = getToken(); if (tk) api.clients(tk).then(setClients).catch(() => {}); reload() }} selectedClient={selectedClient} />}
        {active === 'Location' && <StoreEditor onStoresChanged={() => { const tk = getToken(); if (tk) api.stores(tk).then(setStores).catch(() => {}); reload() }} />}
        {active === 'ICP Editor' && <IcpEditor />}
        {active === 'Account' && <OperatorManager />}
        {active === 'Campaigns' && <Campaigns />}
        {active === 'Event Stream' && <LiveStoreView />}
      </div>
    </div>
  )
}

function ClientLogoThumb({ clientId }: { clientId: string | null }) {
  const logo = useClientLogo(clientId)
  if (!clientId || !logo) return null
  return (
    <img
      src={logo}
      alt="client logo"
      style={{
        width: 32, height: 32, borderRadius: 4, objectFit: 'contain',
        background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
        display: 'block',
      }}
    />
  )
}

// ── Schedule router ────────────────────────────────────────────
function ScheduleRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Dayparting')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={subTabRowStyle}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button key={c} onClick={() => setActive(c)} style={subTabBtnStyle(on)}>{c}</button>
          )
        })}
      </div>
      {active === 'Dayparting' && <OutcomeSchedule />}
    </div>
  )
}

// ── Outcomes router ────────────────────────────────────────────
function OutcomesRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Outcome Library')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={subTabRowStyle}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button key={c} onClick={() => setActive(c)} style={subTabBtnStyle(on)}>{c}</button>
          )
        })}
      </div>
      {active === 'Outcome Library' && <OutcomeLibrary />}
      {active === 'Style Rules' && <OutcomeFactorPrompt />}
      {active === 'Lyric Rules' && <OutcomeLyricFactor />}
      {active === 'Dry Run' && <DryRun />}
    </div>
  )
}

// ── Shared sub-tab styles (left-justified, wrap) ───────────────
const subTabRowStyle: CSSProperties = {
  display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-start',
  borderBottom: `1px solid ${T.borderSubtle}`,
}
function subTabBtnStyle(on: boolean): CSSProperties {
  return {
    background: 'transparent', border: 'none',
    borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
    color: on ? T.text : T.textMuted,
    padding: '8px 14px', cursor: 'pointer',
    fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
    marginBottom: -1,
  }
}

// ── Catalogue router ───────────────────────────────────────────
function CatalogueRouter({ cards }: { cards: string[] }) {
  const [active, setActive] = useNavSub<string>('Song Browser')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={subTabRowStyle}>
        {cards.map((c) => {
          const on = active === c
          return (
            <button key={c} onClick={() => setActive(c)} style={subTabBtnStyle(on)}>{c}</button>
          )
        })}
      </div>
      {active === 'Pool Depth' && <PoolDepth />}
      {active === 'Song Browser' && <SongBrowser />}
      {active === 'Flagged Review' && <FlaggedReview />}
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
  const [active, setActive] = useNavGroup('workflows')
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

  const activeGroup = GROUPS.find((g) => g.key === active) ?? GROUPS[0]!

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
