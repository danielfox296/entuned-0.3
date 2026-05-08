import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Plus, ExternalLink, Copy, Check, Pause, Play, Lock, Pencil, X } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'
import { Button, Input } from '../ui/index.js'
import { api, PLAYER_URL, TIER_LABEL, TIER_RANK, type StoreRow, type Tier } from '../api.js'
import { useTier } from '../lib/tier.jsx'
import content from '../content/locations.yaml'

// /locations — list of stores under this Client. v1: copyable player URL,
// pause/resume (Core+), add-location (Core+ — gated; free shows upgrade).
export function Locations() {
  const { stores, tier, loading, refresh } = useTier()
  const canAdd = TIER_RANK[tier] >= TIER_RANK.core
  const canPause = TIER_RANK[tier] >= TIER_RANK.core
  const [addOpen, setAddOpen] = useState(false)

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
          }}>{content.heading}</h1>
          <div style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>
            {content.subheading}
          </div>
        </div>
        {canAdd ? (
          <Button onClick={() => setAddOpen(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} strokeWidth={2} /> {content.add.cta}
            </span>
          </Button>
        ) : (
          <a
            href={api.checkoutUrl('core')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: `1px solid ${T.border}`,
              color: T.textMuted, padding: '8px 14px', borderRadius: 8,
              fontFamily: T.sans, fontSize: 14, textDecoration: 'none',
            }}
            title={content.add.locked_tooltip}
          >
            <Lock size={12} strokeWidth={2} /> {content.add.locked_cta}
          </a>
        )}
      </div>

      {loading ? (
        <Card>
          <div style={{ color: T.textDim, fontSize: 14 }}>{content.loading}</div>
        </Card>
      ) : stores.length === 0 ? (
        <Card>
          <EmptyState>
            {content.empty}
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

      {addOpen && (
        <AddLocationModal
          onClose={() => setAddOpen(false)}
          onAdded={refresh}
        />
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
      borderRadius: 12, padding: 20,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 12, gap: 12,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <StoreNameRow store={store} onChanged={onChanged} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 4,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
              color: T.accentMuted, textTransform: 'uppercase',
              border: `1px solid ${T.border}`, borderRadius: 8, padding: '1px 6px',
            }}>{TIER_LABEL[store.tier as Tier] ?? store.tier}</span>
            {isPaused && (
              <span style={{ fontSize: 12, color: T.warn }}>
                {content.store.paused_until_prefix}{new Date(store.pausedUntil!).toLocaleDateString()}
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

function StoreNameRow({ store, onChanged }: { store: StoreRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(store.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(store.name)
      setError(null)
      // Defer focus until input mounts.
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, store.name])

  const save = async () => {
    const trimmed = draft.trim()
    if (busy) return
    if (!trimmed) {
      setError(content.store.rename_required)
      return
    }
    if (trimmed === store.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.renameStore(store.id, trimmed)
      onChanged()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : content.store.rename_failed)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{
          fontSize: 16, fontFamily: T.heading, color: T.text, fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{store.name}</div>
        <button
          onClick={() => setEditing(true)}
          title={content.store.rename_title}
          aria-label={content.store.rename_aria}
          style={{
            background: 'transparent', border: 'none', padding: 2,
            color: T.textDim, cursor: 'pointer', borderRadius: 8,
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          <Pencil size={13} strokeWidth={1.75} />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          style={{ flex: 1, maxWidth: 360 }}
        />
        <Button onClick={save} disabled={busy}>
          {busy ? content.store.save_busy : content.store.save}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          {content.store.cancel}
        </Button>
      </div>
      {error && (
        <div style={{ color: T.danger, fontSize: 12, marginTop: 6 }}>{error}</div>
      )}
    </div>
  )
}

function AddLocationModal({ onClose, onAdded }: {
  onClose: () => void
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async () => {
    const trimmed = name.trim()
    if (busy) return
    if (!trimmed) {
      setError(content.modal.name_required)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.addStore(trimmed)
      onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : content.modal.add_failed)
      setBusy(false)
    }
  }

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          padding: 24,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <div>
            <h2 style={{
              fontFamily: T.heading, fontSize: 18, fontWeight: 600,
              color: T.text, margin: 0, letterSpacing: '-0.01em',
            }}>{content.modal.title}</h2>
            <div style={{ color: T.textDim, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
              {content.modal.body}
            </div>
          </div>
          <button
            onClick={() => !busy && onClose()}
            aria-label={content.modal.close_aria}
            style={{
              background: 'transparent', border: 'none', padding: 4,
              color: T.textDim, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center',
            }}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <label style={{
          display: 'block', fontSize: 13, color: T.textMuted,
          marginBottom: 6, fontFamily: T.sans,
        }}>
          {content.modal.name_label}
        </label>
        <Input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={content.modal.name_placeholder}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />

        {error && (
          <div style={{ color: T.danger, fontSize: 13, marginTop: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{content.modal.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? content.modal.submit_busy : content.modal.submit}
          </Button>
        </div>
      </div>
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
        borderRadius: 10, padding: '7px 12px',
        fontFamily: T.mono, fontSize: 13, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {url}
      </div>
      <button onClick={copy} style={iconBtnStyle}>
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
        {copied ? content.url_row.copied : content.url_row.copy}
      </button>
      <a href={url} target="_blank" rel="noreferrer" style={openLinkStyle}>
        <ExternalLink size={13} strokeWidth={2} /> {content.url_row.open}
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
        <Lock size={11} strokeWidth={2} /> {content.pause.locked}
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
        if (!confirm(content.pause.confirm)) {
          setBusy(false)
          return
        }
        await api.pauseStore(store.id)
      }
      onChanged()
    } catch (e: any) {
      alert(`${content.pause.failed_prefix}${e?.message ?? content.pause.failed_unknown}`)
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
        padding: '6px 12px', borderRadius: 8,
        fontFamily: T.sans, fontSize: 13,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {isPaused ? <Play size={12} strokeWidth={2} /> : <Pause size={12} strokeWidth={2} />}
      {isPaused ? content.pause.resume : content.pause.pause}
    </button>
  )
}

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'transparent', border: `1px solid ${T.border}`,
  color: T.textMuted, padding: '6px 12px', borderRadius: 8,
  fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
}

const openLinkStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: T.accent, color: T.bg,
  padding: '7px 12px', borderRadius: 8,
  fontFamily: T.sans, fontSize: 13, fontWeight: 600,
  textDecoration: 'none',
}
