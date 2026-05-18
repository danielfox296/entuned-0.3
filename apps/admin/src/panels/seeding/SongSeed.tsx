import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { SongSeedDetail, StyleExclusionRuleRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, Textarea, Section, S } from '../../ui/index.js'

type Editable = {
  title: string
  lyrics: string
  style: string
  negativeStyle: string
  vocalGender: '' | 'male' | 'female' | 'duet' | 'instrumental'
}

function pickEditable(d: SongSeedDetail): Editable {
  return {
    title: d.title ?? '',
    lyrics: d.lyrics ?? '',
    style: d.style ?? '',
    negativeStyle: d.negativeStyle ?? '',
    vocalGender: (d.vocalGender as Editable['vocalGender']) ?? '',
  }
}

function diff(a: Editable, b: Editable): Partial<Editable> {
  const out: Partial<Editable> = {}
  if (a.title !== b.title) out.title = b.title
  if (a.lyrics !== b.lyrics) out.lyrics = b.lyrics
  if (a.style !== b.style) out.style = b.style
  if (a.negativeStyle !== b.negativeStyle) out.negativeStyle = b.negativeStyle
  if (a.vocalGender !== b.vocalGender) out.vocalGender = b.vocalGender
  return out
}

export function SongSeed({ songSeedId, onClose, embedded }: { songSeedId: string; onClose: () => void; embedded?: boolean }) {
  const [data, setData] = useState<SongSeedDetail | null>(null)
  const [edits, setEdits] = useState<Editable | null>(null)
  const [baseline, setBaseline] = useState<Editable | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [takes, setTakes] = useState<{ sourceUrl: string }[]>([{ sourceUrl: '' }, { sourceUrl: '' }])
  const [exclusionRules, setExclusionRules] = useState<StyleExclusionRuleRow[] | null>(null)
  const [showFiredRules, setShowFiredRules] = useState(false)
  const [uploadMode, setUploadMode] = useState<'urls' | 'files'>('urls')
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)

  const load = useCallback(async () => {
    const token = getToken(); if (!token) return
    try {
      const d = await api.songSeedDetail(songSeedId, token)
      setData(d)
      const e = pickEditable(d)
      setEdits(e)
      setBaseline(e)
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [songSeedId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const token = getToken(); if (!token) return
    api.styleExclusionRules(token).then(setExclusionRules).catch(() => { /* non-fatal */ })
  }, [])

  const dirty = useMemo(() => {
    if (!edits || !baseline) return false
    return Object.keys(diff(baseline, edits)).length > 0
  }, [edits, baseline])

  const save = useCallback(async (): Promise<boolean> => {
    if (!edits || !baseline) return true
    const patch = diff(baseline, edits)
    if (Object.keys(patch).length === 0) return true
    const token = getToken(); if (!token) return false
    setBusy('save'); setErr(null)
    try {
      const body: any = { ...patch }
      if ('vocalGender' in body) {
        body.vocalGender = body.vocalGender === '' ? null : body.vocalGender
      }
      const updated = await api.updateSongSeed(songSeedId, body, token)
      setData(updated)
      const e = pickEditable(updated)
      setEdits(e)
      setBaseline(e)
      setBusy(null)
      return true
    } catch (e: any) {
      setErr(e.message ?? 'save failed')
      setBusy(null)
      return false
    }
  }, [edits, baseline, songSeedId])

  const del = async () => {
    const token = getToken(); if (!token) return
    setBusy('delete'); setErr(null)
    try {
      await api.deleteSongSeed(songSeedId, token)
      onClose()
    } catch (e: any) { setErr(e.message); setBusy(null) }
  }

  const accept = async () => {
    const token = getToken(); if (!token) return
    setBusy('accept'); setErr(null)
    try {
      // Save any pending edits before accepting — operator submits with their
      // current state of the prompt, even if they forgot to save first.
      if (dirty) {
        const ok = await save()
        if (!ok) return
        setBusy('accept')
      }
      if (uploadMode === 'files') {
        if (droppedFiles.length === 0) { setErr('Drop at least one MP3 file.'); setBusy(null); return }
        await api.uploadSongSeedFiles(songSeedId, droppedFiles, token)
      } else {
        const validTakes = takes.filter((t) => t.sourceUrl.trim())
        if (validTakes.length === 0) { setErr('Add at least one source URL.'); setBusy(null); return }
        await api.acceptSongSeed(songSeedId, { takes: validTakes }, token)
      }
      await load()
      onClose()
    } catch (e: any) { setErr(e.message); setBusy(null) }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === 'audio/mpeg' || f.name.endsWith('.mp3'))
    if (files.length) setDroppedFiles((prev) => [...prev, ...files])
  }

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
  }

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }

  if (!data || !edits) {
    return (
      <div>
        {!embedded && <Button variant="ghost" onClick={onClose}>← back</Button>}
        {err
          ? <div style={{ marginTop: 12, color: T.danger, fontFamily: T.sans }}>{err}</div>
          : <div style={{ marginTop: 12, color: T.textMuted, fontFamily: T.sans }}>loading…</div>}
      </div>
    )
  }

  const isQueued = data.status === 'queued'
  const statusColor = statusColorOf(data.status)
  const ref = data.referenceTrack as { artist?: string; title?: string; coverUrl?: string | null; previewUrl?: string | null } | null
  const outcomeName = (data.outcome?.displayTitle ?? data.outcome?.title) as string | undefined
  const outcomeContext = [
    data.outcome?.mood && `mood: ${data.outcome.mood}`,
    typeof data.outcome?.tempoBpm === 'number' && `${data.outcome.tempoBpm} bpm`,
    data.outcome?.mode && `${data.outcome.mode} key`,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!embedded && <Button variant="ghost" onClick={onClose}>← back</Button>}
        <span style={{ fontSize: S.subhead, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>
          {edits.title || data.hook.text}
        </span>
        <span style={{
          fontSize: S.label, fontFamily: T.sans,
          color: statusColor,
          border: `1px solid ${statusColor}`, borderRadius: S.r3, padding: '2px 8px',
        }}>{data.status}</span>
        <div style={{ flex: 1 }} />
        {isQueued && (
          <Button
            variant={dirty ? 'primary' : 'ghost'}
            onClick={save}
            disabled={!dirty || busy === 'save'}
            busy={busy === 'save'}
          >
            {dirty ? 'save' : 'saved'}
          </Button>
        )}
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {/* Two columns: context on the left, editable prompt fields on the right. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: S.lg, alignItems: 'start' }}>
        {/* Left: reference track, ICP, outcome */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
          <ContextCard label="Reference track">
            {ref ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {ref.coverUrl ? (
                    <img
                      src={ref.coverUrl}
                      alt={`${ref.artist} — ${ref.title}`}
                      style={{
                        width: 88, height: 88, borderRadius: 4, objectFit: 'cover',
                        border: `1px solid ${T.borderSubtle}`, flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div style={{
                      width: 88, height: 88, borderRadius: 4,
                      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      color: T.textDim, fontFamily: T.mono, fontSize: 20, flexShrink: 0,
                    }}>♪</div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontFamily: T.sans, color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ref.title ?? '—'}
                    </div>
                    <div style={{ fontSize: 12, fontFamily: T.mono, color: T.textMuted, marginTop: 2 }}>
                      {ref.artist ?? '—'}
                    </div>
                  </div>
                </div>
                {ref.previewUrl ? (
                  <audio controls src={ref.previewUrl} style={{ width: '100%', height: 32 }} />
                ) : (
                  <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim }}>no preview</div>
                )}
              </div>
            ) : (
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>no reference track</div>
            )}
          </ContextCard>

          <ContextCard label="ICP">
            <div style={{ fontSize: 14, fontFamily: T.sans, color: T.text }}>
              {data.icp?.name ?? '—'}
            </div>
          </ContextCard>

          <ContextCard label="Outcome">
            <div style={{ fontSize: 14, fontFamily: T.sans, color: T.text }}>
              {outcomeName ?? '—'}
            </div>
            {outcomeContext && (
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, marginTop: 4 }}>
                {outcomeContext}
              </div>
            )}
          </ContextCard>
        </div>

        {/* Right: editable prompt fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Lyrics" onCopy={() => copyToClipboard(edits.lyrics)} readOnly={!isQueued}>
            <Textarea
              value={edits.lyrics}
              onChange={(e) => setEdits({ ...edits, lyrics: e.target.value })}
              readOnly={!isQueued}
              rows={14}
              style={{ background: T.bg, fontFamily: T.mono } as CSSProperties}
            />
          </Field>
          <Field label="Style" onCopy={() => copyToClipboard(edits.style)} readOnly={!isQueued}>
            <Textarea
              value={edits.style}
              onChange={(e) => setEdits({ ...edits, style: e.target.value })}
              readOnly={!isQueued}
              rows={4}
              style={{ background: T.bg, fontFamily: T.mono } as CSSProperties}
            />
          </Field>
          <Field label="Style exclusions" onCopy={() => copyToClipboard(edits.negativeStyle)} readOnly={!isQueued}>
            <Textarea
              value={edits.negativeStyle}
              onChange={(e) => setEdits({ ...edits, negativeStyle: e.target.value })}
              readOnly={!isQueued}
              rows={3}
              style={{ background: T.bg, fontFamily: T.mono } as CSSProperties}
            />
          </Field>
          <Field label="Title" onCopy={() => copyToClipboard(edits.title)} readOnly={!isQueued}>
            <Input
              value={edits.title}
              onChange={(e) => setEdits({ ...edits, title: e.target.value })}
              readOnly={!isQueued}
              style={{ background: T.bg, fontFamily: T.mono } as CSSProperties}
            />
          </Field>
          <Field label="Vocal gender" readOnly={!isQueued}>
            <select
              value={edits.vocalGender}
              onChange={(e) => setEdits({ ...edits, vocalGender: e.target.value as Editable['vocalGender'] })}
              disabled={!isQueued}
              style={{
                background: T.bg, color: T.text, border: `1px solid ${T.border}`,
                borderRadius: 3, padding: '8px 10px', fontFamily: T.mono, fontSize: 14, outline: 'none',
              }}
            >
              <option value="">— unset —</option>
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="duet">duet</option>
              <option value="instrumental">instrumental</option>
            </select>
          </Field>

          {data.firedExclusionRuleIds.length > 0 && (
            <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textDim, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowFiredRules((v) => !v)}
                style={{
                  background: 'transparent', border: 'none', color: T.textDim,
                  fontFamily: T.sans, fontSize: S.label, cursor: 'pointer', padding: 0,
                  textDecoration: 'underline dotted', textUnderlineOffset: 3,
                }}
              >
                {showFiredRules ? '▾' : '▸'} fired {data.firedExclusionRuleIds.length} exclusion rule(s)
              </button>
              {showFiredRules && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 14 }}>
                  {data.firedExclusionRuleIds.map((rid) => {
                    const rule = exclusionRules?.find((r) => r.id === rid)
                    if (!rule) return (
                      <div key={rid} style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
                        {rid} <span style={{ fontStyle: 'italic' }}>(rule no longer exists)</span>
                      </div>
                    )
                    return (
                      <div key={rid} style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
                        <span style={{ color: T.accentMuted }}>{rule.triggerField}={rule.triggerValue}</span>
                        <span style={{ color: T.textDim }}> → exclude </span>
                        <span style={{ color: T.text }}>{rule.exclude}</span>
                        {rule.note && <span style={{ color: T.textDim, fontStyle: 'italic' }}> · {rule.note}</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Accept takes flow (full width, below the columns) */}
      {isQueued && (
        <div style={{
          background: T.accentGlow, border: `2px solid ${T.accent}`,
          borderRadius: 6, padding: 18,
        }}>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: S.subhead, fontFamily: T.heading, fontWeight: 700, color: T.text, flex: 1 }}>
              ⬇ Accept takes
            </div>
            <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: `1px solid ${T.accentMuted}` }}>
              {(['urls', 'files'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setUploadMode(m)}
                  style={{
                    padding: '4px 12px', fontFamily: T.sans, fontSize: S.label,
                    background: uploadMode === m ? T.accent : 'transparent',
                    color: uploadMode === m ? T.bg : T.textMuted,
                    border: 'none', cursor: 'pointer',
                  }}
                >{m === 'urls' ? 'paste URLs' : 'upload files'}</button>
              ))}
            </div>
          </div>

          {uploadMode === 'urls' ? (
            <>
              <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textMuted, marginBottom: 10 }}>
                The server will download and re-host the audio. One URL per take.
              </div>
              {takes.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <Input
                    value={t.sourceUrl}
                    onChange={(e) => setTakes(takes.map((x, j) => j === i ? { sourceUrl: e.target.value } : x))}
                    placeholder={`take ${i + 1} — paste https://suno.com/s/... or https://suno.com/song/...`}
                    style={{ fontSize: 15, padding: '12px 14px', background: T.bg, borderColor: T.accentMuted } as CSSProperties}
                  />
                </div>
              ))}
              <Button variant="tiny" onClick={() => setTakes([...takes, { sourceUrl: '' }])}>+ add take</Button>
            </>
          ) : (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? T.accent : T.accentMuted}`,
                  borderRadius: 6, padding: '28px 20px', textAlign: 'center',
                  cursor: 'pointer', marginBottom: 10,
                  background: dragOver ? T.accentGlow : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ fontFamily: T.sans, fontSize: S.body, color: T.textMuted }}>
                  drag & drop MP3 files here, or click to browse
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,audio/mpeg"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length) setDroppedFiles((prev) => [...prev, ...files])
                    e.target.value = ''
                  }}
                />
              </div>
              {droppedFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  {droppedFiles.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.sans, fontSize: S.small, color: T.textMuted }}>
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ color: T.textDim }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      <button
                        type="button"
                        onClick={() => setDroppedFiles((prev) => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: T.danger, cursor: 'pointer', padding: '0 4px' }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }} />
            {dirty && (
              <span style={{ fontSize: S.small, color: T.warn, fontFamily: T.mono }}>
                unsaved edits will save when you submit
              </span>
            )}
            <Button
              onClick={accept}
              disabled={uploadMode === 'urls' ? takes.every((t) => !t.sourceUrl.trim()) : droppedFiles.length === 0}
              busy={busy === 'accept'}
            >
              {busy === 'accept'
                ? (uploadMode === 'files' ? 'uploading…' : 'downloading + uploading…')
                : 'accept takes'}
            </Button>
          </div>
        </div>
      )}

      {data.lineageRows && data.lineageRows.length > 0 && (
        <Section title="Song Entries">
          {data.lineageRows.map((r: any) => (
            <div key={r.id} style={{ fontSize: S.small, fontFamily: T.sans, color: T.textMuted, padding: '4px 0' }}>
              entry {r.id.slice(0, 8)}{r.active ? '' : ' (retired)'}
            </div>
          ))}
        </Section>
      )}

      {data.errorText && (
        <Section title="Error">
          <div style={{ fontSize: S.small, fontFamily: T.sans, color: T.danger, whiteSpace: 'pre-wrap' }}>
            {data.errorText}
          </div>
        </Section>
      )}

      {isQueued && (
        <div style={{
          marginTop: 4, paddingTop: 14, borderTop: `1px solid ${T.borderSubtle}`,
          display: 'flex', justifyContent: 'flex-start',
        }}>
          <Button variant="danger" onClick={del} busy={busy === 'delete'}>
            delete song prompt
          </Button>
        </div>
      )}
    </div>
  )
}

function ContextCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, padding: '12px 14px',
    }}>
      <div style={{
        fontSize: S.label, color: T.textDim, fontFamily: T.sans,
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8,
      }}>{label}</div>
      {children}
    </div>
  )
}

function Field({ label, onCopy, readOnly, children }: {
  label: string
  onCopy?: () => void
  readOnly?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{
          fontSize: S.label, color: T.textDim, fontFamily: T.sans,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{label}{readOnly ? ' (read-only)' : ''}</label>
        {onCopy && <Button variant="tiny" onClick={onCopy}>copy</Button>}
      </div>
      {children}
    </div>
  )
}

function statusColorOf(s: string): string {
  switch (s) {
    case 'queued': return T.warn
    case 'accepted': return T.success
    case 'failed': return T.danger
    case 'assembling': return T.accentMuted
    default: return T.text
  }
}
