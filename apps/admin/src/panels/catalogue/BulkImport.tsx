import { useEffect, useRef, useState } from 'react'
import { api, getToken } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, PanelHeader, S } from '../../ui/index.js'

// Bulk-import externally-produced instrumental MP3s into the free-tier pool.
// These tracks have no generation lineage (no Hook/SongSeed/ReferenceTrack);
// the server creates Song + LineageRow @ FREE_TIER_ICP_ID under the chosen
// outcome. Playback selects on (icpId, outcomeId, active) and never reads
// per-song tempo/arrangement, so the outcome is the only metadata required.
//
// The outcome dropdown is driven by the live FreeTierOutcome allowlist (not a
// hardcoded chill/steady/upbeat list) so it stays correct if the allowlist
// changes. Uploads are content-addressed server-side, so re-dropping the same
// files is safe — duplicates report as "already in pool".

type ItemStatus = 'queued' | 'uploading' | 'imported' | 'deduped' | 'failed'
interface Item { file: File; status: ItemStatus; detail?: string }

const ACCEPT = 'audio/mpeg,audio/mp3,.mp3'
const isMp3 = (f: File) => f.type === 'audio/mpeg' || f.type === 'audio/mp3' || /\.mp3$/i.test(f.name)

export function BulkImport() {
  const [outcomes, setOutcomes] = useState<{ title: string }[] | null>(null)
  const [outcome, setOutcome] = useState<string>('')
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.freeTierOutcomes(token)
      .then((rows) => {
        const allowed = rows.filter((r) => r.availableOnFree).map((r) => ({ title: r.title }))
        setOutcomes(allowed)
        if (allowed.length && !outcome) setOutcome(allowed[0]!.title)
      })
      .catch((e) => setErr(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addFiles = (files: File[]) => {
    const mp3s = files.filter(isMp3)
    if (mp3s.length === 0) return
    setItems((cur) => [...cur, ...mp3s.map((file) => ({ file, status: 'queued' as ItemStatus }))])
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const runImport = async () => {
    const token = getToken(); if (!token || !outcome) return
    setBusy(true); setErr(null)
    // Snapshot indices of everything not yet imported, then upload sequentially
    // (the route takes one file per request).
    const pending = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.status === 'queued' || it.status === 'failed')

    for (const { i } of pending) {
      setItems((cur) => cur.map((x, j) => j === i ? { ...x, status: 'uploading', detail: undefined } : x))
      try {
        const r = await api.importFreeTierSong(outcome, items[i]!.file, token)
        setItems((cur) => cur.map((x, j) => j === i
          ? { ...x, status: r.deduped ? 'deduped' : 'imported', detail: r.deduped ? 'already in pool' : undefined }
          : x))
      } catch (e: any) {
        setItems((cur) => cur.map((x, j) => j === i ? { ...x, status: 'failed', detail: e.message } : x))
      }
    }
    setBusy(false)
  }

  const clearDone = () => setItems((cur) => cur.filter((x) => x.status !== 'imported' && x.status !== 'deduped'))

  const counts = items.reduce(
    (acc, x) => { acc[x.status]++; return acc },
    { queued: 0, uploading: 0, imported: 0, deduped: 0, failed: 0 } as Record<ItemStatus, number>,
  )
  const pendingCount = counts.queued + counts.failed

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Bulk Import"
        subtitle="Upload externally-produced instrumental MP3s straight into the free-tier pool. Pick an outcome, drop files, import. No lineage or tempo data needed — the outcome is the only tag. Re-dropping the same files is safe; duplicates are skipped."
      />

      {err && <div style={{ color: T.danger, fontFamily: T.mono, fontSize: 14 }}>{err}</div>}

      {/* Outcome selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase' }}>outcome</span>
        {!outcomes && <span style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</span>}
        {outcomes && outcomes.length === 0 && (
          <span style={{ color: T.danger, fontFamily: T.mono, fontSize: 13 }}>
            no outcomes are on the free-tier allowlist — enable one in Free Tier Outcomes first
          </span>
        )}
        {outcomes && outcomes.length > 0 && (
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            disabled={busy}
            style={{
              background: T.surface, color: T.text, border: `1px solid ${T.border}`,
              borderRadius: 4, padding: '8px 12px', fontFamily: T.sans, fontSize: 14,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {outcomes.map((o) => <option key={o.title} value={o.title}>{o.title}</option>)}
          </select>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? T.accent : T.border}`,
          borderRadius: 6, padding: '32px 24px', textAlign: 'center',
          background: dragOver ? T.surfaceRaised : T.surface,
          cursor: 'pointer', fontFamily: T.sans, fontSize: 14, color: T.textMuted,
          transition: 'border-color 120ms, background 120ms',
        }}
      >
        drop MP3 files here, or click to choose
        <input
          ref={fileInput} type="file" accept={ACCEPT} multiple
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); if (fileInput.current) fileInput.current.value = '' }}
        />
      </div>

      {/* Action bar */}
      {items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
          <Button onClick={() => void runImport()} disabled={busy || pendingCount === 0 || !outcome}>
            {busy ? `importing… (${counts.uploading ? 'uploading' : 'done'})` : `import ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
          </Button>
          <Button variant="ghost" onClick={clearDone} disabled={busy || (counts.imported + counts.deduped === 0)}>
            clear done
          </Button>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.textMuted }}>
            {counts.imported} imported · {counts.deduped} skipped · {counts.failed} failed · {counts.queued} queued
          </span>
        </div>
      )}

      {/* File list */}
      {items.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          {items.map((x, i) => (
            <div key={`${x.file.name}-${i}`} style={{
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
              padding: '10px 12px', borderBottom: i < items.length - 1 ? `1px solid ${T.borderSubtle}` : 'none',
              fontFamily: T.mono, fontSize: 13,
            }}>
              <span style={{ color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {x.file.name}
                {x.detail && <span style={{ color: x.status === 'failed' ? T.danger : T.textMuted }}> — {x.detail}</span>}
              </span>
              <StatusBadge status={x.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, { label: string; color: string }> = {
    queued: { label: 'queued', color: T.textDim },
    uploading: { label: 'uploading…', color: T.accent },
    imported: { label: '✓ imported', color: T.accent },
    deduped: { label: '↺ skipped', color: T.textMuted },
    failed: { label: '✗ failed', color: T.danger },
  }
  const s = map[status]
  return <span style={{ color: s.color, fontFamily: T.mono, fontSize: 12, whiteSpace: 'nowrap' }}>{s.label}</span>
}
