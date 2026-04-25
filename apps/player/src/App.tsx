import { useEffect, useRef, useState, useCallback } from 'react'
import { Howl } from 'howler'
import { api, type QueueItem, type ActiveOutcome, type OutcomeOption } from './api.js'

const TOKEN_KEY = 'entuned.token'
const STORE_KEY = 'entuned.storeId'

interface Operator {
  id: string
  email: string
  isAdmin: boolean
  displayName?: string | null
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [operator, setOperator] = useState<Operator | null>(null)
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [storeId, setStoreId] = useState<string | null>(() => localStorage.getItem(STORE_KEY))
  const [authError, setAuthError] = useState<string | null>(null)

  // Verify token on mount.
  useEffect(() => {
    if (!token) return
    api.me(token).then((me) => {
      setOperator(me.operator)
      setStores(me.stores)
      if (!storeId && me.stores[0]) setStoreId(me.stores[0].id)
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
    })
  }, [token])

  useEffect(() => {
    if (storeId) localStorage.setItem(STORE_KEY, storeId)
  }, [storeId])

  if (!token || !operator) {
    return <Login onLogin={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); setAuthError(null) }} error={authError} setError={setAuthError} />
  }

  if (!storeId) {
    return <StorePicker stores={stores} onPick={setStoreId} operator={operator} onLogout={logout} />
  }

  const storeName = stores.find((s) => s.id === storeId)?.name ?? storeId
  return <Player storeId={storeId} storeName={storeName} operator={operator} token={token} onSwitchStore={() => setStoreId(null)} onLogout={logout} />

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(STORE_KEY)
    setToken(null)
    setOperator(null)
    setStoreId(null)
  }
}

// ---------- Login ----------

function Login({ onLogin, error, setError }: { onLogin: (token: string) => void; error: string | null; setError: (e: string | null) => void }) {
  const [email, setEmail] = useState('daniel@entuned.co')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Shell title="Sign in">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const r = await api.login(email, password)
            onLogin(r.token)
          } catch (err: any) {
            setError(err.message ?? 'login failed')
          } finally {
            setBusy(false)
          }
        }}
        style={{ display: 'grid', gap: '0.75rem' }}
      >
        <label>
          <div style={labelStyle}>Email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} type="email" autoComplete="email" />
        </label>
        <label>
          <div style={labelStyle}>Password</div>
          <input value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} type="password" autoComplete="current-password" />
        </label>
        <button type="submit" disabled={busy} style={buttonPrimaryStyle}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {error && <div style={{ color: '#c00' }}>{error}</div>}
      </form>
    </Shell>
  )
}

// ---------- Store picker ----------

function StorePicker({ stores, onPick, operator, onLogout }: { stores: { id: string; name: string }[]; onPick: (id: string) => void; operator: Operator; onLogout: () => void }) {
  return (
    <Shell title="Pick a store" right={<button onClick={onLogout} style={buttonGhostStyle}>Sign out ({operator.email})</button>}>
      {stores.length === 0 ? (
        <p>No stores assigned to this operator.</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {stores.map((s) => (
            <button key={s.id} onClick={() => onPick(s.id)} style={buttonPrimaryStyle}>{s.name}</button>
          ))}
        </div>
      )}
    </Shell>
  )
}

// ---------- Player ----------

function Player({ storeId, storeName, operator, token, onSwitchStore, onLogout }: { storeId: string; storeName: string; operator: Operator; token: string; onSwitchStore: () => void; onLogout: () => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [activeOutcome, setActiveOutcome] = useState<ActiveOutcome | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [fallbackTier, setFallbackTier] = useState<string>('none')
  const [outcomes, setOutcomes] = useState<OutcomeOption[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentSong, setCurrentSong] = useState<QueueItem | null>(null)

  const howlRef = useRef<Howl | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  queueRef.current = queue

  const emit = useCallback((eventType: any, song?: QueueItem | null) => {
    api.emit({
      event_type: eventType,
      store_id: storeId,
      occurred_at: new Date().toISOString(),
      operator_id: operator.id,
      song_id: song?.songId ?? null,
      hook_id: song?.hookId ?? null,
    }).catch((e) => console.warn('emit failed', e))
  }, [storeId, operator.id])

  const refill = useCallback(async () => {
    try {
      const r = await api.next(storeId)
      setActiveOutcome(r.activeOutcome)
      setReason(r.reason)
      setFallbackTier(r.fallbackTier)
      // Append new songs to the existing queue if they aren't already present.
      setQueue((prev) => {
        const have = new Set(prev.map((q) => q.songId))
        const additions = r.queue.filter((q) => !have.has(q.songId))
        return [...prev, ...additions].slice(0, 6) // soft cap
      })
      if (r.reason === 'no_pool' && !currentSong) {
        emit('playback_starved')
      }
    } catch (e) {
      console.error('refill failed', e)
    }
  }, [storeId, currentSong, emit])

  const playNext = useCallback(() => {
    const next = queueRef.current[0]
    if (!next) {
      setPlaying(false)
      setCurrentSong(null)
      // No songs — try a refill; if still empty, emit starved.
      refill()
      return
    }
    // Pop from queue.
    setQueue((prev) => prev.slice(1))
    setCurrentSong(next)

    if (howlRef.current) howlRef.current.unload()
    const h = new Howl({
      src: [next.audioUrl],
      html5: true,
      onplay: () => {
        setPlaying(true)
        emit('song_start', next)
      },
      onend: () => {
        emit('song_complete', next)
        playNext()
      },
      onloaderror: (_, err) => console.error('load error', err),
      onplayerror: (_, err) => console.error('play error', err),
    })
    howlRef.current = h
    h.play()
    // Refill if queue drops to <2 ahead of current.
    if (queueRef.current.length - 1 < 2) refill()
  }, [emit, refill])

  const skip = useCallback(() => {
    if (currentSong) emit('song_skip', currentSong)
    if (howlRef.current) {
      howlRef.current.stop()
      howlRef.current.unload()
      howlRef.current = null
    }
    playNext()
  }, [currentSong, emit, playNext])

  const startPlayback = useCallback(async () => {
    await refill()
    playNext()
  }, [refill, playNext])

  // First refill on mount.
  useEffect(() => {
    refill()
    return () => {
      if (howlRef.current) howlRef.current.unload()
    }
  }, [storeId])

  // Outcome picker data — load once and on override changes.
  useEffect(() => {
    api.outcomes(storeId).then(setOutcomes).catch(console.error)
  }, [storeId, activeOutcome?.outcomeId])

  const doOverride = async (outcomeId: string, force: boolean) => {
    const opt = outcomes.find((o) => o.outcomeId === outcomeId)
    if (opt && opt.poolSize === 0 && !force) {
      if (!confirm('No songs available for this outcome. Playback will be silent. Continue?')) return
    }
    await api.override(storeId, outcomeId, token)
    setShowPicker(false)
    // Drain current queue, refill immediately (per Card 19 frozen decision).
    setQueue([])
    await refill()
    if (!playing) playNext()
  }

  const doClearOverride = async () => {
    await api.clearOverride(storeId, token)
    setQueue([])
    await refill()
  }

  const currentOutcome = outcomes.find((o) => o.outcomeId === activeOutcome?.outcomeId)

  return (
    <Shell
      title={`Oscar · ${storeName}`}
      right={
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onSwitchStore} style={buttonGhostStyle}>Switch store</button>
          <button onClick={onLogout} style={buttonGhostStyle}>Sign out</button>
        </div>
      }
    >
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ color: '#888', fontSize: '0.85rem' }}>Active outcome</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
          {currentOutcome?.title ?? activeOutcome?.outcomeId ?? '—'}
        </div>
        <div style={{ color: '#888', fontSize: '0.85rem' }}>
          source: {activeOutcome?.source ?? '—'}
          {activeOutcome?.expiresAt && ` · expires ${new Date(activeOutcome.expiresAt).toLocaleTimeString()}`}
          {fallbackTier !== 'none' && ` · fallback: ${fallbackTier}`}
        </div>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        {currentSong ? (
          <div>
            <div style={{ color: '#888', fontSize: '0.85rem' }}>Now playing</div>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.85rem' }}>{currentSong.audioUrl.split('/').slice(-2).join('/')}</div>
          </div>
        ) : (
          <div style={{ color: '#888' }}>{reason === 'no_pool' ? 'Silent (no pool for this outcome)' : 'Idle'}</div>
        )}
      </section>

      <section style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {!playing ? (
          <button onClick={startPlayback} style={buttonPrimaryStyle}>▶ Play</button>
        ) : (
          <button onClick={skip} style={buttonPrimaryStyle}>⏭ Skip</button>
        )}
        <button onClick={() => setShowPicker((s) => !s)} style={buttonGhostStyle}>Set outcome</button>
        {activeOutcome?.source === 'override' && (
          <button onClick={doClearOverride} style={buttonGhostStyle}>Clear override</button>
        )}
      </section>

      {showPicker && (
        <section style={{ border: '1px solid #ddd', padding: '0.75rem', borderRadius: 6 }}>
          <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Outcomes (pool size in parens)</div>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {outcomes.map((o) => (
              <button
                key={o.outcomeId}
                onClick={() => doOverride(o.outcomeId, false)}
                style={{
                  ...buttonGhostStyle,
                  textAlign: 'left',
                  opacity: o.poolSize === 0 ? 0.6 : 1,
                  border: o.outcomeId === activeOutcome?.outcomeId ? '2px solid #333' : '1px solid #ccc',
                }}
              >
                {o.title} ({o.poolSize}) {o.poolSize === 0 && '· no songs yet'}
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: '1.5rem', color: '#888', fontSize: '0.8rem' }}>
        Queue depth: {queue.length}
      </section>
    </Shell>
  )
}

// ---------- shell + styles ----------

function Shell({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640, margin: '0 auto', lineHeight: 1.5 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        {right}
      </header>
      {children}
    </div>
  )
}

const labelStyle: React.CSSProperties = { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '0.5rem', fontSize: '1rem', border: '1px solid #ccc', borderRadius: 4 }
const buttonPrimaryStyle: React.CSSProperties = { padding: '0.6rem 1rem', fontSize: '1rem', background: '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }
const buttonGhostStyle: React.CSSProperties = { padding: '0.5rem 0.9rem', fontSize: '0.95rem', background: '#fff', color: '#111', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }
