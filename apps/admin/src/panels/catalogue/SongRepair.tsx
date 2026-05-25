import { useEffect, useRef, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { BrokenSongRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, PanelHeader, S } from '../../ui/index.js'

// Surfaces Songs whose r2 object is empty/corrupt (byteSize < 50KB) and still
// active in some lineage. Operator pastes a fresh Suno share URL or drops an
// mp3; server re-uploads to the existing r2ObjectKey so play history + lineage
// references stay intact.
export function SongRepair() {
  const [rows, setRows] = useState<BrokenSongRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null)
    try { setRows(await api.brokenSongs(token)) }
    catch (e: any) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Song Repair"
        subtitle="Rehydrate active songs whose audio bytes are missing or corrupt. Paste a Suno share URL (or upload an mp3) — the existing R2 object is overwritten, preserving lineage and play history."
      />

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {loading && !rows && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {rows && rows.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 4 }}>
          no broken songs — every active lineage row has playable audio
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
          {rows.map((r) => (
            <RepairRow key={r.songId} row={r} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

function RepairRow({ row, onChanged }: { row: BrokenSongRow; onChanged: () => void }) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const repair = async () => {
    const token = getToken(); if (!token || !sourceUrl.trim()) return
    setBusy(true); setErr(null); setOk(null)
    try {
      const updated = await api.repairSong(row.songId, sourceUrl.trim(), token)
      setOk(`repaired — ${updated.byteSize.toLocaleString()} bytes`)
      setSourceUrl('')
      // Brief delay so operator sees the success line, then reload list.
      setTimeout(onChanged, 800)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const repairFile = async (file: File) => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null); setOk(null)
    try {
      const updated = await api.repairSongFile(row.songId, file, token)
      setOk(`repaired — ${updated.byteSize.toLocaleString()} bytes`)
      setTimeout(onChanged, 800)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }

  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 4, padding: S.md,
      display: 'flex', flexDirection: 'column', gap: S.sm,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: S.md }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontFamily: T.sans, fontSize: 14, fontWeight: 500, color: T.text }}>
            {row.title ?? '(untitled)'}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>
            {row.icpName ?? row.icpId ?? '—'} · {row.lineageRowIds.length} active lineage row{row.lineageRowIds.length === 1 ? '' : 's'} · {row.byteSize.toLocaleString()} bytes
          </div>
          <a href={row.r2Url} target="_blank" rel="noreferrer" style={{
            fontFamily: T.mono, fontSize: 11, color: T.accent, textDecoration: 'none',
            wordBreak: 'break-all',
          }}>{row.r2Url}</a>
        </div>
      </div>

      <div style={{ display: 'flex', gap: S.sm, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <Input
          placeholder="https://suno.com/song/<uuid>  or  https://suno.com/s/<short>"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          disabled={busy}
          style={{ flex: '1 1 320px', minWidth: 240, fontFamily: T.mono, fontSize: 12 }}
        />
        <Button onClick={repair} disabled={busy || !sourceUrl.trim()} style={{ whiteSpace: 'nowrap' }}>
          {busy ? 'repairing…' : 'repair from URL'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          style={{ whiteSpace: 'nowrap' }}
        >
          upload mp3
        </Button>
        <input
          ref={fileInput} type="file" accept="audio/mpeg,audio/mp3,.mp3"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void repairFile(f) }}
        />
      </div>

      {err && <div style={{ fontSize: 12, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {ok && <div style={{ fontSize: 12, color: T.accent, fontFamily: T.mono }}>{ok}</div>}
    </div>
  )
}
