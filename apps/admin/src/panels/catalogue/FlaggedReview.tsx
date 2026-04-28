import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { FlaggedSong } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, PanelHeader, S } from '../../ui/index.js'

export function FlaggedReview() {
  const [songs, setSongs] = useState<FlaggedSong[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null)
    try { const r = await api.flagged(token); setSongs(r.songs) }
    catch (e: any) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])

  const active = (songs ?? []).filter((s) => s.anyActive)
  const resolved = (songs ?? []).filter((s) => !s.anyActive)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Flagged Review"
        subtitle="Songs reported via the player. Reasons + counts come from song_report AudioEvents. Retiring a song deactivates every LineageRow that points at it."
      />

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {loading && !songs && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {songs && songs.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 4 }}>
          no songs have been reported yet
        </div>
      )}

      {active.length > 0 && (
        <Section title={`needs review (${active.length})`} songs={active} onChanged={reload} />
      )}

      {resolved.length > 0 && (
        <Section title={`already retired (${resolved.length})`} songs={resolved} onChanged={reload} muted />
      )}
    </div>
  )
}

function Section({ title, songs, onChanged, muted }: { title: string; songs: FlaggedSong[]; onChanged: () => void; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {songs.map((s) => <Card key={s.songId} song={s} onChanged={onChanged} muted={muted} />)}
      </div>
    </div>
  )
}

function Card({ song, onChanged, muted }: { song: FlaggedSong; onChanged: () => void; muted?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  const retire = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try { await api.retireFlagged(song.songId, token); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const play = () => {
    if (!song.r2Url) return
    if (audio && !audio.paused) { audio.pause(); return }
    if (audio) { audio.play(); return }
    const a = new Audio(song.r2Url)
    a.onended = () => setPlaying(false)
    a.onpause = () => setPlaying(false)
    a.onplay = () => setPlaying(true)
    a.play().catch((e) => setErr(e.message))
    setAudio(a)
  }

  const reasons = Object.entries(song.reasons).sort((a, b) => b[1] - a[1])
  const last = new Date(song.lastReportedAt)
  const lastStr = last.toISOString().slice(0, 10) + ' ' + last.toISOString().slice(11, 16)

  return (
    <div style={{
      border: `1px solid ${muted ? T.borderSubtle : T.border}`, borderRadius: 4,
      background: T.surface, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
      opacity: muted ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={play} disabled={!song.r2Url} style={{
            background: playing ? T.accent : 'transparent',
            border: `1px solid ${T.accent}`, color: playing ? T.bg : T.accent,
            width: 28, height: 28, borderRadius: 14,
            fontSize: 14, cursor: song.r2Url ? 'pointer' : 'default',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{playing ? '❚❚' : '▶'}</button>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 14, color: T.text }}>
              song <span style={{ color: T.accentMuted }}>{song.songId.slice(0, 8)}</span>
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, marginTop: 2 }}>
              last reported {lastStr} · {song.storeCount} store{song.storeCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: T.mono, fontSize: 25, color: T.danger, fontWeight: 600, lineHeight: 1 }}>{song.reportCount}</div>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, textTransform: 'uppercase' }}>reports</div>
          </div>
          {song.anyActive ? (
            <Button variant="danger" onClick={retire} busy={busy}>
              {busy ? '…' : `retire (${song.activeLineageCount})`}
            </Button>
          ) : (
            <span style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase' }}>retired</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {reasons.map(([reason, n]) => (
          <span key={reason} style={{
            fontFamily: T.mono, fontSize: 13, color: T.text,
            background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
            borderRadius: 3, padding: '3px 8px',
          }}>{reason} <span style={{ color: T.danger, fontWeight: 600, marginLeft: 4 }}>{n}</span></span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${T.borderSubtle}` }}>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, textTransform: 'uppercase' }}>
          lineage rows ({song.lineageRows.length})
        </div>
        {song.lineageRows.map((lr) => (
          <div key={lr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: T.mono, fontSize: 13 }}>
            <span style={{ color: lr.active ? T.success : T.textDim, width: 60 }}>
              {lr.active ? 'ACTIVE' : 'retired'}
            </span>
            <span style={{ color: T.textMuted, ...truncStyle }}>{lr.outcome.displayTitle ?? lr.outcome.title}</span>
            <span style={{ color: T.textDim, ...truncStyle, fontFamily: T.sans }}>· {lr.hook.text}</span>
          </div>
        ))}
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
    </div>
  )
}

const truncStyle: any = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }
