import { useState, type CSSProperties } from 'react'
import { Plus, ExternalLink, Copy, Check, Pause, Play, Lock } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'
import { Button } from '../ui/index.js'
import { api, PLAYER_URL, TIER_LABEL, TIER_RANK, type StoreRow, type Tier } from '../api.js'
import { useTier } from '../lib/tier.jsx'

// /locations — list of stores under this Client. v1: copyable player URL,
// pause/resume (Core+), add-location (Core+ — gated; free shows upgrade).
export function Locations() {
  const { stores, tier, loading, refresh } = useTier()
  const canAdd = TIER_RANK[tier] >= TIER_RANK.core
  const canPause = TIER_RANK[tier] >= TIER_RANK.core

  return (
    <Layout>
      <div style={{
        marginBottom: 24, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{
            fontFamily: T.heading, fontSize: 28, fontWeight: 700,
            color: T.text, letterSpacing: '-0.02em', margin: 0,
          }}>Locations</h1>
          <div style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>
            Each location streams its own music feed.
          </div>
        </div>
        {canAdd ? (
          <Button onClick={() => alert('Add location ships in v1.5')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} strokeWidth={2} /> Add location
            </span>
          </Button>
        ) : (
          <a
            href={api.checkoutUrl('core')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: `1px solid ${T.border}`,
              color: T.textMuted, padding: '8px 14px', borderRadius: 3,
              fontFamily: T.sans, fontSize: 14, textDecoration: 'none',
            }}
            title="Add location requires Core"
          >
            <Lock size={12} strokeWidth={2} /> Add location · Core
          </a>
        )}
      </div>

      {loading ? (
        <Card>
          <div style={{ color: T.textDim, fontSize: 14 }}>Loading locations…</div>
        </Card>
      ) : stores.length === 0 ? (
        <Card>
          <EmptyState>
            No locations yet. Once you upgrade to Core, we will provision a player URL
            you can open on any in-store device.
          </EmptyState>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {stores.map((s) => (
            <StoreCard
              key={s.id}
              store={s}
              canPause={canPause}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </Layout>
  )
}

function StoreCard({ store, canPause, onChanged }: {
  store: StoreRow
  canPause: boolean
  onChanged: () => void
}) {
  const url = `${PLAYER_URL}/${store.slug}`
  const isPaused = !!store.pausedUntil && new Date(store.pausedUntil) > new Date()

  return (
    <div style={{
      background: T.surfaceRaised,
      border: `1px solid ${T.border}`,
      borderRadius: 6, padding: 20,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 12, gap: 12,
      }}>
        <div>
          <div style={{
            fontSize: 16, fontFamily: T.heading, color: T.text,
            fontWeight: 500,
          }}>{store.name}</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 4,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
              color: T.accentMuted, textTransform: 'uppercase',
              border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 6px',
            }}>{TIER_LABEL[store.tier as Tier] ?? store.tier}</span>
            {isPaused && (
              <span style={{ fontSize: 12, color: T.warn }}>
                Paused until {new Date(store.pausedUntil!).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <PauseControl
          store={store}
          canPause={canPause}
          isPaused={isPaused}
          onChanged={onChanged}
        />
      </div>
      <PlayerUrlRow url={url} />
    </div>
  )
}

function PlayerUrlRow({ url }: { url: string }) {
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
        borderRadius: 4, padding: '7px 12px',
        fontFamily: T.mono, fontSize: 13, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {url}
      </div>
      <button onClick={copy} style={iconBtnStyle}>
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a href={url} target="_blank" rel="noreferrer" style={openLinkStyle}>
        <ExternalLink size={13} strokeWidth={2} /> Open
      </a>
    </div>
  )
}

function PauseControl({ store, canPause, isPaused, onChanged }: {
  store: StoreRow
  canPause: boolean
  isPaused: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  if (!canPause) {
    return (
      <span style={{
        fontSize: 12, color: T.textFaint, fontFamily: T.sans,
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
        <Lock size={11} strokeWidth={2} /> Pause · Core
      </span>
    )
  }

  // Even on Core+, pause requires a real subscription (free stores under a paid Client can't pause)
  if (!store.subscription) {
    return null
  }

  const handle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (isPaused) {
        await api.resumeStore(store.id)
      } else {
        if (!confirm('Pause this location for up to 60 days? Music stops; you stop being charged. You can resume anytime.')) {
          setBusy(false)
          return
        }
        await api.pauseStore(store.id)
      }
      onChanged()
    } catch (e: any) {
      alert(`Failed: ${e?.message ?? 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handle}
      disabled={busy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'transparent',
        border: `1px solid ${isPaused ? T.accent : T.border}`,
        color: isPaused ? T.accent : T.textMuted,
        padding: '6px 12px', borderRadius: 3,
        fontFamily: T.sans, fontSize: 13,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {isPaused ? <Play size={12} strokeWidth={2} /> : <Pause size={12} strokeWidth={2} />}
      {isPaused ? 'Resume' : 'Pause'}
    </button>
  )
}

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'transparent', border: `1px solid ${T.border}`,
  color: T.textMuted, padding: '6px 12px', borderRadius: 3,
  fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
}

const openLinkStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: T.accent, color: T.bg,
  padding: '7px 12px', borderRadius: 3,
  fontFamily: T.sans, fontSize: 13, fontWeight: 600,
  textDecoration: 'none',
}
